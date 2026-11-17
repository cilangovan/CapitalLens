-- Mock broker: builds a year of synthetic Trading 212-shaped data for one user. Re-runnable (wipes that user's mock data first).
-- Pie names and tickers mirror the owner's structure; weights, prices and amounts are invented.
-- Demo users are created separately (see db/tenant/README.md); then, for example:
--   select public.seed_demo_portfolio((select id from auth.users where email = 'demo@capitallens.test'), 0.42, 1, null);
--   select public.seed_demo_portfolio((select id from auth.users where email = 'demo-b@capitallens.test'), 0.77, 0.3, array['VWCEd','VUSAa','SGLNl','AAPL']);
create or replace function public.seed_demo_portfolio(
  p_user uuid, p_seed double precision default 0.42, p_scale numeric default 1, p_tickers text[] default null)
returns jsonb language plpgsql set search_path = public as $fn$
declare v_conn uuid; n_snap int; n_pos int; n_ord int; n_alert int;
begin
  perform setseed(p_seed);
  drop table if exists _h, _days, _px, _dep, _ord, _hold, _div, _tot;

  delete from alerts where user_id = p_user;
  delete from watchlist where user_id = p_user;
  delete from dividends where user_id = p_user;
  delete from t212_sync_state where user_id = p_user;
  delete from broker_connections where user_id = p_user and broker = 'mock';
  delete from portfolio_snapshots where user_id = p_user;

  insert into broker_connections (user_id, broker, label, native_currency, status, last_ok_at)
  values (p_user, 'mock', 'Demo Trading 212', 'GBP', 'active', now()) returning id into v_conn;

  create temp table _h on commit drop as
  select * from (values
    ('ITWNl_EQ','ITWNl','Country Etf','LSE',46,0.0003,0.010,6),
    ('CS1l_EQ','CS1l','Country Etf','LSE',118,0.0003,0.009,5),
    ('XDAXl_EQ','XDAXl','Country Etf','LSE',52,0.0004,0.010,5),
    ('IAEXl_EQ','IAEXl','Country Etf','LSE',38,0.0003,0.010,4),
    ('IMIBl_EQ','IMIBl','Country Etf','LSE',44,0.0004,0.011,4),
    ('VFEMl_EQ','VFEMl','EM markets','LSE',36,0.0003,0.010,4),
    ('JEQPl_EQ','JEQPl','EM markets','LSE',33,0.0003,0.009,3),
    ('IWFVl_EQ','IWFVl','Global ETF','LSE',29,0.0004,0.010,4),
    ('WCOBl_EQ','WCOBl','Global ETF','LSE',24,0.0003,0.009,3),
    ('INTLl_EQ','INTLl','Global ETF','LSE',21,0.0003,0.010,3),
    ('NVDA_US_EQ','NVDA','Magnificent 7','NASDAQ/NYSE',120,0.0009,0.024,7),
    ('AAPL_US_EQ','AAPL','Magnificent 7','NASDAQ/NYSE',175,0.0005,0.016,5),
    ('MSFT_US_EQ','MSFT','Magnificent 7','NASDAQ/NYSE',340,0.0005,0.015,5),
    ('GOOGL_US_EQ','GOOGL','Magnificent 7','NASDAQ/NYSE',130,0.0005,0.017,4),
    ('AMZN_US_EQ','AMZN','Magnificent 7','NASDAQ/NYSE',150,0.0006,0.019,4),
    ('SGLNl_EQ','SGLNl','UK Gold & Silver','LSE',41,0.0005,0.008,14),
    ('SSLNl_EQ','SSLNl','UK Gold & Silver','LSE',32,0.0004,0.016,4),
    ('QDVEd_EQ','QDVEd','Wider ETF','XETRA',33,0.0004,0.011,5),
    ('SXRVd_EQ','SXRVd','Wider ETF','XETRA',580,0.0004,0.012,4),
    ('VUSAa_EQ','VUSAa','Wider ETF','AMS',78,0.0004,0.010,4),
    ('VWCEd_EQ','VWCEd','Wider ETF','XETRA',118,0.0004,0.009,3)
  ) v(ticker, display, pie, exchange, p0, mu, sigma, w);
  if p_tickers is not null then delete from _h where display <> all(p_tickers); end if;
  update _h set w = w * 100.0 / (select sum(w) from _h);

  create temp table _days on commit drop as
  select d::date as d, row_number() over (order by d) as rn,
         (d::date = min(d::date) over (partition by date_trunc('month', d))) as month_first
  from generate_series(current_date - 364, current_date, interval '1 day') d
  where extract(isodow from d) < 6;

  -- Daily prices: seeded random walk with drift and per-holding volatility.
  create temp table _px on commit drop as
  select h.ticker, y.d,
    round((h.p0 * exp(sum(h.mu + h.sigma * ((random() + random() + random() - 1.5) * 2)) over (partition by h.ticker order by y.d)))::numeric, 4) as price
  from _h h cross join _days y;

  -- Deposits: a lump sum on day one, then monthly on the first trading day.
  create temp table _dep on commit drop as
  select d, (case when rn = 1 then 9000 else 1000 end) * p_scale as amt from _days where rn = 1 or month_first;

  -- Buys: each deposit, 97% invested by weight; the rest stays as cash.
  create temp table _ord on commit drop as
  select ticker, display, d, price, qty, round(qty * price, 2) as amount from (
    select h.ticker, h.display, p.d, p.price, round((dp.amt * 0.97 * h.w / 100) / p.price, 4) as qty
    from _dep dp join _px p on p.d = dp.d join _h h on h.ticker = p.ticker) q;

  insert into t212_orders (user_id, connection_id, id, order_id, ticker, side, status, filled_at, quantity, price, net_value, realised_pnl, fx_rate, raw)
  select p_user, v_conn, 'MOCK-' || ticker || '-' || to_char(d, 'YYYYMMDD'), 'MOCK-' || ticker || '-' || to_char(d, 'YYYYMMDD'),
         ticker, 'BUY', 'FILLED', (d::timestamp + interval '9 hours 30 minutes') at time zone 'UTC', qty, price, amount, null, 1,
         jsonb_build_object('mock', true, 'ticker', ticker)
  from _ord;
  get diagnostics n_ord = row_count;

  create temp table _hold on commit drop as
  select p.ticker, p.d, p.price,
    sum(coalesce(o.qty, 0)) over w as qty, sum(coalesce(o.amount, 0)) over w as cost, max(p.price) over w as hi
  from _px p left join _ord o on o.ticker = p.ticker and o.d = p.d
  window w as (partition by p.ticker order by p.d);

  -- Quarterly dividends on everything except the metals.
  create temp table _div on commit drop as
  select h2.ticker, hd.display, h2.d, round(h2.qty * h2.price * 0.004, 2) as amt, h2.qty from (
    select h.*, row_number() over (partition by h.ticker, date_trunc('month', h.d) order by h.d) as rk
    from _hold h where extract(month from h.d) in (3, 6, 9, 12) and extract(day from h.d) >= 15) h2
  join _h hd on hd.ticker = h2.ticker
  where h2.rk = 1 and hd.pie <> 'UK Gold & Silver' and h2.qty > 0;

  insert into t212_dividends (user_id, connection_id, reference, ticker, paid_on, amount, quantity, type, raw)
  select p_user, v_conn, 'MOCK-DIV-' || ticker || '-' || to_char(d, 'YYYYMMDD'), ticker, d::timestamp at time zone 'UTC', amt, qty, 'ORDINARY', jsonb_build_object('mock', true) from _div;
  insert into dividends (user_id, reference, ticker, display, paid_date, amount)
  select p_user, 'MOCK-DIV-' || ticker || '-' || to_char(d, 'YYYYMMDD'), ticker, display, d, amt from _div;
  insert into t212_transactions (user_id, connection_id, reference, type, amount, date_time, raw)
  select p_user, v_conn, 'MOCK-DEP-' || to_char(d, 'YYYYMMDD'), 'DEPOSIT', amt, (d::timestamp + interval '8 hours') at time zone 'UTC', jsonb_build_object('mock', true) from _dep;

  create temp table _tot on commit drop as
  select hd.d, sum(hd.qty * hd.price) as mv, sum(hd.cost) as cost,
    (select coalesce(sum(dp.amt), 0) from _dep dp where dp.d <= hd.d) + (select coalesce(sum(dv.amt), 0) from _div dv where dv.d <= hd.d) - sum(hd.cost) as cash
  from _hold hd group by hd.d;

  insert into portfolio_snapshots (user_id, connection_id, created_at, total_value, cash, invested, total_ppl, run_count, raw)
  select p_user, v_conn, (d::timestamp + interval '16 hours 30 minutes') at time zone 'UTC',
         round(mv + cash, 2), round(cash, 2), round(cost, 2), round(mv - cost, 2), 1, jsonb_build_object('mock', true)
  from _tot order by d;
  get diagnostics n_snap = row_count;

  insert into positions (user_id, snapshot_id, created_at, ticker, display, pie, current_price, avg_price, gain_pct, dip_from_high, ppl, exchange, quantity, broker, native_currency)
  select p_user, s.id, s.created_at, hd.ticker, h.display, h.pie, hd.price, round(hd.cost / hd.qty, 4),
         round((hd.price / (hd.cost / hd.qty) - 1) * 100, 2), round((hd.price / hd.hi - 1) * 100, 2),
         round(hd.qty * hd.price - hd.cost, 2), h.exchange, hd.qty, 'mock', 'GBP'
  from _hold hd join _h h on h.ticker = hd.ticker
  join portfolio_snapshots s on s.user_id = p_user and s.created_at = (hd.d::timestamp + interval '16 hours 30 minutes') at time zone 'UTC'
  where hd.qty > 0;
  get diagnostics n_pos = row_count;

  -- Alerts fire the first day a holding crosses -8% (dip) or -12% (buy signal) from its high.
  insert into alerts (user_id, created_at, type, ticker, title, body, alert_type, pie, dedup_key, read_at)
  select p_user, (x.d::timestamp + interval '16 hours 35 minutes') at time zone 'UTC', t.typ, h.display,
         t.label || ': ' || h.display || ' is ' || abs(x.dip) || '% below its high',
         'Generated by the demo simulation.', t.typ, h.pie, 'mock-' || t.typ || '-' || x.ticker || '-' || to_char(x.d, 'YYYYMMDD'),
         case when x.d < current_date - 30 then (x.d::timestamp + interval '1 day') at time zone 'UTC' end
  from (select hd.ticker, hd.d, round((hd.price / hd.hi - 1) * 100, 1) as dip,
               lag(round((hd.price / hd.hi - 1) * 100, 1)) over (partition by hd.ticker order by hd.d) as prev
        from _hold hd where hd.qty > 0) x
  join _h h on h.ticker = x.ticker
  cross join (values (-8, 'dip', 'Dip alert'), (-12, 'buy', 'Buy signal')) t(th, typ, label)
  where x.dip <= t.th and coalesce(x.prev, 0) > t.th;
  get diagnostics n_alert = row_count;

  insert into t212_sync_state (user_id, connection_id, endpoint, last_run, last_full, items_total, status, detail)
  select p_user, v_conn, e.ep, now(), now(), e.n, 'ok', 'mock data' from (values
    ('orders', n_ord), ('dividends', (select count(*)::int from _div)), ('transactions', (select count(*)::int from _dep))) e(ep, n);

  if p_tickers is null then
    insert into watchlist (user_id, ticker, name, currency, exchange, category) values
      (p_user, 'TSM', 'Taiwan Semiconductor', 'USD', 'NYSE', 'stock'),
      (p_user, 'ASML', 'ASML Holding', 'USD', 'NASDAQ', 'stock'),
      (p_user, 'RR.L', 'Rolls-Royce', 'GBP', 'LSE', 'stock'),
      (p_user, 'GC=F', 'Gold futures', 'USD', 'COMEX', 'commodity'),
      (p_user, 'BTC-USD', 'Bitcoin', 'USD', 'CCC', 'crypto');
  end if;

  return jsonb_build_object('connection', v_conn, 'snapshots', n_snap, 'orders', n_ord, 'positions', n_pos, 'alerts', n_alert);
end $fn$;
revoke all on function public.seed_demo_portfolio(uuid, double precision, numeric, text[]) from public, anon, authenticated;
grant execute on function public.seed_demo_portfolio(uuid, double precision, numeric, text[]) to service_role;

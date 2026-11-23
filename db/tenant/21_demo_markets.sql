-- Epic #32: mock Markets, Watchlist, Pie history and IPO data for the demo.
-- The demo shares a Supabase project with the private app, so NOTHING invented goes into shared tables the private app reads
-- (market_cache, ipo_calendar, institutional_flow_reports). Demo-only copies are used instead; docs/demo/demo-shim.js maps the routes.
create table if not exists public.demo_market_cache (key text primary key, payload jsonb not null, fetched_at timestamptz not null default now());
create table if not exists public.demo_ipo_calendar (like public.ipo_calendar including defaults including constraints);
create table if not exists public.demo_institutional_flow_reports (like public.institutional_flow_reports including defaults including constraints);
alter table public.demo_market_cache enable row level security;
alter table public.demo_ipo_calendar enable row level security;
alter table public.demo_institutional_flow_reports enable row level security;
do $p$ declare t text; begin
  foreach t in array array['demo_market_cache', 'demo_ipo_calendar', 'demo_institutional_flow_reports'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to %s using (true)', t || '_read', t, case when t = 'demo_ipo_calendar' then 'anon, authenticated' else 'authenticated' end);
    end if;
  end loop;
end $p$;

-- the weekly flow report moves out of the shared table the private app reads
insert into public.demo_institutional_flow_reports select * from public.institutional_flow_reports where summary like 'Illustrative%' on conflict do nothing;
-- (run once by hand, destructive: delete from public.institutional_flow_reports where summary like 'Illustrative%';)
do $f$ declare d text; begin
  d := pg_get_functiondef('public.seed_demo_insights(uuid)'::regprocedure);
  d := replace(d, 'public.institutional_flow_reports', 'public.demo_institutional_flow_reports');
  execute d;
end $f$;

-- deterministic daily price path ending at p_base (business days, ~1 year); illustrative, not market data
create or replace function public.demo_series(p_sym text, p_base numeric, p_vol numeric default 0.011, p_drift numeric default 0.0004) returns jsonb language sql security definer set search_path = '' as $$
  with days as (select d::date d from generate_series(current_date - 364, current_date, interval '1 day') d where extract(isodow from d) < 6),
  r as (select d, p_drift + p_vol * ((abs(hashtext(p_sym || d::text)) % 2001) / 1000.0 - 1) rr from days),
  c as (select d, sum(rr) over (order by d) cum from r),
  l as (select cum lc from c order by d desc limit 1)
  select jsonb_agg(jsonb_build_array(extract(epoch from (c.d + time '16:30'))::bigint, round(p_base * exp(c.cum - l.lc), 4)) order by c.d) from c, l $$;
revoke all on function public.demo_series(text, numeric, numeric, numeric) from public, anon, authenticated;

create or replace function public.seed_demo_markets(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sid bigint; w record; h record; n_ch int := 0; n_wa int := 0; n_pie int := 0; n_ipo int := 0; pr record; tk record; dts text[]; tick jsonb; qa numeric[]; va numeric[];
  sids bigint[]; sdates date[]; px numeric; entries jsonb; amt numeric; d jsonb; ser jsonb; i int; wd date := current_date;
begin
  select s.id into sid from public.portfolio_snapshots s where s.user_id = p_user order by s.created_at desc limit 1;
  if sid is null then return jsonb_build_object('skipped', 'no snapshot'); end if;

  -- market charts: indices, watchlist symbols, holdings (both T212 ticker and Yahoo-style symbol)
  delete from public.demo_market_cache;
  for w in select * from (values ('^NSEI', 24500, 'INR'), ('^BSESN', 80500, 'INR'), ('^FTSE', 8300, 'GBP'), ('^GSPC', 6000, 'USD'), ('^NDX', 21500, 'USD'), ('^GDAXI', 19500, 'EUR'),
      ('^N225', 38500, 'JPY'), ('000001.SS', 3300, 'CNY'), ('^TWII', 22500, 'TWD'), ('FTSEMIB.MI', 35000, 'EUR'), ('^IBEX', 11800, 'EUR'), ('^AEX', 900, 'EUR'), ('WIG20.WA', 2500, 'PLN'),
      ('TSM', 285, 'USD'), ('ASML', 905, 'USD'), ('RR.L', 11.4, 'GBP'), ('GC=F', 2655, 'USD'), ('BTC-USD', 94500, 'USD')) v(sym, base, ccy) loop
    insert into public.demo_market_cache (key, payload) values ('chart:' || w.sym || ':1y', jsonb_build_object('points', public.demo_series(w.sym, w.base, case when w.sym = 'BTC-USD' then 0.03 else 0.011 end),
      'meta', jsonb_build_object('symbol', w.sym, 'currency', w.ccy, 'demo', true)));
    n_ch := n_ch + 1;
  end loop;
  for h in select ticker, display, current_price::numeric px from public.positions where user_id = p_user and snapshot_id = sid loop
    ser := public.demo_series(h.ticker, h.px, 0.012, 0.0003);
    insert into public.demo_market_cache (key, payload) values ('chart:' || h.ticker || ':1y', jsonb_build_object('points', ser, 'meta', jsonb_build_object('symbol', h.ticker, 'currency', 'GBP', 'demo', true)))
      on conflict (key) do nothing;
    insert into public.demo_market_cache (key, payload) values ('chart:' || h.display || ':1y', jsonb_build_object('points', ser, 'meta', jsonb_build_object('symbol', h.display, 'currency', 'GBP', 'demo', true)))
      on conflict (key) do nothing;
    n_ch := n_ch + 2;
  end loop;

  -- watchlist analysis for the five seeded watchlist items
  delete from public.watchlist_analysis where user_id = p_user;
  for w in select * from (values
      ('TSM', 285::numeric, 'USD', 'ENTER', 'strong_buy', 38, 14.2, 1.2, 44, 'Good', 0.6667),
      ('ASML', 905, 'USD', 'ACCUMULATE', 'buy', 31, 9.4, -0.6, 52, 'Good', 0.3333),
      ('RR.L', 11.4, 'GBP', 'HOLD', 'hold', 14, 3.1, 0.4, 63, 'Mixed', 0.25),
      ('GC=F', 2655, 'USD', 'HOLD', 'none', 0, null, 0.3, 58, 'Mixed', 1),
      ('BTC-USD', 94500, 'USD', 'ACCUMULATE', 'none', 0, null, -1.4, 47, 'Mixed', 1)) v(sym, base, ccy, verdict, rec, cnt, upside, daily, rsi, qual, wshare) loop
    entries := jsonb_build_array(
        jsonb_build_object('label', 'Now', 'price', round(w.base, 2), 'pct_from_now', 0, 'share', 0.4),
        jsonb_build_object('label', 'Pullback to 20-day average', 'price', round(w.base * 0.97, 2), 'pct_from_now', -3, 'share', 0.3),
        jsonb_build_object('label', 'Deeper dip', 'price', round(w.base * 0.92, 2), 'pct_from_now', -8, 'share', 0.3));
    d := jsonb_build_object('symbol', w.sym || ' (demo data)', 'price', w.base, 'ccy', w.ccy, 'daily_pct', w.daily, 'rsi', w.rsi,
      'rsi_label', case when w.rsi < 40 then 'Oversold' when w.rsi > 70 then 'Overbought' else 'Neutral' end,
      'volume', jsonb_build_object('label', case when w.daily > 1 then 'High' else 'Normal' end, 'ratio', round(0.8 + (abs(hashtext(w.sym)) % 70) / 100.0, 2), 'note', 'Illustrative volume reading for the demo'),
      'quality', jsonb_build_object('label', w.qual, 'reasons', jsonb_build_array('Illustrative quality checks: trend, volume and valuation', 'Demo figures are invented for pre-sales use')),
      'analyst', jsonb_build_object('rec', w.rec, 'count', w.cnt, 'target', case when w.upside is not null then round(w.base * (1 + w.upside / 100), 2) end, 'upside', w.upside),
      'why', jsonb_build_array(case w.verdict when 'ENTER' then 'Trend is up and price is near support: a good week to start a position' when 'ACCUMULATE' then 'Constructive trend: build the position in steps' else 'No clear edge this week: wait for the price points' end,
                               'Demo analysis: invented for illustration, not advice'),
      'entries', entries, 'weight', jsonb_build_object('share', w.wshare, 'basis', case w.verdict when 'HOLD' then 'only if the price points are hit' else 'this week' end),
      'ma20', round(w.base * 0.99, 2), 'ma50', round(w.base * 0.96, 2), 'ma200', round(w.base * 0.88, 2), 'low52', round(w.base * 0.7, 2), 'high52', round(w.base * 1.1, 2), 'range_pos', 68,
      'drawdown20', -2.4, 'take_profit', round(w.base * 1.2, 2), 'invalidation', round(w.base * 0.9, 2), 'as_of', wd::text);
    insert into public.watchlist_analysis (user_id, ticker, updated_at, status, verdict, data) values (p_user, w.sym, now(), 'ok', w.verdict, d);
    n_wa := n_wa + 1;
  end loop;

  -- pie history (qty and value per ticker per day) from the demo snapshots, plus the all-holdings line
  delete from public.pie_history where user_id = p_user;
  select array_agg(id order by dd), array_agg(dd order by dd) into sids, sdates
    from (select distinct on (created_at::date) id, created_at::date dd from public.portfolio_snapshots where user_id = p_user order by created_at::date, created_at desc) z;
  select array_agg(x::text order by x) into dts from unnest(sdates) x;
  for pr in select distinct pie from public.positions where user_id = p_user and snapshot_id = sid loop
    tick := '{}'::jsonb;
    for tk in select distinct ticker from public.positions where user_id = p_user and snapshot_id = sid and pie = pr.pie loop
      select array_agg(coalesce(x.q, 0) order by u.ord), array_agg(coalesce(x.v, 0) order by u.ord) into qa, va
        from unnest(sids) with ordinality u(id, ord) left join (select p.snapshot_id, sum(p.quantity::numeric) q, sum(p.quantity::numeric * p.current_price::numeric) v from public.positions p
                                 where p.user_id = p_user and p.pie = pr.pie and p.ticker = tk.ticker group by p.snapshot_id) x on x.snapshot_id = u.id;
      tick := tick || jsonb_build_object(tk.ticker, jsonb_build_object('qty', to_jsonb(qa), 'value', to_jsonb(va)));
    end loop;
    insert into public.pie_history (user_id, pie, updated_at, series) values (p_user, pr.pie, now(), jsonb_build_object('dates', to_jsonb(dts), 'tickers', tick));
    n_pie := n_pie + 1;
  end loop;
  insert into public.pie_history (user_id, pie, updated_at, series)
    select p_user, '__ALL__', now(), jsonb_build_object('dates', to_jsonb(dts), 'value', (select jsonb_agg(round(total_value::numeric, 2) order by created_at::date) from (
      select distinct on (created_at::date) created_at, total_value from public.portfolio_snapshots where user_id = p_user order by created_at::date, created_at desc) z));

  -- IPO calendar (demo-only table). Company names are fictional.
  delete from public.demo_ipo_calendar;
  insert into public.demo_ipo_calendar (id, market, exchange, name, ticker, sector, status, start_date, end_date, listing_date, currency, price_low, price_high, deal_size_usd, rating, rating_source, note, source_name, source_url, as_of, updated_at)
  select v.id, v.market, v.exchange, v.name, v.ticker, v.sector, v.status, wd + v.s, wd + v.e, wd + v.l, v.ccy, v.lo, v.hi, v.size, v.rating, v.rsrc, 'Fictional company for the demo', 'Demo data', null, wd, now()
  from (values
    ('US:NRTHW', 'US', 'NASDAQ', 'Northwind Robotics', 'NRTHW', 'Technology', 'upcoming', 5, 8, 10, 'USD', 18, 21, 850000000, 'Subscribe', 'Demo analyst view'),
    ('US:HLXBIO', 'US', 'NYSE', 'Helix Biosciences', 'HLXB', 'Healthcare', 'open', -1, 2, 5, 'USD', 24, 27, 620000000, 'Neutral', 'Demo analyst view'),
    ('US:CRBNX', 'US', 'NYSE', 'Carbonex Energy', 'CRBX', 'Energy', 'filed', 20, 23, 26, 'USD', null, null, 1400000000, 'Not rated', null),
    ('UK:BRCLY', 'UK', 'LSE', 'Brackley Logistics', 'BRKL', 'Industrials', 'upcoming', 9, 12, 14, 'GBP', 3.4, 3.9, 410000000, 'Neutral', 'Demo analyst view'),
    ('UK:TRNST', 'UK', 'LSE', 'Transit Fintech', 'TRNS', 'Financials', 'priced', -6, -3, 1, 'GBP', 2.1, 2.1, 280000000, 'Subscribe', 'Demo analyst view'),
    ('IN:SOLRA', 'IN', 'NSE', 'Solara Renewables', 'SOLARA', 'Utilities', 'open', 0, 3, 7, 'INR', 410, 432, 520000000, 'Subscribe', 'Demo analyst view'),
    ('IN:MDCRX', 'IN', 'BSE', 'Medcare Diagnostics', 'MEDCARE', 'Healthcare', 'upcoming', 12, 15, 19, 'INR', 220, 236, 190000000, 'Neutral', 'Demo analyst view'),
    ('HK:LUMNA', 'HK', 'HKEX', 'Lumina Battery', 'LUMB', 'Industrials', 'upcoming', 7, 11, 15, 'HKD', 38, 44, 760000000, 'Avoid', 'Demo analyst view'),
    ('JP:KSMOS', 'JP', 'TSE', 'Kosmos Semiconductors', 'KSMS', 'Technology', 'filed', 30, 34, 38, 'JPY', null, null, 940000000, 'Not rated', null),
    ('EU:AURRA', 'EU', 'Euronext', 'Aurora Foods', 'AURF', 'Consumer Staples', 'listed', -30, -27, -24, 'EUR', 15, 15, 330000000, 'Neutral', 'Demo analyst view'),
    ('SG:ORCHD', 'SG', 'SGX', 'Orchid Data Centres', 'ORCH', 'Technology', 'upcoming', 14, 17, 20, 'SGD', 0.9, 1.05, 450000000, 'Subscribe', 'Demo analyst view')
  ) v(id, market, exchange, name, ticker, sector, status, s, e, l, ccy, lo, hi, size, rating, rsrc);
  get diagnostics n_ipo = row_count;
  return jsonb_build_object('charts', n_ch, 'watchlist_analysis', n_wa, 'pie_history', n_pie, 'ipos', n_ipo);
end $$;
revoke all on function public.seed_demo_markets(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_markets(uuid) to service_role;

create or replace function public.demo_refresh() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; res jsonb; ins jsonb; ret jsonb; mk jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  res := public.seed_demo_portfolio(t, 0.42, 1, null);
  ins := public.seed_demo_insights(t);
  ret := public.seed_demo_returns(t);
  mk := public.seed_demo_markets(t);
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', true, 'seeded', res, 'insights', ins, 'returns', ret, 'markets', mk))
    on conflict (key) do update set value = excluded.value;
  return res || jsonb_build_object('insights', ins, 'returns', ret, 'markets', mk);
exception when others then
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', false, 'error', sqlerrm))
    on conflict (key) do update set value = excluded.value;
  raise;
end $$;

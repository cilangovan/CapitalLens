-- Epic #32: mock Returns dashboard data for the demo (returns_summary + realised_pnl), built from the demo snapshots/dividends and refreshed daily.
-- Illustrative only: closed trades are invented; profit curve = unrealised + cumulative realised + dividends. Shapes match docs/js/returns.js.
create or replace function public.seed_demo_returns(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  dts date[]; val numeric[]; net numeric[]; n int; i int; last_d date; lbl text; frm date; k int;
  tot_div numeric; tot_real numeric := 0; interest numeric; costs numeric; unreal numeric; cash_now numeric; hold_now numeric; invested_now numeric;
  periods jsonb := '[]'::jsonb; yearly jsonb := '{}'::jsonb; monthly jsonb := '{}'::jsonb; det jsonb; s0 numeric; p0 numeric; p1 numeric; twr_all numeric; xirr numeric; first_d date;
  t record; q numeric; px numeric; avgc numeric; rp numeric; cnt int := 0; mth text; y text; m0 numeric; mv0 numeric; mp0 numeric; mn0 numeric;
begin
  delete from public.realised_pnl where user_id = p_user;
  delete from public.returns_summary where user_id = p_user;

  -- invented closed trades: up to 10 sells over the last 8 months from the stock holdings
  for t in select ticker, display, current_price::numeric px, avg_price::numeric av, quantity::numeric qty from public.positions
           where user_id = p_user and snapshot_id = (select id from public.portfolio_snapshots where user_id = p_user order by created_at desc limit 1) and ticker like '%_US_EQ' order by ticker loop
    exit when cnt >= 10;
    q := round(t.qty * (0.08 + (abs(hashtext(t.ticker || 'q')) % 10) / 100.0), 3);
    avgc := round(t.av * (0.92 + (abs(hashtext(t.ticker || 'a')) % 8) / 100.0), 2);
    px := round(t.px * (0.85 + (abs(hashtext(t.ticker || 'p')) % 25) / 100.0), 2);
    rp := round((px - avgc) * q, 2);
    insert into public.realised_pnl (user_id, order_id, ticker, display, filled_date, quantity, fill_price, avg_cost, realised_pnl, realised_pnl_pct, side, created_at)
      values (p_user, 'demo-sell-' || t.ticker, t.ticker, t.display, current_date - (14 + cnt * 21 + (abs(hashtext(t.ticker)) % 9)), q, px, avgc, rp, round((px - avgc) / nullif(avgc, 0) * 100, 2), 'SELL', now());
    cnt := cnt + 1;
  end loop;
  select coalesce(sum(realised_pnl), 0) into tot_real from public.realised_pnl where user_id = p_user;
  select coalesce(sum(amount), 0) into tot_div from public.dividends where user_id = p_user;

  -- one point per day (last snapshot of the day)
  select array_agg(d order by d), array_agg(v order by d), array_agg(nt order by d) into dts, val, net from (
    select distinct on (created_at::date) created_at::date d, total_value::numeric v,
           (total_value::numeric - coalesce(total_ppl::numeric, 0) - (select coalesce(sum(amount), 0) from public.dividends x where x.user_id = p_user and x.paid_date <= s.created_at::date)
              - tot_real * least(1, greatest(0, (s.created_at::date - (current_date - 240))::numeric / 240))) nt
    from public.portfolio_snapshots s where s.user_id = p_user order by created_at::date, created_at desc) z;
  n := coalesce(array_length(dts, 1), 0);
  if n < 5 then return jsonb_build_object('skipped', 'not enough snapshots'); end if;
  last_d := dts[n]; first_d := dts[1];
  select total_value::numeric, cash::numeric, invested::numeric, coalesce(total_ppl::numeric, 0) into s0, cash_now, invested_now, unreal
    from public.portfolio_snapshots where user_id = p_user order by created_at desc limit 1;
  hold_now := s0 - coalesce(cash_now, 0);
  interest := round(coalesce(cash_now, 0) * 0.02 + 18, 2); costs := -round(coalesce(invested_now, 0) * 0.002, 2);
  p1 := val[n] - net[n]; p0 := val[1] - net[1];

  -- profit by period (illustrative time-weighted % = profit change / start value)
  foreach lbl in array array['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'] loop
    frm := case lbl when '1D' then last_d - 1 when '1W' then last_d - 7 when '1M' then last_d - 30 when '3M' then last_d - 91 when '6M' then last_d - 182
                    when 'YTD' then date_trunc('year', last_d)::date when '1Y' then last_d - 365 else first_d end;
    k := 1; for i in 1..n loop if dts[i] >= frm then k := i; exit; end if; end loop;
    if n - k < 1 then k := n - 1; end if;
    periods := periods || jsonb_build_object('label', lbl, 'from', dts[k], 'to', last_d, 'profit', round((val[n] - net[n]) - (val[k] - net[k]), 2),
      'twr_pct', round(((val[n] - net[n]) - (val[k] - net[k])) / nullif(val[k], 0) * 100, 2), 'start_value', round(val[k], 2), 'end_value', round(val[n], 2), 'net_added', round(net[n] - net[k], 2));
  end loop;

  -- monthly and yearly breakdowns from the daily series (month-end values)
  for mth in select distinct to_char(d, 'YYYY-MM') from unnest(dts) d order by 1 loop
    select max(g) into k from generate_subscripts(dts, 1) g where to_char(dts[g], 'YYYY-MM') = mth;
    select min(g) into i from generate_subscripts(dts, 1) g where to_char(dts[g], 'YYYY-MM') = mth;
    mv0 := case when i > 1 then val[i - 1] else val[i] end; mn0 := case when i > 1 then net[i - 1] else net[i] end;
    monthly := monthly || jsonb_build_object(mth, jsonb_build_object('profit', round((val[k] - net[k]) - (mv0 - mn0), 2),
      'twr_pct', round(((val[k] - net[k]) - (mv0 - mn0)) / nullif(mv0, 0) * 100, 2), 'net_added', round(net[k] - mn0, 2), 'end_value', round(val[k], 2)));
  end loop;
  for y in select distinct to_char(d, 'YYYY') from unnest(dts) d order by 1 loop
    select max(g) into k from generate_subscripts(dts, 1) g where to_char(dts[g], 'YYYY') = y;
    select min(g) into i from generate_subscripts(dts, 1) g where to_char(dts[g], 'YYYY') = y;
    mv0 := val[i]; mn0 := net[i];
    yearly := yearly || jsonb_build_object(y, jsonb_build_object('profit', round((val[k] - net[k]) - (mv0 - mn0), 2),
      'twr_pct', round(((val[k] - net[k]) - (mv0 - mn0)) / nullif(mv0, 0) * 100, 2), 'net_added', round(net[k] - mn0, 2), 'end_value', round(val[k], 2)));
  end loop;

  twr_all := round(p1 / nullif(val[1], 0) * 100, 2);
  xirr := round(twr_all * 365.0 / greatest(1, last_d - first_d) * 0.9, 2);
  det := jsonb_build_object('since', first_d, 'account_value', round(val[n], 2), 'holdings_value', round(hold_now, 2), 'cash', round(coalesce(cash_now, 0), 2),
    'xirr_pct', xirr, 'twr_pct', twr_all, 'twr_annual_pct', round(twr_all * 365.0 / greatest(1, last_d - first_d), 2),
    'profit', jsonb_build_object('total', round(p1, 2), 'pct_of_net_in', round(p1 / nullif(net[n], 0) * 100, 2), 'unrealised', round(unreal, 2), 'realised', round(tot_real, 2),
      'dividends', round(tot_div, 2), 'interest', interest, 'other', 0, 'costs', costs),
    'money_in', jsonb_build_object('net', round(net[n], 2), 'deposited', round(net[n] * 1.04, 2), 'withdrawn', round(net[n] * 0.04, 2), 'deposits', 12),
    'periods', periods, 'series', jsonb_build_object('dates', to_jsonb(dts), 'value', (select jsonb_agg(round(x, 2)) from unnest(val) x), 'net_in', (select jsonb_agg(round(x, 2)) from unnest(net) x)),
    'note', 'Illustrative demo figures');
  insert into public.returns_summary (user_id, xirr_pct, annualised_pct, total_return_pct, yearly_breakdown, monthly_breakdown, updated_at, details)
    values (p_user, xirr, round(twr_all * 365.0 / greatest(1, last_d - first_d), 2), twr_all, yearly, monthly, now(), det);
  return jsonb_build_object('closed_trades', cnt, 'days', n, 'total_profit', round(p1, 2));
end $$;
revoke all on function public.seed_demo_returns(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_returns(uuid) to service_role;

create or replace function public.demo_refresh() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; res jsonb; ins jsonb; ret jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  res := public.seed_demo_portfolio(t, 0.42, 1, null);
  ins := public.seed_demo_insights(t);
  ret := public.seed_demo_returns(t);
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', true, 'seeded', res, 'insights', ins, 'returns', ret))
    on conflict (key) do update set value = excluded.value;
  return res || jsonb_build_object('insights', ins, 'returns', ret);
exception when others then
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', false, 'error', sqlerrm))
    on conflict (key) do update set value = excluded.value;
  raise;
end $$;

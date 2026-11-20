-- Epic #32: daily refresh of the demo template + parity report. Applied to the demo project (ggprfdetivzekjxlpvyq) after 17_demo_access.sql.
create or replace function public.demo_refresh() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; res jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  res := public.seed_demo_portfolio(t, 0.42, 1, null);
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', true, 'seeded', res))
    on conflict (key) do update set value = excluded.value;
  return res;
exception when others then
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', false, 'error', sqlerrm))
    on conflict (key) do update set value = excluded.value;
  raise;
end $$;

-- Parity: which features of the real dashboard have rows in the demo template. A table with 0 rows means that card is empty in the demo.
create or replace function public.demo_parity() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; r record; n bigint; out jsonb := '[]'::jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  for r in select * from (values
      ('portfolio_snapshots','Overview, Investments line', true), ('positions','Positions, P&L bubbles, decline by country', true), ('alerts','Alerts inbox', true),
      ('dividends','Dividends', true), ('t212_orders','Orders / realised P&L inputs', true), ('t212_transactions','Cash flow', true), ('watchlist','Watchlist', true),
      ('holding_decisions','Holding decisions (Analyst)', true), ('profit_booking','Profit Booking Strategy', true), ('profit_booking_summary','Profit Booking summary', true),
      ('realised_pnl','Returns: realised P&L', true), ('returns_summary','Returns summary', true), ('strategy_recommendations','Strategy recommendations', true),
      ('value_buy_scores','Value-buy scores', true), ('watchlist_analysis','Watchlist analysis', true), ('pie_history','Pie history chart', true),
      ('market_cache','Markets I hold (shared)', false), ('ipo_calendar','IPO Watch (shared)', false), ('analyst_ratings','Analyst ratings (shared)', false)) as v(tbl, feature, per_user) loop
    begin
      if r.per_user then execute format('select count(*) from public.%I where user_id = %L', r.tbl, t) into n;
      else execute format('select count(*) from public.%I', r.tbl) into n; end if;
    exception when others then n := -1; end;
    out := out || jsonb_build_object('table', r.tbl, 'feature', r.feature, 'rows', n, 'ok', n > 0);
  end loop;
  return jsonb_build_object('checked_at', now(), 'last_refresh', (select value from public.demo_settings where key = 'last_refresh'), 'features', out,
                            'gaps', (select coalesce(jsonb_agg(f->>'feature'), '[]'::jsonb) from jsonb_array_elements(out) f where (f->>'ok')::boolean is not true));
end $$;
revoke all on function public.demo_refresh(), public.demo_parity() from public, anon, authenticated;
grant execute on function public.demo_parity() to authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'demo-cleanup') then perform cron.schedule('demo-cleanup', '* * * * *', 'select public.demo_cleanup()'); end if;
  if not exists (select 1 from cron.job where jobname = 'demo-daily-refresh') then perform cron.schedule('demo-daily-refresh', '17 5 * * *', 'select public.demo_refresh()'); end if;
exception when others then raise notice 'pg_cron not available: %', sqlerrm; end $$;

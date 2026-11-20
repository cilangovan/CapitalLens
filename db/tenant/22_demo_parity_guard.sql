-- Issue #28: automated demo parity guard. The feature list moves into demo_parity_internal() (no gate, no grants to customers);
-- demo_parity() keeps its owner/staff gate; demo_parity_gaps() lets CI (service role) read only the NAMES of empty features.
create or replace function public.demo_parity_internal() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; r record; n bigint; out jsonb := '[]'::jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  for r in select * from (values
      ('portfolio_snapshots','Overview, Investments line', true), ('positions','Positions, P&L bubbles, decline by country', true), ('alerts','Alerts inbox', true),
      ('dividends','Dividends', true), ('t212_orders','Orders / realised P&L inputs', true), ('t212_transactions','Cash flow', true), ('watchlist','Watchlist', true),
      ('holding_decisions','Holding decisions (Analyst)', true), ('profit_booking','Profit Booking Strategy', true), ('profit_booking_summary','Profit Booking summary', true),
      ('realised_pnl','Returns: realised P&L', true), ('returns_summary','Returns summary', true), ('strategy_recommendations','Strategy recommendations', true),
      ('value_buy_scores','Value-buy scores', true), ('watchlist_analysis','Watchlist analysis', true), ('pie_history','Pie history chart', true),
      ('demo_market_cache','Markets I hold (demo-only table)', false), ('demo_ipo_calendar','IPO Watch (demo-only table)', false),
      ('demo_institutional_flow_reports','Institutional flow report (demo-only table)', false), ('analyst_ratings','Analyst ratings (shared)', false)) as v(tbl, feature, per_user) loop
    begin
      if r.per_user then execute format('select count(*) from public.%I where user_id = %L', r.tbl, t) into n;
      else execute format('select count(*) from public.%I', r.tbl) into n; end if;
    exception when others then n := -1; end;
    out := out || jsonb_build_object('table', r.tbl, 'feature', r.feature, 'rows', n, 'ok', n > 0);
  end loop;
  return jsonb_build_object('checked_at', now(), 'last_refresh', (select value from public.demo_settings where key = 'last_refresh'), 'features', out,
                            'gaps', (select coalesce(jsonb_agg(f->>'feature'), '[]'::jsonb) from jsonb_array_elements(out) f where (f->>'ok')::boolean is not true));
end $$;
create or replace function public.demo_parity() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (public.ops_is_admin() or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  return public.demo_parity_internal();
end $$;
create or replace function public.demo_parity_gaps() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('gaps', public.demo_parity_internal()->'gaps', 'checked_at', now()) $$;
revoke all on function public.demo_parity_internal(), public.demo_parity_gaps() from public, anon, authenticated;
grant execute on function public.demo_parity_gaps() to service_role;

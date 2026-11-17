-- 007: public (anon) access is READ-ONLY. All writes go through the service key
-- (GitHub Actions) which bypasses RLS. dashboard_auth stays fully private.
alter table public.holding_decisions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['alerts','analyst_ratings','portfolio_snapshots','positions',
    'profit_booking','profit_booking_summary','returns_summary','strategy_recommendations',
    'dividends','realised_pnl','holding_decisions','institutional_flow_reports','value_buy_scores']
  loop
    execute format('drop policy if exists "allow all" on public.%I', t);
    execute format('drop policy if exists anon_read on public.%I', t);
    execute format('drop policy if exists anon_upsert_%s on public.%I', t, t);
    execute format('drop policy if exists anon_update_%s on public.%I', t, t);
    execute format('drop policy if exists anon_read_%s on public.%I', t, t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

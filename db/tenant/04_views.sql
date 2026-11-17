-- Views the dashboard reads. security_invoker keeps row-level security of the underlying tables in force.
create or replace view public.portfolio_snapshots_all with (security_invoker = true) as
  select id, user_id, connection_id, created_at, total_value, cash, invested, total_ppl, run_count, raw from public.portfolio_snapshots;
create or replace view public.positions_all with (security_invoker = true) as
  select id, user_id, snapshot_id, created_at, ticker, display, pie, current_price, avg_price, gain_pct, dip_from_high, ppl,
         exchange, quantity, broker, native_currency from public.positions;
grant select on public.portfolio_snapshots_all, public.positions_all to authenticated;

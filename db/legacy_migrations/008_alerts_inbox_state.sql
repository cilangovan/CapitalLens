-- 008: inbox state for dashboard alerts (read / archive / dismiss / restore).
-- Writes happen only through the worker's authenticated /alerts/action route (service key).
alter table public.alerts
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists dismissed_at timestamptz;
create index if not exists alerts_state_idx on public.alerts (archived_at, dismissed_at, created_at desc);

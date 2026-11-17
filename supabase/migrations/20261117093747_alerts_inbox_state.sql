-- Supabase migration 20261117093747 "alerts_inbox_state" — exported from supabase_migrations.schema_migrations
alter table public.alerts
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists dismissed_at timestamptz;
create index if not exists alerts_state_idx on public.alerts (archived_at, dismissed_at, created_at desc);

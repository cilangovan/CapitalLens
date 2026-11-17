-- Supabase migration 20261117172300 "pie_history" — exported from supabase_migrations.schema_migrations
-- Daily value/return series per pie (and '__ALL__'), for the positions drill-down charts.
-- rec_* = recorded from portfolio snapshots (actual T212 values); est = today's holdings × past prices (estimate).
create table if not exists public.pie_history (
  pie         text primary key,
  updated_at  timestamptz default now(),
  series      jsonb not null
);
comment on table public.pie_history is 'Per-pie daily series for the positions drill-down. Rebuilt daily by services/pie_history_service.py.';
alter table public.pie_history enable row level security;
create policy public_read on public.pie_history for select to anon, authenticated using (true);

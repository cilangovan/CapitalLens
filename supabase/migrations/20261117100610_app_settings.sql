-- Supabase migration 20261117100610 "app_settings" — exported from supabase_migrations.schema_migrations
create table if not exists public.app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
alter table public.app_settings enable row level security;
create policy public_read on public.app_settings for select to anon, authenticated using (true);

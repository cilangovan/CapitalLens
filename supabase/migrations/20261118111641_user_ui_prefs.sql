-- Supabase migration 20261118111641 "user_ui_prefs" — exported from supabase_migrations.schema_migrations
create table if not exists public.user_ui_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_ui_prefs enable row level security;
drop policy if exists "own prefs read" on public.user_ui_prefs;
drop policy if exists "own prefs insert" on public.user_ui_prefs;
drop policy if exists "own prefs update" on public.user_ui_prefs;
create policy "own prefs read"   on public.user_ui_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "own prefs insert" on public.user_ui_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own prefs update" on public.user_ui_prefs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter table public.user_ui_prefs drop constraint if exists user_ui_prefs_size;
alter table public.user_ui_prefs add constraint user_ui_prefs_size check (pg_column_size(prefs) < 20000);
revoke all on public.user_ui_prefs from anon, authenticated;
grant select, insert, update on public.user_ui_prefs to authenticated;
grant all on public.user_ui_prefs to service_role;

-- Supabase migration 20261118134940 "tier3_market_cache" — exported from supabase_migrations.schema_migrations
create table if not exists public.market_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.market_cache enable row level security;
drop policy if exists "signed-in read" on public.market_cache;
create policy "signed-in read" on public.market_cache for select to authenticated using (true);
revoke all on public.market_cache from anon, authenticated;
grant select on public.market_cache to authenticated;
grant all on public.market_cache to service_role;

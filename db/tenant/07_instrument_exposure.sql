-- Reference data (shared, not tenant data): full name, flag and "what it is" per Trading 212 ticker.
-- Readable by signed-in users, writable only by service_role / migrations. Already applied to both Supabase projects.
create table if not exists public.instrument_exposure (
  ticker text primary key, display_name text not null,
  flag text not null default '', exposure text not null default '',
  updated_at timestamptz not null default now());
alter table public.instrument_exposure enable row level security;
create policy "signed-in read" on public.instrument_exposure for select to authenticated using (true);
revoke all on public.instrument_exposure from anon, authenticated;
grant select on public.instrument_exposure to authenticated;
grant all on public.instrument_exposure to service_role;
-- To add or fix an instrument later:  insert ... on conflict (ticker) do update ...

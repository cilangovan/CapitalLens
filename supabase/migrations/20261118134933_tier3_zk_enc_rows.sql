-- Supabase migration 20261118134933 "tier3_zk_enc_rows" — exported from supabase_migrations.schema_migrations
create table if not exists public.enc_rows (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z0-9_]{1,40}$'),
  id uuid not null,
  nonce text not null,
  ct text not null check (length(ct) < 200000),
  key_version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
alter table public.enc_rows enable row level security;
drop policy if exists "own enc rows" on public.enc_rows;
create policy "own enc rows" on public.enc_rows for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.enc_rows from anon, authenticated;
grant select, insert, update, delete on public.enc_rows to authenticated;
grant all on public.enc_rows to service_role;

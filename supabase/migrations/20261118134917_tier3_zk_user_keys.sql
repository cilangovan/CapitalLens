-- Supabase migration 20261118134917 "tier3_zk_user_keys" — exported from supabase_migrations.schema_migrations
create table if not exists public.user_keys (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kdf jsonb not null,
  pw_salt text not null,
  rec_salt text not null,
  wrapped_dk_pw jsonb not null,
  wrapped_dk_rec jsonb not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint user_keys_size check (pg_column_size(wrapped_dk_pw) < 1000 and pg_column_size(wrapped_dk_rec) < 1000)
);
alter table public.user_keys enable row level security;
drop policy if exists "own keys read" on public.user_keys;
drop policy if exists "own keys insert" on public.user_keys;
drop policy if exists "own keys update" on public.user_keys;
create policy "own keys read"   on public.user_keys for select to authenticated using (user_id = (select auth.uid()));
create policy "own keys insert" on public.user_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own keys update" on public.user_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_keys from anon, authenticated;
grant select, insert, update on public.user_keys to authenticated;
grant all on public.user_keys to service_role;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'zk_salt_pepper')
  where not exists (select 1 from vault.secrets where name = 'zk_salt_pepper');
create or replace function public.zk_login_params(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_salt text; v_kdf jsonb; v_pepper text;
begin
  select decrypted_secret into v_pepper from vault.decrypted_secrets where name = 'zk_salt_pepper';
  select k.pw_salt, k.kdf into v_salt, v_kdf from public.user_keys k join auth.users u on u.id = k.user_id
    where lower(u.email) = lower(p_email);
  if v_salt is null then
    v_salt := encode(substring(extensions.hmac(lower(p_email), v_pepper, 'sha256') from 1 for 16), 'base64');
    v_kdf := '{"name":"PBKDF2-SHA256","iterations":600000}'::jsonb;
  end if;
  return jsonb_build_object('pw_salt', v_salt, 'kdf', v_kdf);
end $$;
revoke all on function public.zk_login_params(text) from public;
grant execute on function public.zk_login_params(text) to anon, authenticated;

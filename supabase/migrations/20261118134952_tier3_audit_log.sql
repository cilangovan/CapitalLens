-- Supabase migration 20261118134952 "tier3_audit_log" — exported from supabase_migrations.schema_migrations
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  subject_user uuid,
  table_name text not null,
  op text not null,
  row_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_subject_at on public.audit_log (subject_user, at desc);
create index if not exists audit_log_actor_at on public.audit_log (actor, at desc);
alter table public.audit_log enable row level security;
drop policy if exists "own audit read" on public.audit_log;
create policy "own audit read" on public.audit_log for select to authenticated using (subject_user = (select auth.uid()));
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select on public.audit_log to service_role;

create or replace function public.audit_log_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only'; end $$;
drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update or delete or truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

create or replace function public.audit_privileged() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_owner uuid := coalesce((v_row->>'user_id')::uuid, null);
  v_actor text := coalesce(nullif(auth.role(), ''), session_user);
  v_id text := coalesce(v_row->>'id', v_row->>'user_id', v_row->>'connection_id');
begin
  if v_actor = 'authenticated' and v_owner is not null and auth.uid() = v_owner then
    return coalesce(new, old);
  end if;
  insert into public.audit_log (actor, subject_user, table_name, op, row_id, detail)
  values (v_actor, v_owner, tg_table_name, tg_op, v_id,
          jsonb_build_object('caller_uid', auth.uid(), 'db_user', session_user, 'kind', v_row->>'kind'));
  return coalesce(new, old);
end $$;
revoke all on function public.audit_privileged() from public, anon, authenticated;

drop trigger if exists audit_user_keys on public.user_keys;
create trigger audit_user_keys after insert or update or delete on public.user_keys for each row execute function public.audit_privileged();
drop trigger if exists audit_enc_rows on public.enc_rows;
create trigger audit_enc_rows after insert or update or delete on public.enc_rows for each row execute function public.audit_privileged();
do $$ begin
  if to_regclass('public.broker_secrets') is not null then
    drop trigger if exists audit_broker_secrets on public.broker_secrets;
    create trigger audit_broker_secrets after insert or update or delete on public.broker_secrets for each row execute function public.audit_privileged();
  end if;
end $$;

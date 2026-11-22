-- Supabase migration 20261117230153 "broker_connect_and_scheduler" — exported from supabase_migrations.schema_migrations
alter table public.broker_connections
  add column if not exists environment text not null default 'live' check (environment in ('live','demo')),
  add column if not exists sync_state jsonb not null default '{}'::jsonb;
alter table public.broker_secrets alter column ciphertext drop not null;
alter table public.broker_secrets add column if not exists vault_secret_id uuid;
alter table public.sync_jobs add column if not exists started_at timestamptz;

create or replace function public.store_broker_secret(p_connection uuid, p_payload text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_old uuid;
begin
  select vault_secret_id into v_old from public.broker_secrets where connection_id = p_connection;
  v_id := vault.create_secret(p_payload, 'broker:' || p_connection::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
  insert into public.broker_secrets(connection_id, vault_secret_id, key_hint) values (p_connection, v_id, 'vault')
    on conflict (connection_id) do update set vault_secret_id = excluded.vault_secret_id;
  if v_old is not null then delete from vault.secrets where id = v_old; end if;
end $$;

create or replace function public.read_broker_secret(p_connection uuid)
returns text language sql security definer set search_path = '' stable as $$
  select ds.decrypted_secret from public.broker_secrets bs join vault.decrypted_secrets ds on ds.id = bs.vault_secret_id
  where bs.connection_id = p_connection $$;

create or replace function public.drop_vault_secret() returns trigger language plpgsql security definer set search_path = '' as $$
begin if old.vault_secret_id is not null then delete from vault.secrets where id = old.vault_secret_id; end if; return old; end $$;
drop trigger if exists broker_secrets_drop_vault on public.broker_secrets;
create trigger broker_secrets_drop_vault after delete on public.broker_secrets for each row execute function public.drop_vault_secret();

create or replace function public.claim_sync_job()
returns setof public.sync_jobs language plpgsql security definer set search_path = '' as $$
begin
  update public.sync_jobs set state = 'queued', next_run_at = now() where state = 'running' and started_at < now() - interval '6 minutes';
  return query
  update public.sync_jobs j set state = 'running', attempts = j.attempts + 1, started_at = now()
  where j.id = (select id from public.sync_jobs where state = 'queued' and next_run_at <= now() order by next_run_at limit 1 for update skip locked)
  returning j.*;
end $$;
create unique index if not exists sync_jobs_one_open on public.sync_jobs(connection_id, kind) where state in ('queued','running');

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'broker_cron_secret')
  where not exists (select 1 from vault.secrets where name = 'broker_cron_secret');
create or replace function public.check_cron_secret(p text)
returns boolean language sql security definer set search_path = '' stable as $$
  select coalesce(p = (select decrypted_secret from vault.decrypted_secrets where name = 'broker_cron_secret'), false) $$;

revoke all on function public.store_broker_secret(uuid,text), public.read_broker_secret(uuid), public.drop_vault_secret(),
  public.claim_sync_job(), public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.store_broker_secret(uuid,text), public.read_broker_secret(uuid),
  public.claim_sync_job(), public.check_cron_secret(text) to service_role;

grant delete on public.broker_connections to authenticated;
create policy "own connections delete" on public.broker_connections for delete to authenticated using (user_id = (select auth.uid()));

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.schedule('broker-sync-tick', '* * * * *', $cron$
  select net.http_post(url := 'https://kloqkcxchstfoljpqcbq.supabase.co/functions/v1/broker/tick',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'broker_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);

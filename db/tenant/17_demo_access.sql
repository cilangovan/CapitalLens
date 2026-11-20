-- 17_demo_access.sql: temporary demo logins for pre-sales (epic #32; requirements in documentation/demo-requirements.md).
-- A visitor gets a throw-away account cloned from the owner-managed master demo account. It is valid 60 minutes, ends after 45 minutes
-- without activity or when the tab is closed (90 s grace for a refresh), and expiry is enforced HERE, by row-level security, not by the page.
-- Only service_role (the generate-login function) and postgres (pg_cron) can create sessions; visitors can only call demo_touch / demo_end.
-- Re-runnable.

-- ── settings and sessions (no policies: only the security-definer functions below touch them) ─────────────────────────────────────────
create table if not exists public.demo_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.demo_settings enable row level security;
insert into public.demo_settings (key, value) values
  ('enabled', 'true'), ('ttl_minutes', '60'), ('idle_minutes', '45'), ('close_grace_seconds', '90'),
  ('max_active', '25'), ('per_ip_per_hour', '5'), ('retain_days', '30'), ('template_email', '"demo@capitallens.test"')
on conflict (key) do nothing;

create table if not exists public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,      -- the account is deleted at the end; the usage row stays (no personal data)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  end_after timestamptz,                                                  -- set when the tab closes; cleared if the visitor comes back within the grace
  ended_at timestamptz,
  ended_reason text check (ended_reason in ('time', 'idle', 'closed', 'owner', 'cleanup')),
  ip_hash text);
alter table public.demo_sessions enable row level security;
create index if not exists demo_sessions_active_idx on public.demo_sessions (ended_at, expires_at);
create index if not exists demo_sessions_ip_idx on public.demo_sessions (ip_hash, created_at);
revoke all on public.demo_settings, public.demo_sessions from anon, authenticated;

create or replace function public.demo_setting(p_key text, p_default numeric) returns numeric
  language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::numeric from public.demo_settings where key = p_key), p_default) $$;

-- ── expiry enforcement: a restrictive policy on every per-user table ────────────────────────────────────────────────────────────────
-- Real users (not in demo_sessions) and signed-out requests always pass; a demo visitor passes only while the session is live.
create or replace function public.demo_access_ok() returns boolean
  language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then true
    when not exists (select 1 from public.demo_sessions s where s.user_id = auth.uid()) then true
    else exists (select 1 from public.demo_sessions s
                 where s.user_id = auth.uid() and s.ended_at is null and now() < s.expires_at
                   and now() - s.last_seen_at < make_interval(mins => public.demo_setting('idle_minutes', 45)::int)
                   and (s.end_after is null or now() < s.end_after))
  end $$;

do $$ declare r record; begin
  for r in select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'user_id' and c.table_name not in ('demo_sessions', 'platform_admins') loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.table_name and policyname = 'demo_expiry') then
      execute format('create policy demo_expiry on public.%I as restrictive for all to authenticated using ((select public.demo_access_ok())) with check ((select public.demo_access_ok()))', r.table_name);
    end if;
  end loop;
end $$;

-- ── what the visitor's browser calls ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.demo_touch() returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.demo_sessions; idle int := public.demo_setting('idle_minutes', 45)::int; why text;
begin
  if auth.uid() is null then return jsonb_build_object('demo', false); end if;
  select * into s from public.demo_sessions where user_id = auth.uid();
  if not found then return jsonb_build_object('demo', false); end if;
  if s.ended_at is not null then return jsonb_build_object('demo', true, 'active', false, 'reason', coalesce(s.ended_reason, 'time')); end if;
  why := case when now() >= s.expires_at then 'time'
              when now() - s.last_seen_at >= make_interval(mins => idle) then 'idle'
              when s.end_after is not null and now() >= s.end_after then 'closed' end;
  if why is not null then
    update public.demo_sessions set ended_at = now(), ended_reason = why where id = s.id;
    return jsonb_build_object('demo', true, 'active', false, 'reason', why);
  end if;
  update public.demo_sessions set last_seen_at = now(), end_after = null where id = s.id;
  return jsonb_build_object('demo', true, 'active', true, 'expires_at', s.expires_at,
    'seconds_left', greatest(0, floor(extract(epoch from (s.expires_at - now())))), 'idle_minutes', idle);
end $$;

create or replace function public.demo_end(p_grace boolean default false) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_grace then
    update public.demo_sessions set end_after = now() + make_interval(secs => public.demo_setting('close_grace_seconds', 90)::int)
      where user_id = auth.uid() and ended_at is null;
  else
    update public.demo_sessions set ended_at = now(), ended_reason = 'closed' where user_id = auth.uid() and ended_at is null;
  end if;
end $$;

-- ── what the generate-login function calls (service_role only) ──────────────────────────────────────────────────────────────────────
create or replace function public.demo_can_issue(p_ip_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select (value #>> '{}')::boolean from public.demo_settings where key = 'enabled'), true) is not true then return jsonb_build_object('ok', false, 'code', 'disabled'); end if;
  if (select count(*) from public.demo_sessions where ended_at is null and now() < expires_at) >= public.demo_setting('max_active', 25) then return jsonb_build_object('ok', false, 'code', 'busy'); end if;
  if p_ip_hash is not null and (select count(*) from public.demo_sessions where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= public.demo_setting('per_ip_per_hour', 5) then
    return jsonb_build_object('ok', false, 'code', 'rate'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Copies the master demo account's data to a new visitor account. Snapshots/connections get new ids (positions and t212_* rows follow them).
create or replace function public.demo_clone_template(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; r text; cols text; sel text; n int; np int := 0; ns int := 0; res jsonb := '{}'::jsonb; s record; new_sid bigint;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  if p_user = t then raise exception 'cannot clone the template onto itself'; end if;
  insert into public.broker_connections (id, user_id, broker, label, native_currency, status, last_ok_at, last_error, created_at, environment, sync_state)
    select md5(b.id::text || p_user::text)::uuid, p_user, b.broker, b.label, b.native_currency, b.status, b.last_ok_at, b.last_error, b.created_at, b.environment, b.sync_state
    from public.broker_connections b where b.user_id = t;
  get diagnostics n = row_count; res := res || jsonb_build_object('broker_connections', n);

  for s in select * from public.portfolio_snapshots where user_id = t order by id loop
    insert into public.portfolio_snapshots (user_id, connection_id, created_at, total_value, cash, invested, total_ppl, run_count, raw)
      values (p_user, case when s.connection_id is null then null else md5(s.connection_id::text || p_user::text)::uuid end,
              s.created_at, s.total_value, s.cash, s.invested, s.total_ppl, s.run_count, s.raw) returning id into new_sid;
    ns := ns + 1;
    insert into public.positions (user_id, snapshot_id, created_at, ticker, display, pie, current_price, avg_price, gain_pct, dip_from_high, ppl, exchange, quantity, broker, native_currency)
      select p_user, new_sid, p.created_at, p.ticker, p.display, p.pie, p.current_price, p.avg_price, p.gain_pct, p.dip_from_high, p.ppl, p.exchange, p.quantity, p.broker, p.native_currency
      from public.positions p where p.user_id = t and p.snapshot_id = s.id;
    get diagnostics n = row_count; np := np + n;
  end loop;
  res := res || jsonb_build_object('portfolio_snapshots', ns, 'positions', np);

  foreach r in array array['alerts', 'dividends', 'holding_decisions', 'pie_history', 'profit_booking', 'profit_booking_summary', 'realised_pnl', 'returns_summary',
                           'strategy_recommendations', 'value_buy_scores', 'watchlist', 'watchlist_analysis', 't212_orders', 't212_dividends', 't212_transactions', 't212_sync_state'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
           string_agg(case column_name when 'user_id' then quote_literal(p_user) || '::uuid'
                                       when 'connection_id' then 'case when x.connection_id is null then null else md5(x.connection_id::text || ' || quote_literal(p_user::text) || ')::uuid end'
                                       else 'x.' || quote_ident(column_name) end, ', ' order by ordinal_position)
      into cols, sel
      from information_schema.columns where table_schema = 'public' and table_name = r and not (column_name = 'id' and is_identity = 'YES');
    execute format('insert into public.%I (%s) select %s from public.%I x where x.user_id = %L', r, cols, sel, r, t);
    get diagnostics n = row_count; res := res || jsonb_build_object(r, n);
  end loop;
  update public.profiles set is_demo = true, display_name = 'Demo visitor' where user_id = p_user;
  return res;
end $$;

create or replace function public.demo_register_session(p_user uuid, p_ip_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare ttl int := public.demo_setting('ttl_minutes', 60)::int; exp timestamptz; copied jsonb;
begin
  copied := public.demo_clone_template(p_user);
  exp := now() + make_interval(mins => ttl);
  insert into public.demo_sessions (user_id, expires_at, ip_hash) values (p_user, exp, p_ip_hash);
  return jsonb_build_object('expires_at', exp, 'ttl_minutes', ttl, 'idle_minutes', public.demo_setting('idle_minutes', 45)::int, 'copied', copied);
end $$;

-- ── clean-up: end sessions past a limit, delete their accounts (all per-user rows cascade), prune old usage rows ──────────────────────
create or replace function public.demo_cleanup() returns jsonb language plpgsql security definer set search_path = '' as $$
declare idle int := public.demo_setting('idle_minutes', 45)::int; n_end int; n_del int; n_old int;
begin
  with e as (
    update public.demo_sessions s set ended_at = now(),
      ended_reason = case when now() >= s.expires_at then 'time' when now() - s.last_seen_at >= make_interval(mins => idle) then 'idle' else 'closed' end
    where s.ended_at is null and (now() >= s.expires_at or now() - s.last_seen_at >= make_interval(mins => idle) or (s.end_after is not null and now() >= s.end_after))
    returning 1) select count(*) into n_end from e;
  with d as (delete from auth.users u using public.demo_sessions s where s.user_id = u.id and s.ended_at is not null returning u.id) select count(*) into n_del from d;
  with o as (delete from public.demo_sessions where ended_at < now() - make_interval(days => public.demo_setting('retain_days', 30)::int) returning 1) select count(*) into n_old from o;
  return jsonb_build_object('ended', n_end, 'deleted', n_del, 'pruned', n_old, 'active', (select count(*) from public.demo_sessions where ended_at is null));
end $$;

-- ── the master demo account is locked: email / password / recovery can only change through demo_owner_reset_template ───────────────────
create or replace function public.demo_lock_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare locked boolean := false;
begin
  if coalesce(current_setting('app.demo_owner_reset', true), '') = 'on' then return new; end if;
  begin
    locked := old.id = (select id from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email'))
              or exists (select 1 from public.demo_sessions s where s.user_id = old.id);
  exception when others then locked := false;                             -- never block a real user's sign-in because of a lookup problem
  end;
  if locked and (new.email is distinct from old.email or new.encrypted_password is distinct from old.encrypted_password or new.phone is distinct from old.phone
                 or new.recovery_token is distinct from old.recovery_token or new.email_change is distinct from old.email_change
                 or new.email_change_token_new is distinct from old.email_change_token_new or new.email_change_token_current is distinct from old.email_change_token_current) then
    raise exception 'demo accounts cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger demo_lock before update of email, encrypted_password, phone, recovery_token, email_change, email_change_token_new, email_change_token_current
  on auth.users for each row execute function public.demo_lock_guard();

-- Owner-only reset: the project owner in the SQL editor, or a platform admin who has passed the second factor. Returns the password once; writes the audit log.
create or replace function public.demo_owner_reset_template(p_password text default null) returns text language plpgsql security definer set search_path = '' as $$
declare t uuid; pw text := p_password;
begin
  if not (public.ops_is_admin() or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  if pw is null then pw := translate(substr(encode(extensions.gen_random_bytes(24), 'base64'), 1, 20), '/+=', 'xyz'); end if;
  if length(pw) < 12 then raise exception 'password must be at least 12 characters'; end if;
  perform set_config('app.demo_owner_reset', 'on', true);
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = t;
  perform set_config('app.demo_owner_reset', '', true);
  insert into public.audit_log (actor, subject_user, table_name, op, row_id, detail)
    values (coalesce(nullif(auth.role(), ''), session_user), t, 'auth.users', 'DEMO_OWNER_RESET', t::text, jsonb_build_object('caller_uid', auth.uid(), 'db_user', session_user));
  return pw;
end $$;

-- Owner-only: end every live visitor session now (clean-up deletes the accounts within a minute).
create or replace function public.demo_end_all() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (public.ops_is_admin() or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))) then raise exception 'not allowed' using errcode = '42501'; end if;
  with e as (update public.demo_sessions set ended_at = now(), ended_reason = 'owner' where ended_at is null returning 1) select count(*) into n from e;
  return n;
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.demo_setting(text, numeric), public.demo_access_ok(), public.demo_touch(), public.demo_end(boolean), public.demo_can_issue(text),
  public.demo_clone_template(uuid), public.demo_register_session(uuid, text), public.demo_cleanup(), public.demo_lock_guard(),
  public.demo_owner_reset_template(text), public.demo_end_all() from public, anon, authenticated;
grant execute on function public.demo_access_ok() to authenticated;                                    -- used by the policies
grant execute on function public.demo_touch(), public.demo_end(boolean) to authenticated;
grant execute on function public.demo_owner_reset_template(text), public.demo_end_all() to authenticated;  -- they check ops_is_admin() (platform admin + second factor) themselves
grant execute on function public.demo_can_issue(text), public.demo_register_session(uuid, text), public.demo_clone_template(uuid), public.demo_cleanup() to service_role;

-- ── schedule: clean-up every minute ─────────────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'demo-cleanup';
  perform cron.schedule('demo-cleanup', '* * * * *', 'select public.demo_cleanup()');
exception when others then raise notice 'pg_cron not available: schedule demo_cleanup() every minute another way (%).', sqlerrm; end $$;

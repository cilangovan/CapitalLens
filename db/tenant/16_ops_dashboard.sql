-- Internal platform operations dashboard (epic #23). Staff only, enforced INSIDE Postgres, not in the browser.
-- Who: rows in platform_admins (a dedicated staff login, separate from any customer account).
-- What they can see: sizes, row counts, user counts, sign-up/active counts, audit-event counts. Never ciphertext, keys, emails or portfolio data.
-- Customers: no access at all (no policies, no grants). Anyone else calling the functions gets an error.
create table if not exists public.platform_admins (
  user_id uuid primary key,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

-- One row per day so growth history lives in our own database.
create table if not exists public.ops_daily (
  day date primary key,
  db_bytes bigint not null,
  enc_rows bigint not null,
  users integer not null,
  active_7d integer not null,
  signups integer not null,
  recorded_at timestamptz not null default now()
);
alter table public.ops_daily enable row level security;
revoke all on public.ops_daily from anon, authenticated;

-- Admin = listed in platform_admins AND signed in with a second factor (aal2). A password alone is never enough.
create or replace function public.ops_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;
-- Lets the staff page say "you are listed but need your second factor" instead of a generic refusal. Returns only true/false about the caller.
create or replace function public.ops_has_admin_row() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create or replace function public.ops_require_admin() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.ops_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

create or replace function public.ops_overview() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.ops_require_admin();
  select jsonb_build_object(
    'generated_at', now(),
    'db_bytes', pg_database_size(current_database()),
    'tables', coalesce((select jsonb_agg(jsonb_build_object('name', c.relname, 'bytes', pg_total_relation_size(c.oid), 'rows', c.reltuples::bigint) order by pg_total_relation_size(c.oid) desc)
                        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'), '[]'::jsonb),
    'enc_rows', (select count(*) from public.enc_rows),
    'enc_by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from public.enc_rows group by kind) k), '{}'::jsonb),
    'users', (select count(*) from auth.users),
    'active_1d', (select count(*) from auth.users where last_sign_in_at > now() - interval '1 day'),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'active_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'signups_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (select created_at::date d, count(*) n from auth.users where created_at > now() - interval '30 days' group by 1) s), '[]'::jsonb),
    'audit_7d', coalesce((select jsonb_agg(jsonb_build_object('actor', actor, 'table', table_name, 'op', op, 'n', n)) from (select actor, table_name, op, count(*) n from public.audit_log where at > now() - interval '7 days' group by 1,2,3 order by n desc limit 30) a), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from (select day, db_bytes, enc_rows, users, active_7d, signups from public.ops_daily order by day desc limit 365) d), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.ops_record_daily() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.ops_require_admin();
  insert into public.ops_daily (day, db_bytes, enc_rows, users, active_7d, signups)
  values (current_date, pg_database_size(current_database()), (select count(*) from public.enc_rows), (select count(*) from auth.users),
          (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
          (select count(*) from auth.users where created_at::date = current_date))
  on conflict (day) do update set db_bytes = excluded.db_bytes, enc_rows = excluded.enc_rows, users = excluded.users,
    active_7d = excluded.active_7d, signups = excluded.signups, recorded_at = now();
end $$;

revoke all on function public.ops_is_admin(), public.ops_has_admin_row(), public.ops_require_admin(), public.ops_overview(), public.ops_record_daily() from public, anon;
grant execute on function public.ops_is_admin(), public.ops_has_admin_row(), public.ops_overview(), public.ops_record_daily() to authenticated;

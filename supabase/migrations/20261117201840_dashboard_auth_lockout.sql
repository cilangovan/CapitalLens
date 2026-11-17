-- Supabase migration 20261117201840 "dashboard_auth_lockout" — exported from supabase_migrations.schema_migrations
-- Brute-force protection for the dashboard login (worker locks the account for 15 min after 5 failed attempts).
alter table public.dashboard_auth add column if not exists failed_logins integer not null default 0;
alter table public.dashboard_auth add column if not exists locked_until timestamptz;

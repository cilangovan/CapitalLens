-- Supabase migration 20261115200620 "dashboard_auth" — exported from supabase_migrations.schema_migrations
-- ── DASHBOARD AUTH ───────────────────────────────────────────────────────────
create table if not exists dashboard_auth (
  id             serial primary key,
  username       text not null unique,
  password_hash  text not null,
  session_token  text,
  session_expiry timestamptz,
  reset_token    text,
  reset_expiry   timestamptz,
  updated_at     timestamptz default now()
);

-- RLS: block all public access — Worker uses service role key
alter table dashboard_auth enable row level security;
drop policy if exists "no public access" on dashboard_auth;
create policy "no public access" on dashboard_auth for all using (false);

-- Seed initial user: [redacted]
-- [redacted] credential seed removed from version control — create your own login (see db/README.md)

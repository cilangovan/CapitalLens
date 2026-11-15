-- T212 Monitor — Supabase Schema
-- Run this in Supabase SQL Editor to create/update all tables
-- Existing tables (portfolio_snapshots, positions, alerts) are unaffected

-- ============================================================
-- analyst_ratings
-- ============================================================
create table if not exists analyst_ratings (
  id            bigserial primary key,
  ticker        text unique not null,
  yahoo_ticker  text,
  pie           text,
  recommendation text,
  star_rating   int,
  target_mean   numeric,
  buy_pct       numeric,
  hold_pct      numeric,
  sell_pct      numeric,
  analyst_count int,
  updated_at    timestamptz default now()
);

alter table analyst_ratings enable row level security;

drop policy if exists "allow all" on analyst_ratings;
create policy "allow all" on analyst_ratings for all using (true) with check (true);

-- ============================================================
-- strategy_recommendations
-- ============================================================
create table if not exists strategy_recommendations (
  id                bigserial primary key,
  week_number       int,
  total_suggested   numeric,
  on_track          boolean,
  annualised_return numeric,
  recommendations   jsonb,
  notes             jsonb,
  updated_at        timestamptz default now()
);

alter table strategy_recommendations enable row level security;

drop policy if exists "allow all" on strategy_recommendations;
create policy "allow all" on strategy_recommendations for all using (true) with check (true);

-- ============================================================
-- returns_summary
-- ============================================================
create table if not exists returns_summary (
  id                bigserial primary key,
  xirr_pct          numeric,
  annualised_pct    numeric,
  total_return_pct  numeric,
  yearly_breakdown  jsonb,
  monthly_breakdown jsonb,
  updated_at        timestamptz default now()
);

alter table returns_summary enable row level security;

drop policy if exists "allow all" on returns_summary;
create policy "allow all" on returns_summary for all using (true) with check (true);

-- ============================================================
-- Ensure existing tables have RLS + allow-all policies
-- ============================================================

alter table if exists portfolio_snapshots enable row level security;
drop policy if exists "allow all" on portfolio_snapshots;
create policy "allow all" on portfolio_snapshots for all using (true) with check (true);

alter table if exists positions enable row level security;
drop policy if exists "allow all" on positions;
create policy "allow all" on positions for all using (true) with check (true);

alter table if exists alerts enable row level security;
drop policy if exists "allow all" on alerts;
create policy "allow all" on alerts for all using (true) with check (true);

-- ── ALERTS TABLE EXTENSION ───────────────────────────────────────────────────
-- Add columns needed by alert_service.py (safe to run multiple times)
alter table if exists alerts add column if not exists alert_type text;
alter table if exists alerts add column if not exists ticker text;
alter table if exists alerts add column if not exists pie text;
alter table if exists alerts add column if not exists dedup_key text;
alter table if exists alerts add column if not exists title text;
alter table if exists alerts add column if not exists body text;
-- Unique constraint on dedup_key to prevent duplicates
create unique index if not exists alerts_dedup_key_idx on alerts(dedup_key);

-- ── DASHBOARD AUTH ───────────────────────────────────────────────────────────
-- Single-user auth table for dashboard login
create table if not exists dashboard_auth (
  id           serial primary key,
  username     text not null unique,
  reset_token  text,
  reset_expiry timestamptz,
  updated_at   timestamptz default now()
);

-- RLS: only service role can read/write (Worker uses service key via proxy)
alter table dashboard_auth enable row level security;
drop policy if exists "no public access" on dashboard_auth;
create policy "no public access" on dashboard_auth for all using (false);

insert into dashboard_auth (username, password_hash)
on conflict (username) do nothing;

-- Add session + reset token columns to dashboard_auth
alter table if exists dashboard_auth add column if not exists session_token text;
alter table if exists dashboard_auth add column if not exists session_expiry timestamptz;

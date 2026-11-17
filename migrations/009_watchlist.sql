-- 009: watchlist. instruments = searchable T212 universe (US/LSE/XETRA/AMS), synced by monitor.py.
-- watchlist + watchlist_analysis: public read; writes only via worker (/watchlist/*) and services (service key).
create extension if not exists pg_trgm;
create table if not exists public.instruments (
  ticker text primary key, name text, short_name text, currency text, type text, isin text, exchange text,
  synced_at timestamptz default now());
create index if not exists instruments_name_trgm  on public.instruments using gin (name gin_trgm_ops);
create index if not exists instruments_short_trgm on public.instruments using gin (short_name gin_trgm_ops);
create table if not exists public.watchlist (
  id bigint generated always as identity primary key, ticker text unique not null, name text, currency text,
  exchange text, added_at timestamptz default now());
create table if not exists public.watchlist_analysis (
  ticker text primary key references public.watchlist(ticker) on delete cascade,
  updated_at timestamptz default now(), status text, verdict text, data jsonb);
alter table public.instruments enable row level security;
alter table public.watchlist enable row level security;
alter table public.watchlist_analysis enable row level security;
create policy public_read on public.instruments        for select to anon, authenticated using (true);
create policy public_read on public.watchlist          for select to anon, authenticated using (true);
create policy public_read on public.watchlist_analysis for select to anon, authenticated using (true);

-- 009b: global watchlist — ticker holds the Yahoo Finance symbol; t212_ticker links to Trading 212 if tradable there
alter table public.watchlist add column if not exists t212_ticker text, add column if not exists type text;

-- 009c: dashboard settings (e.g. watchlist_weekly_budget). Public read; writes via worker /settings/set only.
create table if not exists public.app_settings (key text primary key, value jsonb, updated_at timestamptz default now());
alter table public.app_settings enable row level security;
create policy public_read on public.app_settings for select to anon, authenticated using (true);

-- 009d: sections + T212 alternatives (crypto ETPs / commodity ETCs)
alter table public.watchlist add column if not exists category text not null default 'stock'
  check (category in ('stock','commodity','crypto'));
alter table public.watchlist add column if not exists alternatives jsonb;

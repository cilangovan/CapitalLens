-- Supabase migration 20261117095337 "watchlist" — exported from supabase_migrations.schema_migrations
create extension if not exists pg_trgm;

create table if not exists public.instruments (
  ticker      text primary key,
  name        text,
  short_name  text,
  currency    text,
  type        text,
  isin        text,
  exchange    text,
  synced_at   timestamptz default now()
);
create index if not exists instruments_name_trgm  on public.instruments using gin (name gin_trgm_ops);
create index if not exists instruments_short_trgm on public.instruments using gin (short_name gin_trgm_ops);

create table if not exists public.watchlist (
  id        bigint generated always as identity primary key,
  ticker    text unique not null,
  name      text,
  currency  text,
  exchange  text,
  added_at  timestamptz default now()
);

create table if not exists public.watchlist_analysis (
  ticker      text primary key references public.watchlist(ticker) on delete cascade,
  updated_at  timestamptz default now(),
  status      text,          -- ok | unverified | error
  verdict     text,          -- ENTER | ACCUMULATE | HOLD | AVOID
  data        jsonb
);

alter table public.instruments        enable row level security;
alter table public.watchlist          enable row level security;
alter table public.watchlist_analysis enable row level security;
create policy public_read on public.instruments        for select to anon, authenticated using (true);
create policy public_read on public.watchlist          for select to anon, authenticated using (true);
create policy public_read on public.watchlist_analysis for select to anon, authenticated using (true);

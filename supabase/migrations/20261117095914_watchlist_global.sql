-- Supabase migration 20261117095914 "watchlist_global" — exported from supabase_migrations.schema_migrations
-- watchlist.ticker now holds the Yahoo Finance symbol (any exchange worldwide, e.g. 7203.T, RR.L, ASML.AS)
alter table public.watchlist
  add column if not exists t212_ticker text,
  add column if not exists type text;
comment on column public.watchlist.ticker is 'Yahoo Finance symbol (global)';
comment on column public.watchlist.t212_ticker is 'Matching Trading 212 instrument, if tradable there';

-- Supabase migration 20261117102812 "watchlist_category" — exported from supabase_migrations.schema_migrations
alter table public.watchlist add column if not exists category text not null default 'stock'
  check (category in ('stock','commodity','crypto'));

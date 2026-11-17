-- Supabase migration 20261117102925 "watchlist_alternatives" — exported from supabase_migrations.schema_migrations
alter table public.watchlist add column if not exists alternatives jsonb;
comment on column public.watchlist.alternatives is 'Trading 212 products giving the same exposure (crypto ETPs / commodity ETCs)';

-- Supabase migration 20261120125550 "watchlist_sort_order" — exported from supabase_migrations.schema_migrations
alter table public.watchlist add column if not exists sort_order integer;
alter table public.watchlist drop constraint if exists watchlist_sort_order_check;
alter table public.watchlist add constraint watchlist_sort_order_check check (sort_order is null or (sort_order >= 0 and sort_order < 500));

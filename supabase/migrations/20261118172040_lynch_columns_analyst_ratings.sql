-- Supabase migration 20261118172040 "lynch_columns_analyst_ratings" — exported from supabase_migrations.schema_migrations
alter table public.analyst_ratings
  add column if not exists lynch_bucket int,
  add column if not exists lynch_name text,
  add column if not exists lynch_reason text,
  add column if not exists lynch_growth double precision,
  add column if not exists lynch_basis text,
  add column if not exists lynch_confidence text;

-- Peter Lynch bucket on analyst ratings (legacy single-tenant dashboard). Additive, nullable: nothing existing changes.
alter table public.analyst_ratings
  add column if not exists lynch_bucket int,
  add column if not exists lynch_name text,
  add column if not exists lynch_reason text,
  add column if not exists lynch_growth double precision,
  add column if not exists lynch_basis text,
  add column if not exists lynch_confidence text;
-- Undo: alter table public.analyst_ratings drop column lynch_bucket, drop column lynch_name, drop column lynch_reason, drop column lynch_growth, drop column lynch_basis, drop column lynch_confidence;

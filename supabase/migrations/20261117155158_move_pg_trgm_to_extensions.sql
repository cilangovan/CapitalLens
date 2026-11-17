-- Supabase migration 20261117155158 "move_pg_trgm_to_extensions" — exported from supabase_migrations.schema_migrations
-- advisor 0014: keep extensions out of the API-exposed public schema (trigram indexes keep working; they reference the opclass by OID)
alter extension pg_trgm set schema extensions;

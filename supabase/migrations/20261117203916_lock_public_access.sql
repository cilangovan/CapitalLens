-- Supabase migration 20261117203916 "lock_public_access" — exported from supabase_migrations.schema_migrations
-- Lock the database to the server side. The dashboard reads only through the worker (signed-in sessions,
-- service key); every service uses the service key. The public anon/authenticated roles get nothing.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and policyname = 'public_read' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- new tables/functions created later don't become public by default either
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

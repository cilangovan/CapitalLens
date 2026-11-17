-- Supabase migration 20261117173804 "t212_raw_history_private" — exported from supabase_migrations.schema_migrations
-- Raw broker history is private: no anon/authenticated access at all (service role only).
do $$ declare t text; begin
  foreach t in array array['t212_orders','t212_dividends','t212_transactions','t212_sync_state'] loop
    execute format('drop policy if exists public_read on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$

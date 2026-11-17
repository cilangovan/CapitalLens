-- Supabase migration 20261117155039 "history_archive_and_alert_purge" — exported from supabase_migrations.schema_migrations
-- Hot tables keep the last 45 days; older history moves (not deleted) to archive tables.
create table if not exists public.portfolio_snapshots_archive (like public.portfolio_snapshots including defaults including constraints including indexes);
create table if not exists public.positions_archive          (like public.positions          including defaults including constraints including indexes);
create index if not exists portfolio_snapshots_archive_created_at_idx on public.portfolio_snapshots_archive (created_at desc);
create index if not exists positions_archive_snapshot_id_idx          on public.positions_archive (snapshot_id);
comment on table public.portfolio_snapshots_archive is 'Snapshots older than 45 days, moved by archive_portfolio_history(). Same columns as portfolio_snapshots.';
comment on table public.positions_archive is 'Positions of archived snapshots. Same columns as positions.';

alter table public.portfolio_snapshots_archive enable row level security;
alter table public.positions_archive          enable row level security;
create policy public_read on public.portfolio_snapshots_archive for select to anon, authenticated using (true);
create policy public_read on public.positions_archive          for select to anon, authenticated using (true);

-- Full history for readers that need it (returns/XIRR, period comparisons). security_invoker → RLS of the caller applies.
create or replace view public.portfolio_snapshots_all with (security_invoker = true) as
  select * from public.portfolio_snapshots union all select * from public.portfolio_snapshots_archive;
create or replace view public.positions_all with (security_invoker = true) as
  select * from public.positions union all select * from public.positions_archive;
grant select on public.portfolio_snapshots_all, public.positions_all to anon, authenticated, service_role;

-- Move snapshots (and their positions) older than keep_days into the archive, atomically. Never moves the latest snapshot.
create or replace function public.archive_portfolio_history(keep_days int default 45)
returns json language plpgsql set search_path = public as $$
declare
  ids bigint[];
  n_pos int;
begin
  if keep_days < 7 then raise exception 'keep_days must be >= 7'; end if;
  select coalesce(array_agg(id), '{}') into ids from portfolio_snapshots
   where created_at < now() - make_interval(days => keep_days)
     and id <> (select max(id) from portfolio_snapshots);
  if cardinality(ids) = 0 then return json_build_object('snapshots', 0, 'positions', 0); end if;
  insert into portfolio_snapshots_archive select * from portfolio_snapshots where id = any(ids) on conflict (id) do nothing;
  insert into positions_archive select * from positions where snapshot_id = any(ids) on conflict (id) do nothing;
  get diagnostics n_pos = row_count;
  delete from positions where snapshot_id = any(ids);
  delete from portfolio_snapshots where id = any(ids);
  return json_build_object('snapshots', cardinality(ids), 'positions', n_pos, 'cutoff', now() - make_interval(days => keep_days));
end $$;

-- Delete alerts that were cleared (dismissed) more than `days` ago. Archived and inbox alerts are never touched.
create or replace function public.purge_cleared_alerts(days int default 30)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  if days < 7 then raise exception 'days must be >= 7'; end if;
  delete from alerts where dismissed_at is not null and dismissed_at < now() - make_interval(days => days);
  get diagnostics n = row_count;
  return n;
end $$;

-- Only the service role (GitHub Actions) may run maintenance
revoke all on function public.archive_portfolio_history(int) from public, anon, authenticated;
revoke all on function public.purge_cleared_alerts(int)      from public, anon, authenticated;
grant execute on function public.archive_portfolio_history(int) to service_role;
grant execute on function public.purge_cleared_alerts(int)      to service_role;

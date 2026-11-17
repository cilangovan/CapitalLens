-- Supabase migration 20261117154632 "analyst_rating_source_and_indexes" — exported from supabase_migrations.schema_migrations
-- where a rating comes from: 'analysts' (Yahoo consensus) or 'trend' (price-trend score for ETFs / uncovered tickers)
alter table public.analyst_ratings add column if not exists source text;
update public.analyst_ratings set source = case when coalesce(analyst_count,0) > 0 then 'analysts' else 'trend' end where source is null;
comment on column public.analyst_ratings.source is 'analysts = Yahoo analyst consensus; trend = price-trend score (no analyst coverage, e.g. ETFs)';

-- indexes for the queries the dashboard and services actually run
create index if not exists positions_snapshot_id_idx on public.positions (snapshot_id);             -- FK; every page load filters by latest snapshot
create index if not exists portfolio_snapshots_created_at_idx on public.portfolio_snapshots (created_at desc);
create index if not exists alerts_created_at_idx on public.alerts (created_at desc);                -- inbox: order by created_at desc
create index if not exists alerts_type_created_idx on public.alerts (alert_type, created_at desc);   -- daily report lookup
drop index if exists public.alerts_state_idx;                                                       -- never used (advisor)

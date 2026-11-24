-- Regression & data-quality results (platform data, no customer data). Written by scripts/regression_run.py with the service key
-- from the "Regression & data quality" workflow; nobody else can read or write it (row-level security on, no policies, no grants).
create table if not exists public.regression_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  commit_sha text,
  ref text,
  trigger text,                          -- push | pull_request | schedule | workflow_dispatch | local
  total integer not null,
  passed integer not null,
  failed integer not null,
  duration_s numeric,
  run_url text
);
create table if not exists public.regression_results (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.regression_runs(id) on delete cascade,
  suite text not null,                   -- e.g. tests/zk_dedupe_test.mjs
  check_name text not null,
  status text not null check (status in ('pass', 'fail')),
  detail text,
  bug_ids text                           -- register ids the suite guards, e.g. 'R01,R12'
);
create index if not exists regression_results_run_idx on public.regression_results (run_id);
create index if not exists regression_results_failed_idx on public.regression_results (status) where status = 'fail';
alter table public.regression_runs enable row level security;
alter table public.regression_results enable row level security;
revoke all on public.regression_runs, public.regression_results from anon, authenticated;

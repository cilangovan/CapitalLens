-- CapitalLens multi-tenant schema (phase 1). Tenant tables carry user_id; market-wide tables are shared.
-- Applied to the separate demo Supabase project, NOT the live single-user database.
-- Run in order: 01_schema.sql, 02_seed_demo.sql, 03_rls_isolation_test.sql
create extension if not exists pg_trgm with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  base_currency text not null default 'GBP',
  timezone text not null default 'Europe/London',
  ntfy_topic text,
  email_alerts boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  broker text not null check (broker in ('trading212','zerodha','mock')),
  label text not null,
  native_currency text not null default 'GBP',
  status text not null default 'pending' check (status in ('pending','active','error','needs_login','disabled')),
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index on public.broker_connections(user_id);

-- Encrypted broker credentials. No user-facing policy: only the service role can touch this table.
create table public.broker_secrets (
  connection_id uuid primary key references public.broker_connections(id) on delete cascade,
  ciphertext bytea not null,
  key_hint text,
  created_at timestamptz not null default now()
);

create table public.sync_jobs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.broker_connections(id) on delete cascade,
  kind text not null,
  next_run_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued','running','done','failed')),
  attempts integer not null default 0,
  last_error text
);
create index on public.sync_jobs(state, next_run_at);

-- ── Shared, market-wide tables ────────────────────────────────────────────
create table public.instruments (
  ticker text primary key, name text, short_name text, currency text, type text, isin text, exchange text,
  synced_at timestamptz default now()
);
create index instruments_name_trgm on public.instruments using gin (name extensions.gin_trgm_ops);

create table public.analyst_ratings (
  id bigint generated always as identity primary key,
  ticker text not null unique, yahoo_ticker text, pie text, recommendation text, star_rating integer,
  target_mean numeric, buy_pct numeric, hold_pct numeric, sell_pct numeric, analyst_count integer,
  updated_at timestamptz default now(), source text
);

create table public.institutional_flow_reports (
  id bigint generated always as identity primary key,
  report_date date not null unique,
  markets jsonb default '[]', sector_rotation jsonb default '{}', opportunities jsonb default '[]',
  cautions jsonb default '[]', cash_strategy text, portfolio_actions jsonb default '[]', summary text,
  created_at timestamptz default now()
);

-- ── Tenant tables ─────────────────────────────────────────────────────────
create table public.alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz default now(), type text, ticker text, title text, body text, alert_type text, pie text,
  dedup_key text, read_at timestamptz, archived_at timestamptz, dismissed_at timestamptz,
  unique (user_id, dedup_key)
);
create index on public.alerts(user_id, created_at desc);

create table public.portfolio_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete cascade,
  created_at timestamptz default now(), total_value numeric, cash numeric, invested numeric, total_ppl numeric,
  run_count integer, raw jsonb
);
create index on public.portfolio_snapshots(user_id, created_at desc);

create table public.positions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id bigint references public.portfolio_snapshots(id) on delete cascade,
  created_at timestamptz default now(), ticker text, display text, pie text, current_price numeric,
  avg_price numeric, gain_pct numeric, dip_from_high numeric, ppl numeric, exchange text, quantity numeric,
  broker text not null default 'trading212', native_currency text not null default 'GBP'
);
create index on public.positions(user_id, snapshot_id);

create table public.holding_decisions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  report_date date not null, ticker text not null, display text, pie text, exchange text, score integer,
  decision text, sell_level integer, sell_signal text, buy_signal text, inst_score integer, price_score integer,
  fin_score integer, val_score integer, sector_score integer, risk_score integer, rsi numeric, mom_4w numeric,
  mom_1w numeric, pct_from_high numeric, above_ma50 boolean, vol_ratio numeric, notes text,
  created_at timestamptz default now(),
  unique (user_id, report_date, ticker)
);

create table public.profit_booking (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null, display text, yahoo_ticker text, pie text, kind text, sector text, value_gbp numeric,
  weight_pct numeric, gain_pct numeric, score integer, breakdown jsonb, action text, action_level text,
  trim_plan jsonb, trailing_stop numeric, stop_distance_pct numeric, max_position_gbp numeric, rel_volume numeric,
  signals jsonb, notes jsonb, updated_at timestamptz default now(),
  unique (user_id, ticker)
);

create table public.profit_booking_summary (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  regime jsonb, sectors jsonb, pies jsonb, limits jsonb, totals jsonb, notes jsonb, updated_at timestamptz default now()
);

create table public.strategy_recommendations (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_number integer, total_suggested numeric, on_track boolean, annualised_return numeric,
  recommendations jsonb, notes jsonb, updated_at timestamptz default now(), weeks_in_month integer,
  weekly_budget numeric, market_mood jsonb
);

create table public.returns_summary (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  xirr_pct numeric, annualised_pct numeric, total_return_pct numeric, yearly_breakdown jsonb,
  monthly_breakdown jsonb, updated_at timestamptz default now(), details jsonb
);

create table public.realised_pnl (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_id text, ticker text, display text, filled_date date, quantity numeric, fill_price numeric,
  avg_cost numeric, realised_pnl numeric, realised_pnl_pct numeric, side text, created_at timestamptz default now(),
  unique (user_id, order_id)
);

create table public.dividends (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reference text, ticker text, display text, paid_date date, amount numeric, created_at timestamptz default now(),
  unique (user_id, reference)
);

create table public.t212_orders (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete cascade,
  id text not null, order_id text, ticker text, side text, status text, filled_at timestamptz, quantity numeric,
  price numeric, net_value numeric, realised_pnl numeric, fx_rate numeric, raw jsonb not null,
  first_seen timestamptz default now(), last_seen timestamptz default now(),
  primary key (user_id, id)
);
create index on public.t212_orders(user_id, filled_at);

create table public.t212_dividends (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete cascade,
  reference text not null, ticker text, paid_on timestamptz, amount numeric, quantity numeric, type text,
  raw jsonb not null, first_seen timestamptz default now(), last_seen timestamptz default now(),
  primary key (user_id, reference)
);

create table public.t212_transactions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete cascade,
  reference text not null, type text, amount numeric, date_time timestamptz, raw jsonb not null,
  first_seen timestamptz default now(), last_seen timestamptz default now(),
  primary key (user_id, reference)
);

create table public.t212_sync_state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  connection_id uuid references public.broker_connections(id) on delete cascade,
  endpoint text not null, last_run timestamptz, last_full timestamptz, items_total integer, status text, detail text,
  primary key (user_id, endpoint)
);

create table public.value_buy_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null, display text, pie text, currency_symbol text default '£', score integer,
  score_max integer default 100, verdict text, entry_zones jsonb default '[]', scorecard jsonb default '[]',
  earnings jsonb default '{}', warning text, notes text, updated_at timestamptz default now(),
  this_week jsonb default '{}',
  unique (user_id, ticker)
);

create table public.watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null, name text, currency text, exchange text, added_at timestamptz default now(),
  t212_ticker text, type text, category text not null default 'stock' check (category in ('stock','commodity','crypto')),
  alternatives jsonb,
  unique (user_id, ticker)
);

create table public.watchlist_analysis (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ticker text not null, updated_at timestamptz default now(), status text, verdict text, data jsonb,
  primary key (user_id, ticker),
  foreign key (user_id, ticker) references public.watchlist(user_id, ticker) on delete cascade
);

create table public.pie_history (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pie text not null, updated_at timestamptz default now(), series jsonb not null,
  primary key (user_id, pie)
);

-- ═══ Row level security, grants, sign-up trigger ═════════════════════════
-- Start from nothing for API roles, then grant back only what users need.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
declare t text;
begin
  -- Tenant tables: a signed-in user can read only their own rows.
  foreach t in array array['alerts','portfolio_snapshots','positions','holding_decisions','profit_booking',
    'profit_booking_summary','strategy_recommendations','returns_summary','realised_pnl','dividends',
    't212_orders','t212_dividends','t212_transactions','t212_sync_state','value_buy_scores','watchlist',
    'watchlist_analysis','pie_history','broker_connections']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- Shared market-wide tables: readable by any signed-in user, writable only by the service role.
  foreach t in array array['instruments','analyst_ratings','institutional_flow_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed-in read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Secrets and job queue: RLS on, no policies, no grants => service role only.
alter table public.broker_secrets enable row level security;
alter table public.sync_jobs enable row level security;

-- Profiles: read and edit your own.
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name, base_currency, timezone, ntfy_topic, email_alerts) on public.profiles to authenticated;

-- Alerts: users may mark their own alerts read, dismissed or archived (no other column).
create policy "own alerts update" on public.alerts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant update (read_at, archived_at, dismissed_at) on public.alerts to authenticated;

-- Watchlist: users manage their own.
create policy "own watchlist insert" on public.watchlist for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own watchlist update" on public.watchlist for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own watchlist delete" on public.watchlist for delete to authenticated using (user_id = (select auth.uid()));
grant insert, update, delete on public.watchlist to authenticated;
grant usage on sequence public.watchlist_id_seq to authenticated;

-- Every new sign-up gets a profile automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

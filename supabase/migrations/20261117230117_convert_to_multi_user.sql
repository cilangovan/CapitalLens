-- Supabase migration 20261117230117 "convert_to_multi_user" — exported from supabase_migrations.schema_migrations
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text, base_currency text not null default 'GBP', timezone text not null default 'Europe/London',
  ntfy_topic text, email_alerts boolean not null default true, is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.profiles(user_id, display_name) select id, split_part(email,'@',1) from auth.users on conflict do nothing;

create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  broker text not null check (broker in ('trading212','zerodha','mock')),
  label text not null, native_currency text not null default 'GBP',
  status text not null default 'pending' check (status in ('pending','active','error','needs_login','disabled')),
  last_ok_at timestamptz, last_error text, created_at timestamptz not null default now()
);
create index if not exists broker_connections_user on public.broker_connections(user_id);
create table if not exists public.broker_secrets (
  connection_id uuid primary key references public.broker_connections(id) on delete cascade,
  ciphertext bytea, key_hint text, created_at timestamptz not null default now()
);
create table if not exists public.sync_jobs (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.broker_connections(id) on delete cascade,
  kind text not null, next_run_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued','running','done','failed')),
  attempts integer not null default 0, last_error text
);
create index if not exists sync_jobs_state_idx on public.sync_jobs(state, next_run_at);

do $$
declare t text; owner constant uuid := 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97';
begin
  foreach t in array array['alerts','dividends','holding_decisions','pie_history','portfolio_snapshots','portfolio_snapshots_archive',
    'positions','positions_archive','profit_booking','profit_booking_summary','realised_pnl','returns_summary',
    'strategy_recommendations','t212_dividends','t212_orders','t212_sync_state','t212_transactions','value_buy_scores',
    'watchlist','watchlist_analysis']
  loop
    execute format('alter table public.%I add column if not exists user_id uuid', t);
    execute format('update public.%I set user_id = %L where user_id is null', t, owner);
    execute format('alter table public.%I alter column user_id set default coalesce(auth.uid(), %L::uuid)', t, owner);
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users(id) on delete cascade', t, t || '_user_fk');
    execute format('create index if not exists %I on public.%I(user_id)', t || '_user_idx', t);
  end loop;
end $$;

alter table public.portfolio_snapshots add column connection_id uuid references public.broker_connections(id) on delete cascade;
alter table public.portfolio_snapshots_archive add column connection_id uuid references public.broker_connections(id) on delete cascade;
alter table public.positions add column broker text not null default 'trading212', add column native_currency text not null default 'GBP';
alter table public.positions_archive add column broker text not null default 'trading212', add column native_currency text not null default 'GBP';
alter table public.t212_orders add column connection_id uuid references public.broker_connections(id) on delete cascade;
alter table public.t212_dividends add column connection_id uuid references public.broker_connections(id) on delete cascade;
alter table public.t212_transactions add column connection_id uuid references public.broker_connections(id) on delete cascade;

create or replace function public.purge_connection_archive() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.positions_archive where snapshot_id in (select id from public.portfolio_snapshots_archive where connection_id = old.id);
  delete from public.portfolio_snapshots_archive where connection_id = old.id;
  return old;
end $$;
revoke all on function public.purge_connection_archive() from public, anon, authenticated;
create trigger broker_connections_purge_archive before delete on public.broker_connections for each row execute function public.purge_connection_archive();

create unique index if not exists t212_orders_user_id_key on public.t212_orders(user_id, id);
create unique index if not exists t212_dividends_user_ref_key on public.t212_dividends(user_id, reference);
create unique index if not exists t212_transactions_user_ref_key on public.t212_transactions(user_id, reference);
create unique index if not exists dividends_user_ref_key on public.dividends(user_id, reference);
create unique index if not exists realised_pnl_user_order_key on public.realised_pnl(user_id, order_id);
create unique index if not exists holding_decisions_user_key on public.holding_decisions(user_id, report_date, ticker);
create unique index if not exists profit_booking_user_ticker_key on public.profit_booking(user_id, ticker);
create unique index if not exists watchlist_user_ticker_key on public.watchlist(user_id, ticker);
create unique index if not exists watchlist_analysis_user_ticker_key on public.watchlist_analysis(user_id, ticker);
create unique index if not exists pie_history_user_pie_key on public.pie_history(user_id, pie);
create unique index if not exists t212_sync_state_user_ep_key on public.t212_sync_state(user_id, endpoint);

create or replace view public.portfolio_snapshots_all with (security_invoker = true) as
  select id, created_at, total_value, cash, invested, total_ppl, run_count, raw, user_id, connection_id from public.portfolio_snapshots
  union all
  select id, created_at, total_value, cash, invested, total_ppl, run_count, raw, user_id, connection_id from public.portfolio_snapshots_archive;
create or replace view public.positions_all with (security_invoker = true) as
  select id, snapshot_id, created_at, ticker, display, pie, current_price, avg_price, gain_pct, dip_from_high, ppl, exchange, quantity,
         user_id, broker, native_currency from public.positions
  union all
  select id, snapshot_id, created_at, ticker, display, pie, current_price, avg_price, gain_pct, dip_from_high, ppl, exchange, quantity,
         user_id, broker, native_currency from public.positions_archive;

create or replace function public.archive_portfolio_history(keep_days integer default 45) returns json
language plpgsql set search_path to 'public' as $$
declare ids bigint[]; n_pos int;
begin
  if keep_days < 7 then raise exception 'keep_days must be >= 7'; end if;
  select coalesce(array_agg(id), '{}') into ids from portfolio_snapshots
   where created_at < now() - make_interval(days => keep_days)
     and id not in (select max(id) from portfolio_snapshots group by user_id, connection_id);
  if cardinality(ids) = 0 then return json_build_object('snapshots', 0, 'positions', 0); end if;
  insert into portfolio_snapshots_archive select * from portfolio_snapshots where id = any(ids) on conflict (id) do nothing;
  insert into positions_archive select * from positions where snapshot_id = any(ids) on conflict (id) do nothing;
  get diagnostics n_pos = row_count;
  delete from positions where snapshot_id = any(ids);
  delete from portfolio_snapshots where id = any(ids);
  return json_build_object('snapshots', cardinality(ids), 'positions', n_pos, 'cutoff', now() - make_interval(days => keep_days));
end $$;

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['alerts','dividends','holding_decisions','pie_history','portfolio_snapshots','portfolio_snapshots_archive',
    'positions','positions_archive','profit_booking','profit_booking_summary','realised_pnl','returns_summary',
    'strategy_recommendations','t212_dividends','t212_orders','t212_sync_state','t212_transactions','value_buy_scores',
    'watchlist','watchlist_analysis','broker_connections']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows read" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['instruments','analyst_ratings','institutional_flow_reports']
  loop
    execute format('create policy "signed-in read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant select on public.portfolio_snapshots_all, public.positions_all to authenticated;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name, base_currency, timezone, ntfy_topic, email_alerts) on public.profiles to authenticated;
create policy "own alerts update" on public.alerts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant update (read_at, archived_at, dismissed_at) on public.alerts to authenticated;
alter table public.broker_secrets enable row level security;
alter table public.sync_jobs enable row level security;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

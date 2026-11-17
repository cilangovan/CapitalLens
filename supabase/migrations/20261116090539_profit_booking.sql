-- Supabase migration 20261116090539 "profit_booking" — exported from supabase_migrations.schema_migrations
alter table positions add column if not exists quantity numeric;

create table if not exists profit_booking (
  id             bigserial primary key,
  ticker         text unique not null,
  display        text,
  yahoo_ticker   text,
  pie            text,
  kind           text,            -- stock | etf
  sector         text,
  value_gbp      numeric,
  weight_pct     numeric,
  gain_pct       numeric,
  score          int,
  breakdown      jsonb,
  action         text,
  action_level   text,            -- run | hold | trim | reassess | rebalance
  trim_plan      jsonb,
  trailing_stop  numeric,
  stop_distance_pct numeric,
  max_position_gbp numeric,
  rel_volume     numeric,
  signals        jsonb,
  notes          jsonb,
  updated_at     timestamptz default now()
);
alter table profit_booking enable row level security;
drop policy if exists "allow all" on profit_booking;
create policy "allow all" on profit_booking for all using (true) with check (true);

create table if not exists profit_booking_summary (
  id          bigserial primary key,
  regime      jsonb,
  sectors     jsonb,
  pies        jsonb,
  limits      jsonb,
  totals      jsonb,
  notes       jsonb,
  updated_at  timestamptz default now()
);
alter table profit_booking_summary enable row level security;
drop policy if exists "allow all" on profit_booking_summary;
create policy "allow all" on profit_booking_summary for all using (true) with check (true);

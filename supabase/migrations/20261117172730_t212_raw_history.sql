-- Supabase migration 20261117172730 "t212_raw_history" — exported from supabase_migrations.schema_migrations
-- Raw Trading 212 history, stored exactly as received. Append-only: rows are never deleted by any job.
create table if not exists public.t212_orders (
  id              text primary key,          -- fill id (or 'order:<id>' for orders without a fill)
  order_id        text,
  ticker          text,
  side            text,                      -- BUY | SELL
  status          text,
  filled_at       timestamptz,
  quantity        numeric,
  price           numeric,                   -- fill price in the instrument currency
  net_value       numeric,                   -- account-currency (£) impact of the fill
  realised_pnl    numeric,                   -- £, from T212 walletImpact
  fx_rate         numeric,
  raw             jsonb not null,
  first_seen      timestamptz default now(),
  last_seen       timestamptz default now()
);
create index if not exists t212_orders_ticker_filled_idx on public.t212_orders (ticker, filled_at);
create index if not exists t212_orders_filled_idx on public.t212_orders (filled_at);

create table if not exists public.t212_dividends (
  reference   text primary key,
  ticker      text,
  paid_on     timestamptz,
  amount      numeric,                       -- £
  quantity    numeric,
  type        text,
  raw         jsonb not null,
  first_seen  timestamptz default now(),
  last_seen   timestamptz default now()
);
create index if not exists t212_dividends_paid_idx on public.t212_dividends (paid_on);

create table if not exists public.t212_transactions (
  reference   text primary key,
  type        text,                          -- DEPOSIT | WITHDRAW | FEE | TRANSFER …
  amount      numeric,                       -- £ (+ in, − out)
  date_time   timestamptz,
  raw         jsonb not null,
  first_seen  timestamptz default now(),
  last_seen   timestamptz default now()
);
create index if not exists t212_transactions_dt_idx on public.t212_transactions (date_time);

create table if not exists public.t212_sync_state (
  endpoint     text primary key,
  last_run     timestamptz,
  last_full    timestamptz,
  items_total  int,
  status       text,
  detail       text
);

comment on table public.t212_orders is 'Raw Trading 212 order/fill history (append-only, never deleted). Source for rebuilt holdings history.';
comment on table public.t212_dividends is 'Raw Trading 212 dividend history (append-only).';
comment on table public.t212_transactions is 'Raw Trading 212 cash transactions — deposits, withdrawals, fees (append-only).';

do $$ declare t text; begin
  foreach t in array array['t212_orders','t212_dividends','t212_transactions','t212_sync_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

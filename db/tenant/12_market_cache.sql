-- Central cache of PUBLIC market data for a curated set of popular symbols (config/popular_tickers.json).
-- Holds raw Yahoo chart/info/detail JSON only: no customer data, no per-user rows. Browsers read it first and fall back to the relay.
create table if not exists public.market_cache (
  key text primary key,                 -- chart:<SYM>:<range> | info:<SYM> | detail:<SYM>
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.market_cache enable row level security;
drop policy if exists "signed-in read" on public.market_cache;
create policy "signed-in read" on public.market_cache for select to authenticated using (true);
grant select on public.market_cache to authenticated;
-- writes: service role only (no insert/update policy for authenticated)

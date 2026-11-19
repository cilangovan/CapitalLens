-- IPO watch: PUBLIC market calendar shared by every user (no customer data, no per-user rows).
-- start_date / end_date = the subscription (book-building) window: opens / closes. US deals have no public window, so
-- start = roadshow launch and end = expected pricing date. listing_date = first day of trading.
-- rating = a third-party view of the deal (Subscribe / Neutral / Avoid) with its source; "Not rated" when no source rates it.
create table if not exists public.ipo_calendar (
  id            text primary key,                                   -- <market>:<ticker or slug>, e.g. US:ANT
  market        text not null check (market in ('US','UK','IN','HK','EU','JP','CN','SG','AU','OTHER')),
  exchange      text,                                               -- where it lists, e.g. Nasdaq, LSE, NSE SME
  name          text not null,
  ticker        text,
  sector        text,
  status        text not null default 'upcoming'
                check (status in ('rumoured','filed','upcoming','open','priced','listed','postponed','withdrawn')),
  start_date    date,
  end_date      date,
  listing_date  date,
  currency      text,
  price_low     numeric,
  price_high    numeric,
  deal_size_usd numeric,
  rating        text not null default 'Not rated' check (rating in ('Subscribe','Neutral','Avoid','Not rated')),
  rating_source text,
  note          text,
  source_name   text,
  source_url    text check (source_url is null or source_url ~ '^https?://'),
  as_of         date not null default current_date,
  updated_at    timestamptz not null default now()
);
create index if not exists ipo_calendar_market_start on public.ipo_calendar (market, start_date);
alter table public.ipo_calendar enable row level security;
drop policy if exists "signed-in read" on public.ipo_calendar;
create policy "signed-in read" on public.ipo_calendar for select to authenticated using (true);
revoke all on public.ipo_calendar from anon, authenticated;
grant select on public.ipo_calendar to authenticated;
grant all on public.ipo_calendar to service_role;
-- writes: service role only (the ipo_calendar workflow); no insert/update policy for authenticated

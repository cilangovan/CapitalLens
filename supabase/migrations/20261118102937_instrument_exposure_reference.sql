-- Supabase migration 20261118102937 "instrument_exposure_reference" — exported from supabase_migrations.schema_migrations
-- Global reference data (not tenant data): full display name, flag and "what it is" per Trading 212 ticker.
-- Readable by any signed-in user, writable only by service_role / migrations. No per-user rows, so nothing to leak between tenants.
create table if not exists public.instrument_exposure (
  ticker       text primary key,
  display_name text not null,
  flag         text not null default '',
  exposure     text not null default '',
  updated_at   timestamptz not null default now()
);
alter table public.instrument_exposure enable row level security;
drop policy if exists "signed-in read" on public.instrument_exposure;
create policy "signed-in read" on public.instrument_exposure for select to authenticated using (true);
revoke all on public.instrument_exposure from anon, authenticated;
grant select on public.instrument_exposure to authenticated;
grant all on public.instrument_exposure to service_role;
comment on table public.instrument_exposure is 'Reference data: full name, country/market flag and one-line description per Trading 212 ticker. Read-only for users; maintained by migrations/service role.';

insert into public.instrument_exposure (ticker, display_name, flag, exposure) values
 ('SMGBl_EQ','VanEck Semiconductor UCITS ETF','🇺🇸','US-listed semiconductor companies'),
 ('QDVEd_EQ','iShares S&P 500 Information Technology Sector UCITS ETF (Acc)','🇺🇸','US large-cap tech'),
 ('SXRVd_EQ','iShares NASDAQ 100 UCITS ETF (Acc)','🇺🇸','US large-cap growth / tech'),
 ('JEPQl_EQ','JPMorgan Nasdaq Equity Premium Income Active UCITS ETF (USD Dist)','🇺🇸','Nasdaq income fund'),
 ('JEQPl_EQ','JPMorgan Nasdaq Equity Premium Income Active UCITS ETF (GBP Dist)','🇺🇸','Nasdaq income fund'),
 ('VUSAa_EQ','Vanguard S&P 500 UCITS ETF (Dist)','🇺🇸','US large-cap'),
 ('VWCEd_EQ','Vanguard FTSE All-World UCITS ETF (Acc)','🌍','Global equities'),
 ('VEVEl_EQ','Vanguard FTSE Developed World UCITS ETF (Dist)','🌍','Developed markets'),
 ('SPYId_EQ','SPDR MSCI All Country World Investable Market UCITS ETF (Acc)','🌍','Global equities'),
 ('IWFVl_EQ','iShares Edge MSCI World Value Factor UCITS ETF (Acc)','🌍','Global value factor'),
 ('VFEMl_EQ','Vanguard FTSE Emerging Markets UCITS ETF (Dist)','🌏','Emerging markets'),
 ('CYSEl_EQ','WisdomTree Cybersecurity UCITS ETF (USD Acc)','🌐','Cybersecurity theme'),
 ('GNOGl_EQ','Global X Genomics & Biotechnology UCITS ETF (USD Acc)','🌐','Genomics / biotech theme'),
 ('DRDRl_EQ','iShares Healthcare Innovation UCITS ETF (Acc)','🌐','Healthcare innovation theme'),
 ('INTLl_EQ','WisdomTree Artificial Intelligence UCITS ETF (USD Acc)','🌐','AI theme'),
 ('WCOBl_EQ','WisdomTree Enhanced Commodity UCITS ETF (USD Acc)','🛢️','Broad commodities'),
 ('FLRKl_EQ','Franklin FTSE Korea UCITS ETF (Acc)','🇰🇷','South Korea'),
 ('IAEXl_EQ','iShares AEX (Dist)','🇳🇱','Netherlands'),
 ('IPOLl_EQ','iShares MSCI Poland (Acc)','🇵🇱','Poland'),
 ('ITWNl_EQ','iShares MSCI Taiwan (Dist)','🇹🇼','Taiwan'),
 ('XDAXl_EQ','Xtrackers DAX (Acc)','🇩🇪','Germany'),
 ('CS1l_EQ','Amundi IBEX 35 (Acc)','🇪🇸','Spain'),
 ('IMIBl_EQ','iShares FTSE MIB (Dist)','🇮🇹','Italy'),
 ('SGLNl_EQ','iShares Physical Gold','🥇','Physical gold'),
 ('SSLNl_EQ','iShares Physical Silver','🥈','Physical silver'),
 ('NVDA_US_EQ','NVIDIA Corporation','🇺🇸',''),
 ('MSFT_US_EQ','Microsoft Corporation','🇺🇸',''),
 ('AAPL_US_EQ','Apple Inc.','🇺🇸',''),
 ('GOOGL_US_EQ','Alphabet Inc. (Class A)','🇺🇸',''),
 ('FB_US_EQ','Meta Platforms, Inc.','🇺🇸',''),
 ('AMZN_US_EQ','Amazon.com, Inc.','🇺🇸',''),
 ('SPCX_US_EQ','SpaceX','🇺🇸','')
on conflict (ticker) do update set display_name=excluded.display_name, flag=excluded.flag, exposure=excluded.exposure, updated_at=now();

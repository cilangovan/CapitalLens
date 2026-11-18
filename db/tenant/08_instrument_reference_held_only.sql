-- Reference data about instruments (not tenant data). A signed-in user can only read rows for instruments they hold,
-- so no tenant can learn what another tenant owns. Writes: service_role / migrations only.
alter table public.instrument_exposure add column if not exists sector text not null default '';

create table if not exists public.instrument_country_weights (
  ticker text not null, country text not null, flag text not null default '',
  pct numeric not null, note text not null default '', primary key (ticker, country));
create table if not exists public.instrument_sector_weights (
  ticker text not null, sector text not null, pct numeric, note text not null default '',
  primary key (ticker, sector));

do $$ declare t text; begin
  foreach t in array array['instrument_exposure','instrument_country_weights','instrument_sector_weights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "signed-in read" on public.%I', t);
    execute format('drop policy if exists "read held instruments" on public.%I', t);
    execute format($p$create policy "read held instruments" on public.%I for select to authenticated
      using (exists (select 1 from public.positions p where p.ticker = %I.ticker)
          or exists (select 1 from public.watchlist w where w.t212_ticker = %I.ticker))$p$, t, t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

update public.instrument_exposure e set sector = v.sector from (values
 ('NVDA_US_EQ','Technology'),('MSFT_US_EQ','Technology'),('AAPL_US_EQ','Technology'),('GOOGL_US_EQ','Technology'),
 ('FB_US_EQ','Technology'),('AMZN_US_EQ','Technology'),('SPCX_US_EQ','Technology'),('QDVEd_EQ','Technology'),
 ('SGLNl_EQ','Commodities'),('SSLNl_EQ','Commodities'),
 ('VUSAa_EQ','Broad Market'),('VWCEd_EQ','Broad Market'),('SXRVd_EQ','Broad Market'),('VEVEl_EQ','Broad Market'),('SPYId_EQ','Broad Market'),
 ('VFEMl_EQ','Emerging Markets'),('JEPQl_EQ','Income'),('JEQPl_EQ','Income'),
 ('IWFVl_EQ','Thematic / Factor'),('CYSEl_EQ','Thematic / Factor'),('GNOGl_EQ','Thematic / Factor'),('FLRKl_EQ','Thematic / Factor'),
 ('DRDRl_EQ','Thematic / Factor'),('WCOBl_EQ','Thematic / Factor'),('INTLl_EQ','Thematic / Factor'),('SMGBl_EQ','Thematic / Factor'),
 ('IAEXl_EQ','Country / Regional'),('IPOLl_EQ','Country / Regional'),('ITWNl_EQ','Country / Regional'),
 ('XDAXl_EQ','Country / Regional'),('CS1l_EQ','Country / Regional'),('IMIBl_EQ','Country / Regional')
) as v(ticker,sector) where e.ticker = v.ticker;

insert into public.instrument_country_weights (ticker,country,flag,pct,note) values
 ('QDVEd_EQ','USA','🇺🇸',100,'AAPL·NVDA·MSFT·GOOGL·AMZN'),
 ('ITWNl_EQ','Taiwan','🇹🇼',100,'TSMC 32%·MediaTek 8%'),
 ('IMIBl_EQ','Italy','🇮🇹',100,'UniCredit·Intesa·Eni·Enel'),
 ('IPOLl_EQ','Poland','🇵🇱',100,'PKO·Pekao·mBank·Orlen'),
 ('XDAXl_EQ','Germany','🇩🇪',100,'Siemens·Allianz·SAP·Airbus'),
 ('IAEXl_EQ','Netherlands','🇳🇱',100,'ASML·Shell·ING·Unilever·Adyen'),
 ('CS1l_EQ','Spain','🇪🇸',100,'Santander·Iberdrola·BBVA·Inditex'),
 ('VUSAa_EQ','USA','🇺🇸',100,'500 largest US companies'),
 ('SXRVd_EQ','USA','🇺🇸',100,'NVDA·AAPL·MSFT·AMZN·AVGO'),
 ('VWCEd_EQ','USA','🇺🇸',63,'S&P 500 dominant'),
 ('VWCEd_EQ','Japan','🇯🇵',6,'Large cap'),
 ('VWCEd_EQ','UK','🇬🇧',4,'Large cap'),
 ('VWCEd_EQ','China','🇨🇳',3,'Alibaba·Tencent'),
 ('VWCEd_EQ','Other','🌍',24,'EM + other DM'),
 ('SGLNl_EQ','Gold','🥇',100,'Physical gold backed'),
 ('SSLNl_EQ','Silver','🥈',100,'Physical silver backed')
on conflict (ticker,country) do update set flag=excluded.flag, pct=excluded.pct, note=excluded.note;

insert into public.instrument_sector_weights (ticker,sector,pct,note) values
 ('QDVEd_EQ','Technology',100,'US Tech (AAPL/NVDA/MSFT)'),('ITWNl_EQ','Technology',100,'Taiwan semis (TSMC 32%)'),
 ('VUSAa_EQ','Technology',30,'Tech'),('VWCEd_EQ','Technology',25,'Tech'),('XDAXl_EQ','Technology',12,'Software (SAP)'),('IAEXl_EQ','Technology',19,'Semis (ASML)'),
 ('NVDA_US_EQ','Technology',100,''),('MSFT_US_EQ','Technology',100,''),('AAPL_US_EQ','Technology',100,''),('GOOGL_US_EQ','Technology',100,''),
 ('FB_US_EQ','Technology',100,''),('AMZN_US_EQ','Technology',100,''),('SPCX_US_EQ','Technology',100,''),
 ('IMIBl_EQ','Financials',34,'Italian banks (UniCredit/Intesa)'),('IPOLl_EQ','Financials',36,'Polish banks (PKO/Pekao/mBank)'),
 ('IAEXl_EQ','Financials',19,'Dutch finance (ING/Adyen/ABN)'),('XDAXl_EQ','Financials',22,'Finance (Allianz)'),
 ('VUSAa_EQ','Financials',14,'Financials'),('VWCEd_EQ','Financials',16,'Financials'),('CS1l_EQ','Financials',13,'Financials'),
 ('VUSAa_EQ','Healthcare',13,'Healthcare'),('VWCEd_EQ','Healthcare',12,'Healthcare'),('CS1l_EQ','Healthcare',14,'Healthcare'),('XDAXl_EQ','Healthcare',7,'Healthcare'),
 ('IAEXl_EQ','Consumer Staples',24,'Consumer Staples (Unilever/Ahold)'),('VUSAa_EQ','Consumer Staples',6,'Consumer Staples'),('VWCEd_EQ','Consumer Staples',7,'Consumer Essentials'),
 ('IMIBl_EQ','Energy',7,'Energy (Eni)'),('IPOLl_EQ','Energy',14,'Energy (Orlen)'),('IAEXl_EQ','Energy',16,'Energy (Shell)'),('VUSAa_EQ','Energy',4,'Energy'),
 ('XDAXl_EQ','Industrials',30,'Industrials (Siemens/Airbus)'),('VWCEd_EQ','Industrials',5,'Industrials'),
 ('VUSAa_EQ','Comm Services',9,'Comm Services'),('VWCEd_EQ','Comm Services',8,'Comm Services'),('XDAXl_EQ','Comm Services',5,'Comm Services'),
 ('SGLNl_EQ','Gold',100,'Gold'),('SSLNl_EQ','Silver',100,'Silver')
on conflict (ticker,sector) do update set pct=excluded.pct, note=excluded.note;

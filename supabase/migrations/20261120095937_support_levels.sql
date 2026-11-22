-- Supabase migration 20261120095937 "support_levels" — exported from supabase_migrations.schema_migrations
create table if not exists public.support_levels (
  symbol             text primary key check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),
  name               text not null,
  level_label        text not null default 'Support zone' check (level_label in ('Support zone','Support level','My level','Wait for')),
  zone_low           numeric not null check (zone_low > 0),
  zone_high          numeric not null check (zone_high >= zone_low),
  approx             boolean not null default false,
  currency           text not null default 'USD',
  tags               jsonb not null default '[]'::jsonb,
  snap_price         numeric,
  snap_pct_from_high numeric,
  note               text,
  source_name        text not null,
  source_url         text check (source_url is null or source_url ~ '^https?://'),
  as_of              date not null default current_date,
  updated_at         timestamptz not null default now()
);
alter table public.support_levels enable row level security;
drop policy if exists "signed-in read" on public.support_levels;
create policy "signed-in read" on public.support_levels for select to authenticated using (true);
revoke all on public.support_levels from anon, authenticated;
grant select on public.support_levels to authenticated;
grant all on public.support_levels to service_role;

insert into public.support_levels (symbol, name, level_label, zone_low, zone_high, approx, tags, snap_price, snap_pct_from_high, source_name, as_of) values
  ('META', 'Meta Platforms', 'Support zone', 550, 560, false, '[{"t":"Crucial support zone","tone":"warn"}]', 596.22, -25, 'KwickScan.com', '2026-11-20'),
  ('BE',   'Bloom Energy',   'My level',     155, 165, false, '[{"t":"Important zone","tone":"warn"}]',        168.11, -52, 'KwickScan.com', '2026-11-20'),
  ('HOOD', 'Robinhood',      'Support zone',  65,  70, false, '[{"t":"Previous breakout zone","tone":"good"}]', 68.65,  -55, 'KwickScan.com', '2026-11-20'),
  ('INTC', 'Intel',          'Support level', 51,  52, false, '[{"t":"200-week EMA","tone":"neutral"},{"t":"Previous breakout","tone":"neutral"}]', 55.72, -60, 'KwickScan.com', '2026-11-20'),
  ('NVDA', 'NVIDIA',         'Support zone', 138, 140, false, '[{"t":"200-week EMA","tone":"neutral"},{"t":"Upsloping support","tone":"neutral"}]', 145.98, -40, 'KwickScan.com', '2026-11-20'),
  ('QCOM', 'Qualcomm',       'Support zone', 150, 160, false, '[{"t":"Sitting on the trendline","tone":"warn"}]', 162.01, -37, 'KwickScan.com', '2026-11-20'),
  ('CRM',  'Salesforce',     'Wait for',     150, 150, false, '[{"t":"In free fall","tone":"bad"},{"t":"Not touching it before $150","tone":"neutral"}]', 183.31, -50, 'KwickScan.com', '2026-11-20'),
  ('NOW',  'ServiceNow',     'Support zone',  80,  83, false, '[{"t":"Crucial trendline","tone":"warn"}]',     88.87,  -63, 'KwickScan.com', '2026-11-20'),
  ('ORCL', 'Oracle',         'Support zone',  97, 100, true,  '[]', null, null, 'KwickScan.com', '2026-11-20'),
  ('AMZN', 'Amazon',         'Support zone', 225, 225, true,  '[]', null, null, 'KwickScan.com', '2026-11-20'),
  ('TSLA', 'Tesla',          'Support zone', 330, 330, true,  '[]', null, null, 'KwickScan.com', '2026-11-20')
on conflict (symbol) do update set name = excluded.name, level_label = excluded.level_label, zone_low = excluded.zone_low, zone_high = excluded.zone_high, approx = excluded.approx,
  tags = excluded.tags, snap_price = excluded.snap_price, snap_pct_from_high = excluded.snap_pct_from_high, source_name = excluded.source_name, as_of = excluded.as_of, updated_at = now();

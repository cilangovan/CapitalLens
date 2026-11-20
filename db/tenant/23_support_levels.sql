-- Support Levels (Strategy tab, under Entry Analysis): where a stock you HOLD is likely to find support, with live status and commentary.
-- PUBLIC reference data shared by every user (no customer data, no per-user rows). Which levels are shown is decided in the browser by matching
-- symbol against the user's own positions, so what you hold never leaves your device.
-- The levels are an external analyst view, not our calculation: every row names its source and the day it was captured (as_of).
-- snap_price / snap_pct_from_high are the price and "% from high" shown by the source on as_of; the dashboard compares the LIVE price
-- (value_buy_scores) with the zone and labels the snapshot as a snapshot.
create table if not exists public.support_levels (
  symbol             text primary key check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),   -- Yahoo-style symbol, e.g. META (T212 META_US_EQ / FB_US_EQ both map here)
  name               text not null,
  level_label        text not null default 'Support zone' check (level_label in ('Support zone','Support level','My level','Wait for')),
  zone_low           numeric not null check (zone_low > 0),
  zone_high          numeric not null check (zone_high >= zone_low),
  approx             boolean not null default false,                              -- the source marks it "~" (approximate)
  currency           text not null default 'USD',
  tags               jsonb not null default '[]'::jsonb,                          -- [{"t":"200-week EMA","tone":"neutral|good|warn|bad"}]
  snap_price         numeric,
  snap_pct_from_high numeric,                                                     -- negative = below the high, as shown by the source
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
-- writes: service role / owner migration only; no insert/update policy for authenticated

-- Seed: KwickScan.com "Support levels to watch", captured 20 Nov 2026 from screenshots supplied by the owner.
insert into public.support_levels (symbol, name, level_label, zone_low, zone_high, approx, tags, snap_price, snap_pct_from_high, source_name, as_of) values
  ('META', 'Meta Platforms', 'Support zone', 550, 560, false, '[{"t":"Crucial support zone","tone":"warn"}]', 596.22, -25, 'KwickScan.com', '2026-11-20'),
  ('BE',   'Bloom Energy',   'My level',     155, 165, false, '[{"t":"Important zone","tone":"warn"}]',        168.11, -52, 'KwickScan.com', '2026-11-20'),
  ('HOOD', 'Robinhood',      'Support zone',  65,  70, false, '[{"t":"Previous breakout zone","tone":"good"}]', 68.65,  -55, 'KwickScan.com', '2026-11-20'),
  ('INTC', 'Intel',          'Support level', 51,  52, false, '[{"t":"200-week EMA","tone":"neutral"},{"t":"Previous breakout","tone":"neutral"}]', 55.72, -60, 'KwickScan.com', '2026-11-20'),
  ('NVDA', 'NVIDIA',         'Support zone', 138, 140, false, '[{"t":"200-week EMA","tone":"neutral"},{"t":"Upsloping support","tone":"neutral"}]', 145.98, -40, 'KwickScan.com', '2026-11-20'),
  ('QCOM', 'Qualcomm',       'Support zone', 150, 160, false, '[{"t":"Sitting on the trendline","tone":"warn"}]', 162.01, -37, 'KwickScan.com', '2026-11-20'),
  ('CRM',  'Salesforce',     'Wait for',     150, 150, false, '[{"t":"In free fall","tone":"bad"},{"t":"Not touching it before $150","tone":"neutral"}]', 183.31, -50, 'KwickScan.com', '2026-11-20'),
  ('NOW',  'ServiceNow',     'Support zone',  80,  83, false, '[{"t":"Crucial trendline","tone":"warn"}]',     88.87,  -63, 'KwickScan.com', '2026-11-20'),
  -- listed in the source summary table only (no detail card was captured: no price snapshot or tags)
  ('ORCL', 'Oracle',         'Support zone',  97, 100, true,  '[]', null, null, 'KwickScan.com', '2026-11-20'),
  ('AMZN', 'Amazon',         'Support zone', 225, 225, true,  '[]', null, null, 'KwickScan.com', '2026-11-20'),
  ('TSLA', 'Tesla',          'Support zone', 330, 330, true,  '[]', null, null, 'KwickScan.com', '2026-11-20')
on conflict (symbol) do update set name = excluded.name, level_label = excluded.level_label, zone_low = excluded.zone_low, zone_high = excluded.zone_high, approx = excluded.approx,
  tags = excluded.tags, snap_price = excluded.snap_price, snap_pct_from_high = excluded.snap_pct_from_high, source_name = excluded.source_name, as_of = excluded.as_of, updated_at = now();

-- ── Demo: a demo-only copy (nothing invented goes into the shared table the private app reads; docs/demo/demo-shim.js maps the route) ──
-- including indexes: copies the primary key, which seed_demo_support_levels needs for ON CONFLICT (found by running the refresh against the demo project)
create table if not exists public.demo_support_levels (like public.support_levels including defaults including constraints including indexes);
alter table public.demo_support_levels enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'demo_support_levels' and policyname = 'demo_support_levels_read') then
    create policy demo_support_levels_read on public.demo_support_levels for select to anon, authenticated using (true);
  end if;
end $p$;
grant select on public.demo_support_levels to anon, authenticated;

-- Rebuilt on every daily demo refresh from the demo portfolio so every holding has a level close to its mock price. Illustrative, labelled as such.
create or replace function public.seed_demo_support_levels(p_user uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; px numeric; lo numeric; hi numeric; h numeric; pick integer;
begin
  delete from public.demo_support_levels;
  for r in select v.ticker, v.display, (v.this_week->>'current')::numeric as cur, (v.this_week->>'high_52w')::numeric as hi52
           from public.value_buy_scores v where v.user_id = p_user and v.this_week ? 'current' and v.ticker ~ '^[A-Z0-9.]{1,12}_US_EQ$' loop   -- US listings only (the table's symbol rule); LSE/Xetra ETFs have no level
    px := r.cur; if px is null or px <= 0 then continue; end if;
    h := (abs(hashtext(r.ticker)) % 100) / 100.0;
    pick := (abs(hashtext(r.ticker || 'k')) % 3);
    lo := round(px * (0.90 + h * 0.04), 2); hi := round(lo * 1.03, 2);
    insert into public.demo_support_levels (symbol, name, level_label, zone_low, zone_high, approx, currency, tags, snap_price, snap_pct_from_high, note, source_name, as_of)
      values (case when r.ticker = 'FB_US_EQ' then 'META' else regexp_replace(r.ticker, '_US_EQ$', '') end, coalesce(r.display, r.ticker), case pick when 0 then 'Support zone' when 1 then 'Support level' else 'My level' end, lo, hi, false, 'GBP',
        case pick when 0 then '[{"t":"Crucial support zone","tone":"warn"}]'::jsonb when 1 then '[{"t":"200-week EMA","tone":"neutral"}]'::jsonb else '[{"t":"Previous breakout zone","tone":"good"}]'::jsonb end,
        round(px, 2), case when r.hi52 > 0 then round((px / r.hi52 - 1) * 100) end, 'Illustrative demo level', 'Demo data', current_date)
      on conflict (symbol) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.seed_demo_support_levels(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_support_levels(uuid) to service_role;

-- hook into the daily demo refresh (idempotent: patched once)
do $f$ declare d text; begin
  d := pg_get_functiondef('public.demo_refresh()'::regprocedure);
  if position('seed_demo_support_levels' in d) = 0 then
    d := replace(d, 'mk := public.seed_demo_markets(t);', 'mk := public.seed_demo_markets(t);' || chr(10) || '  perform public.seed_demo_support_levels(t);');
    execute d;
  end if;
end $f$;

# Epic: Support Levels (Strategy › Entry Analysis)

| | |
|---|---|
| **Epic** | Support Levels for held stocks |
| **Menu** | 🎯 Strategy, directly under 🎯 Entry Analysis |
| **Requirement ID** | UI-20 ([UI requirements](ui-requirements.md)) |
| **Owner** | HOOP (`cilangovan`) · GitHub epic #48 |
| **Raised** | 20 Nov 2026 |
| **Status** | Built (incl. follow-ups #50, #51, #52), rolled out to every dashboard (live, demo, app, zkapp, zkapp-prod). Live-data behaviour not verifiable offline; see [Verification](#verification) |

## 1. Problem

Entry Analysis tells you *what the model thinks* of a stock. It does not show the price levels where buyers have stepped in before, so the owner works from screenshots of an external "support levels to watch" list and has to compare each level with the live price by hand, for the stocks they hold only.

## 2. Goal

For every stock the owner **holds**, show on the Strategy tab, right under Entry Analysis: the support zone, how the live price stands against it, a short commentary, and one summary table, so a dip can be judged against a level at a glance on a phone.

## 3. Scope

**In scope**

- Per-stock card: zone, level type, source tags, live price, distance to the zone, live 52-week drawdown, price captured by the source, commentary.
- Status per card: below the zone · in the zone · approaching (within 3% above) · above · live price unavailable.
- Summary table (stock · zone · live · status) closing the section.
- Held-only: matched against the latest positions snapshot in the browser.
- Shared public table `support_levels`, with the source and capture date on every row.
- Demo parity: a demo-only table refreshed by the daily demo refresh.
- Every dashboard, mobile first (360px / 390px), collapsible with the state remembered per user.

**Added after first release (20 Nov 2026):** stale-level warning after 14 days (#52); in-house 200-week EMA level for held US stocks that have no analyst level (#50); in-app alert when a held stock reaches or breaks its zone, evaluated on Refresh (#51). Details in the [Strategy](../menus/strategy.md) and [Alerts](../menus/alerts.md) pages.

**Out of scope (for now)**

- Computing zones from breakouts and trendlines (only the 200-week EMA is computed so far). Phone push for zone alerts (in-app inbox only, like the other alerts).
- Non-US listings (levels are in USD and matched on US tickers; other markets show nothing rather than a wrong comparison).
- A screen for editing levels. They are data, updated by an upsert migration.

## 4. User stories

| ID | Story | Acceptance criteria |
|---|---|---|
| UI-20.1 | As an investor I want only the stocks I hold, so the section is not cluttered | AC1 stocks not held are never shown; AC2 if none of my holdings has a level the section says so; AC3 matching happens in the browser |
| UI-20.2 | I want each held stock's support zone with the source's notes | AC1 zone as a range, a single value or approximate (`~$225`); AC2 source tags shown as chips (e.g. 200-week EMA, Previous breakout); AC3 source name and capture date shown |
| UI-20.3 | I want to know where the live price stands against the zone | AC1 five statuses; AC2 distance shown in % from the zone edge; AC3 a single-number level counts as "in" within 1.5%; AC4 most urgent first |
| UI-20.4 | I want a short, honest commentary | AC1 built from the numbers only (distance, my average cost against the zone, the source's tags); AC2 never instructs (no "buy now / sell now / you should"); AC3 states that levels are an external view, not advice |
| UI-20.5 | I want a summary table | AC1 one row per card: stock, zone, live, status; AC2 scrolls inside itself, never the page |
| UI-20.6 | I want the section to be honest about data | AC1 no live price → "Live price unavailable" (no fake status); AC2 live price in a different currency from the zone → not compared and says so; AC3 the source's snapshot price is labelled as captured on its date |
| UI-20.7 | I want it everywhere I look | AC1 legacy, demo, app, zkapp and zkapp-prod all load it; AC2 the demo shows illustrative levels for its mock holdings, refreshed daily; AC3 fits 320/360/390px; AC4 collapsible with the state stored per user |

## 5. How it behaves

```
🎯 Entry Analysis                 (existing)
🛡️ Support Levels                 (new, collapsible)
   Stocks you hold only · Source: KwickScan.com, captured 20 Nov 2026
   ┌────────────────────────────────────────────┐
   │ NVIDIA  NVDA                [In the zone]  │
   │ Support zone        $138–140               │
   │ [200-week EMA] [Upsloping support]         │
   │ Live $139 · inside the zone · 31% from 52w │
   │ Captured $145.98 (-40% from high)          │
   │ Price is inside $138–140 right now …       │
   └────────────────────────────────────────────┘
   … one card per held stock, most urgent first …
   Summary
   | Stock | Zone     | Live  | Status          |
💰 Weekly allocation              (existing)
```

Status logic (`SupportLevels.status`): `below` if live < zone low; `in` if inside the zone (edges included); `near` if at most 3% above the zone high; otherwise `above`; `nolive` when there is no usable live price. For a single-number level the zone is widened by 1.5% each side.

Live price, 52-week high and average cost come from the Entry Analysis rows (`value_buy_scores.this_week`, native currency), so no extra market call is made.

## 6. Data

`public.support_levels` (shared, public, read by any signed-in user; writes by the service role only): `symbol` (PK), `name`, `level_label`, `zone_low`, `zone_high`, `approx`, `currency`, `tags` (JSON `[{t, tone}]`), `snap_price`, `snap_pct_from_high`, `note`, `source_name`, `source_url`, `as_of`, `updated_at`. Reference: [Table reference](../reference/database-tables.md).

Seed, as captured from the source on 20 Nov 2026 (price and "% from high" as the source showed them that day):

| Symbol | Level | Zone | Source tags | Captured price | From high |
|---|---|---|---|---|---|
| META | Support zone | $550–560 | Crucial support zone | $596.22 | -25% |
| BE | My level | $155–165 | Important zone | $168.11 | -52% |
| HOOD | Support zone | $65–70 | Previous breakout zone | $68.65 | -55% |
| INTC | Support level | $51–52 | 200-week EMA · Previous breakout | $55.72 | -60% |
| NVDA | Support zone | $138–140 | 200-week EMA · Upsloping support | $145.98 | -40% |
| QCOM | Support zone | $150–160 | Sitting on the trendline | $162.01 | -37% |
| CRM | Wait for | $150 | In free fall · Not touching it before $150 | $183.31 | -50% |
| NOW | Support zone | $80–83 | Crucial trendline | $88.87 | -63% |
| ORCL | Support zone | ~$97–100 | summary table only | not captured | not captured |
| AMZN | Support zone | ~$225 | summary table only | not captured | not captured |
| TSLA | Support zone | ~$330 | summary table only | not captured | not captured |

Which of these appear on the dashboard depends only on what the owner actually holds at the time.

**Demo:** `demo_support_levels` is rebuilt by `seed_demo_support_levels(uuid)`, called by `demo_refresh()`, with one illustrative level per demo holding near its mock price (`source_name = 'Demo data'`). Nothing invented is written to the shared table.

## 7. Delivery

| Piece | Where |
|---|---|
| UI module | `docs/js/support.js` (loaded after `strategy.js`; placed by `docs/js/strategy.js`) |
| Styles | `.sl-*` in `docs/index.html` and `docs/demo/index.html`, carried to the generated dashboards by `scripts/build_app.py` and `scripts/build_zkapp.py` |
| Table, seed, demo copy, refresh hook | `db/tenant/23_support_levels.sql` |
| Served by | worker whitelist (`cloudflare-worker/worker.js`), private-app shared tables (`docs/zk/shim.js`), demo route map (`docs/demo/demo-shim.js`), demo parity list (`db/tenant/22_demo_parity_guard.sql`) |
| Documentation | [Strategy menu](../menus/strategy.md), [Database](../database.md), [Demo](../demo.md), this page |

## 8. Tests

| Check | File |
|---|---|
| Status logic, held-only, sort order, honesty (no live price, currency mismatch), commentary, no advice wording, escaping, placement under Entry Analysis | `tests/zk_support_levels_test.mjs` (runs in CI with every `zk_*` test) |
| Fits 320/360/390px on the live and demo pages, including a very long name and tag (the long-tag overflow found while building is guarded here) | `tests/support_layout_test.py` (CI: UI tests) |
| Alerts: transitions only, first sight records only, 24h cooldown, currency mismatch, Python parity untouched | `tests/zk_support_alert_test.mjs` |
| Shared table names its source, demo-only copy, refresh hook, module on every dashboard | `tests/standards_test.py` |

## 9. Risks, gaps and open questions

1. **Licensing.** The levels come from a third party (KwickScan.com). Showing them to other users at the planned public launch (about 100 users) needs the source's permission or a licensed or self-computed alternative. Until then the table is owner-curated. Tracked as #49 (licence research: where to look and what to ask) under "Public launch readiness", linked from #11 (licensed data before public signup) and #12 (provider research). **Findings so far (20 Nov 2026, from kwickscan.com and its Terms page, tracked as #49):** the footer reads "a product of DDI Learning"; support contact support@kwickscan.com; the site says its data comes from third-party providers, can be late, missing or wrong, and is educational only. The Terms page does **not** address redistribution, commercial use, third-party use of outputs or attribution; it says one person per account, "don't share your access", and that accounts may be suspended for scraping or misuse. Permission is therefore unresolved: ask in writing before showing the levels to other users. This is not legal advice.
2. **Staleness.** Levels are a capture on a date, not a live feed. The section prints the capture date; a level can be out of date when the market has moved. A review cadence (#52) or a computed level (#50) is the fix.
3. **Source's "high".** The "% from high" the source shows is not defined in the screenshots, so the dashboard also shows its own live drawdown from the 52-week high and labels the two differently.
4. **Held list for non-US stocks.** Matching is by US ticker; a stock held on another exchange gets no card (by design, see §3).
5. **Built as follow-ups:** zone alerts (#51), a computed 200-week EMA level (#50) and the stale warning (#52). **Still open:** breakout and trendline levels (so computed levels can replace the analyst ones entirely) and phone push for zone alerts. The computed level uses the same Yahoo-based price history as the charts, so it stays personal-use until #11/#12 are decided.
6. **Not verified:** live Supabase behaviour (the SQL file was written but not executed against a database in this build) and real-holdings behaviour (the owner's holdings are encrypted; the logic is tested with sample rows). `db/tenant/23_support_levels.sql` was applied to the production and demo projects on 20 Nov 2026 (the demo seed was run and checked; the section itself has not been checked on the live app with real holdings, press Refresh and look at Strategy).

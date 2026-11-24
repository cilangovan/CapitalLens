# Regression register (bug → guard test)

> **Generated** by `python3 tests/regression_register_test.py --write` from `tests/regression_register.json`. Edit the JSON, not this page.

Every bug that was fixed has a row here: what broke and the test that fails if it ever returns. The whole register runs in the **Regression & data quality** workflow (`.github/workflows/regression.yml`) on every push, on pull requests and nightly. Rule: a bug fix is not done until its row and its guard test are in the same commit.

**Data quality** (`tests/data_quality_test.py`) runs in the same workflow: the data files in git (popular tickers, IPO calendar, Market Mood tabs) on every push, and nightly the live shared tables (market-cache freshness, IPO calendar rules). A nightly failure opens or updates one GitHub issue, "Data quality failing". Customer data is encrypted and is never inspected.

| ID | Date | Area | What broke | Guard test | Fix commit |
|---|---|---|---|---|---|
| L01 | 2026-11-15 | ui | Two scripts declared the same top-level name (_esc); the page failed to load | `tests/regression_history_test.py` | 762729a |
| L02 | 2026-11-15 | cors | CORS: upstream headers not stripped; pre-check reply lost Allow-Headers (sign-in 'Failed to fetch') | `tests/regression_history_test.py` | 5282a13, 1c4f522 |
| L03 | 2026-11-15 | auth | PBKDF2 rounds over the Workers CPU limit made every sign-in fail | `tests/regression_history_test.py` | d523d18 |
| L04 | 2026-11-15 | worker | Worker did not fall back to SUPABASE_KEY | `tests/regression_history_test.py` | 820083c |
| L05 | 2026-11-15 | csp | api.alternative.me missing from CSP connect-src: crypto mood did not load | `tests/regression_history_test.py` | 08f35af |
| L06 | 2026-11-15 | profit | Profit tab reused a stale Overview ^GSPC cache | `tests/regression_history_test.py` | 03d0a02 |
| L07 | 2026-11-15 | overview | Last 24H card missing; all-positions P&L not labelled all-time | `tests/regression_history_test.py` | 496cf9e, c837e06 |
| L09 | 2026-11-15 | pies | Pie value/drift used the wrong Trading 212 field (fractional shares) | `tests/regression_history_test.py` | a1d1204 |
| L10 | 2026-11-15 | analyst | yfinance too old for Yahoo's auth change | `tests/regression_history_test.py` | f28a6b0 |
| L11 | 2026-11-15 | analyst | Analyst upsert failed on a 409 duplicate key | `tests/regression_history_test.py` | 6a8cdc8 |
| L12 | 2026-11-15 | holding-decisions | Duplicate positions were scored twice | `tests/regression_history_test.py` | 13ccc4a |
| L13 | 2026-11-15 | holding-decisions | Trading 212 LSE tickers (SSLNl) not converted to yfinance symbols | `tests/regression_history_test.py` | 584f6bf |
| L14 | 2026-11-15 | returns | XIRR could diverge / annualise short periods | `tests/regression_history_test.py` | fe1cbb1 |
| L15 | 2026-11-15 | history | History sync could not write (RLS) and used the wrong Trading 212 auth scheme | `tests/regression_history_test.py` | 16cdf5b, d64ba80 |
| A1d71976 | 2026-11-17 | security | Security hardening: authenticated reads, no CDN scripts, CSP, central XSS sanitiser, PBKDF2 + lockout | `tests/security_check.py` | 1d71976 |
| A89d249d | 2026-11-17 | security | Security test: dashboard site can pass the sign-in pre-check and reach login | `tests/security_check.py` | 89d249d |
| R01 | 2026-11-18 | migration | Migrated rows stored under random ids, so a re-sync wrote a second copy of everything (750 duplicate orders) | `tests/zk_dedupe_test.mjs` | 555f923 |
| R02 | 2026-11-18 | migration | analyst_ratings table was missing from the migration list (Analyst tab empty after upgrade) | `tests/zk_migrate_test.py` | 1f8b1fd |
| R03 | 2026-11-18 | sync | Migration did not carry sync_state, so Refresh walked ALL history (8+ minutes) and restarted from zero when interrupted | `tests/zk_t212sync_test.mjs` | 1f3215d |
| R04 | 2026-11-18 | deploy | GitHub Pages served new HTML with an old cached script; the integrity hash blocked the page (M.T212 is undefined) | `tests/zk_prod_pages_test.mjs` | 71d8b4c |
| R05 | 2026-11-18 | auth | Sign-up box showed a recovery key for an email that already existed, leaving several unusable keys | `tests/zk_flow_test.py` | 6efc659 |
| R06 | 2026-11-18 | data-quality | Stale snapshot looked live (Overview showed the 04:05 snapshot as if current) | `tests/zk_overview_stale_test.mjs` | bd6be84 |
| R07 | 2026-11-18 | analysis | Analysis code changed without a ZK_ANALYSIS_VERSION bump, so stored results stayed old until a manual Refresh | `tests/zk_analysis_version_test.mjs` | 6e177b6 |
| R08 | 2026-11-18 | parity | Python mirror added Unclassified Lynch rows when no fundamentals existed, breaking JS/Python analyst parity (10 failures) | `tests/zk_lynch_parity_test.mjs` | 6b1802e |
| R09 | 2026-11-18 | mobile | Header row too wide at 360px stretched the page, so fixed popups overflowed | `tests/ui_layout_test.py` | f17ba68 |
| R13 | 2026-11-18 | relay | Cloudflare Workers reject fetch redirect:'error', so every relay call failed at runtime (unit tests could not see it) | `tests/regression_guards_test.py` | 1f75722, 2ea1127 |
| R14 | 2026-11-18 | ci | popular_tickers.json was hidden by an ignore rule, so CI could not see the file the code needs | `tests/regression_guards_test.py` |  |
| R15 | 2026-11-18 | strategy | A fixed £ budget must never reappear on the Strategy tab or in any engine | `tests/zk_dipplan_test.mjs` |  |
| R16 | 2026-11-18 | auth | Sign-in box flashed on refresh before the saved-session check finished | `tests/login_flash_browser_test.py` |  |
| R17 | 2026-11-18 | sync | A cut-off pipeline run left half-written snapshots / restarted history from zero | `tests/legacy_interrupt_test.py` |  |
| R18 | 2026-11-18 | commits | Claude / Anthropic / Co-Authored-By signature in commits (owner forbids it) | `tests/standards_test.py` |  |
| R19 | 2026-11-18 | parity | Python rounds halves to even, JS away from zero: 8.5% showed as 8% in the old app and 9% in the private app | `tests/zk_lynch_parity_test.mjs` | 919461f |
| R20 | 2026-11-18 | mobile | Header too wide at 320/360/390px (also guarded without secrets, on the demo page) | `tests/demo_layout_test.py` |  |
| R21 | 2026-11-18 | migration | A customer table missing from the migration list (table inventory gate): every table classified, customer class == migrate.js TABLES | `tests/table_inventory_test.py` | 1f8b1fd |
| A5dc96cd | 2026-11-19 | general | Fix Entry Analysis blank cards in the private app: parse stored JSON columns before the quote-swapping sanitiser | `tests/zk_shim_test.mjs` | 5dc96cd |
| A5568678 | 2026-11-20 | general | Fix investments-value line: labelled axis (min 2% range), dashed gaps, buy/sell markers, tap read-out | `tests/zk_invest_line_test.mjs` | 5568678 |
| Aa34fc9f | 2026-11-20 | general | Fix support levels skipped on every refresh (x.json is not a function) (refs #53) | `tests/standards_test.py` | a34fc9f |
| A4cdb49a | 2026-11-23 | security | security: switch email digest from SendGrid to Gmail SMTP | `tests/security_email.py` | 4cdb49a |
| Ab24f8ed | 2026-11-23 | security | security: daily email digest + GitHub issue sync + JSON findings export | `tests/security_email.py` | b24f8ed |
| R10 | 2026-11-23 | security | 9 stored-XSS paths (database text in innerHTML without esc) | `tests/security_scan.py` | dde640c, 1cd6f92 |
| R22 | 2026-11-23 | mobile | Profit-tab layout test harness lacked esc() after the XSS fix, so the test was red in CI | `tests/profit_pies_layout_test.py` | dde640c |
| A4fc9848 | 2026-11-24 | mood | fix(mood): every country tab fetches its own index data; add Italy | `tests/mood_layout_test.py` | 4fc9848 |
| R11 | 2026-11-24 | mobile | Market Mood chip strip was clipped at 360px: nothing past Germany could be tapped | `tests/mood_layout_test.py` | 6e86efd |
| R12 | 2026-11-24 | ui | Active Alerts list on Overview (owner wants alerts only on the Alerts dashboard) | `tests/standards_test.py` | 7afcaf6 |
| R23 | 2026-11-24 | mood | Market Mood showed no data for any country you do not hold (it read the Markets-I-hold cache, which only loads held countries) | `tests/mood_layout_test.py` |  |
| R24 | 2026-11-24 | mood | Italy (FTSE MIB) had no Market Mood tab | `tests/mood_layout_test.py` |  |
| R25 | 2026-11-24 | ui | Two buttons (Refresh now and Start live feed) confused the owner: Refresh now should refresh and make data live | `tests/zk_refresh_live_test.mjs` |  |

## Known gaps (fixed, no automated test yet)

Found automatically from git history by `scripts/regression_sync.py`. Most need a live service (Yahoo, Trading 212, Supabase) or a visual check that cannot run offline. Write the guard, then set `guard` on the row.

| ID | Date | Area | What broke | Fix commit |
|---|---|---|---|---|
| A143e6ec | 2026-11-15 | analyst | Fix analyst_service: switch Yahoo v8→v10 with crumb auth, v7 fallback | 143e6ec |
| A38d9c54 | 2026-11-15 | analyst | Fix analyst_service: use yfinance library (handles Yahoo auth for ETFs) | 38d9c54 |
| A492f2f0 | 2026-11-15 | history | Fix history_service: correct nested API structure + dividend endpoint path | 492f2f0 |
| Aae3a17e | 2026-11-15 | analyst | Fix analyst: skip ETFs (no Yahoo data), insert synthetic pie ratings | ae3a17e |
| Ab76471a | 2026-11-15 | history | Fix history_service: correct T212 field names from API docs | b76471a |
| A24eb8a1 | 2026-11-16 | value-buy | fix(value-buy): fix snapshot table name and URL encoding issue | 24eb8a1 |
| A3bc341d | 2026-11-16 | analyst | fix(analyst): filter ratings to current snapshot positions only | 3bc341d |
| A4a3f3d9 | 2026-11-16 | radial | fix(radial): fix upside-down labels — consistent outward text, 13/11px fonts | 4a3f3d9 |
| A5e1796c | 2026-11-16 | value-buy | fix(value-buy): drive analysis from live positions, not hardcoded map | 5e1796c |
| A63a619d | 2026-11-16 | radial | fix(radial): bigger canvas, vivid colours, larger readable labels | 63a619d |
| A729f07d | 2026-11-16 | value-buy | fix(value-buy): remove quantity from positions select (column does not exist) | 729f07d |
| A9924afe | 2026-11-16 | value-buy | fix(value-buy): fix upsert conflict resolution - add on_conflict to URL | 9924afe |
| Aba97cd6 | 2026-11-16 | sector-map | fix(sector-map): catch errors + reuse cached positions fetch | ba97cd6 |
| Abe36fb0 | 2026-11-16 | analyst | fix(analyst): keep ETF pie-level rows alongside stock ticker filter | be36fb0 |
| Ade17070 | 2026-11-16 | radial | fix(radial): move legend below chart as horizontal gradient bar | de17070 |
| Af2c58c8 | 2026-11-16 | strategy | Fix Global ETF missing from strategy dashboard | f2c58c8 |
| Af3636ad | 2026-11-16 | worker | Security: read-only public access (RLS), service key for all writers, read-only worker proxy | f3636ad |
| A1d21ab6 | 2026-11-17 | general | Fix: restoring a saved session on page refresh hung on 'Loading…' (startApp ran before router.js loaded) | 1d21ab6 |

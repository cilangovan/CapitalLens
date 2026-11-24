# Regression register (bug → guard test)

> **Generated** by `python3 tests/regression_register_test.py --write` from `tests/regression_register.json`. Edit the JSON, not this page.

Every bug that was fixed has a row here: what broke and the test that fails if it ever returns. The whole register runs in the **Regression & data quality** workflow (`.github/workflows/regression.yml`) on every push, on pull requests and nightly. Rule: a bug fix is not done until its row and its guard test are in the same commit.

**Data quality** (`tests/data_quality_test.py`) runs in the same workflow: the data files in git (popular tickers, IPO calendar, Market Mood tabs) on every push, and nightly the live shared tables (market-cache freshness, IPO calendar rules). A nightly failure opens or updates one GitHub issue, "Data quality failing". Customer data is encrypted and is never inspected.

| ID | Date | Area | What broke | Guard test |
|---|---|---|---|---|
| R01 | 2026-11-18 | migration | Migrated rows stored under random ids, so a re-sync wrote a second copy of everything (750 duplicate orders) | `tests/zk_dedupe_test.mjs` |
| R02 | 2026-11-18 | migration | analyst_ratings table was missing from the migration list (Analyst tab empty after upgrade) | `tests/zk_migrate_test.py` |
| R03 | 2026-11-18 | sync | Migration did not carry sync_state, so Refresh walked ALL history (8+ minutes) and restarted from zero when interrupted | `tests/zk_t212sync_test.mjs` |
| R04 | 2026-11-18 | deploy | GitHub Pages served new HTML with an old cached script; the integrity hash blocked the page (M.T212 is undefined) | `tests/zk_prod_pages_test.mjs` |
| R05 | 2026-11-18 | auth | Sign-up box showed a recovery key for an email that already existed, leaving several unusable keys | `tests/zk_flow_test.py` |
| R06 | 2026-11-18 | data-quality | Stale snapshot looked live (Overview showed the 04:05 snapshot as if current) | `tests/zk_overview_stale_test.mjs` |
| R07 | 2026-11-18 | analysis | Analysis code changed without a ZK_ANALYSIS_VERSION bump, so stored results stayed old until a manual Refresh | `tests/zk_analysis_version_test.mjs` |
| R08 | 2026-11-18 | parity | Python mirror added Unclassified Lynch rows when no fundamentals existed, breaking JS/Python analyst parity (10 failures) | `tests/zk_lynch_parity_test.mjs` |
| R09 | 2026-11-18 | mobile | Header row too wide at 360px stretched the page, so fixed popups overflowed | `tests/ui_layout_test.py` |
| R10 | 2026-11-23 | security | 9 stored-XSS paths (database text in innerHTML without esc) | `tests/security_scan.py` |
| R11 | 2026-11-24 | mobile | Market Mood chip strip was clipped at 360px: nothing past Germany could be tapped | `tests/mood_layout_test.py` |
| R12 | 2026-11-24 | ui | Active Alerts list on Overview (owner wants alerts only on the Alerts dashboard) | `tests/standards_test.py` |
| R13 | 2026-11-18 | relay | Cloudflare Workers reject fetch redirect:'error', so every relay call failed at runtime (unit tests could not see it) | `tests/regression_guards_test.py` |
| R14 | 2026-11-18 | ci | popular_tickers.json was hidden by an ignore rule, so CI could not see the file the code needs | `tests/regression_guards_test.py` |
| R15 | 2026-11-18 | strategy | A fixed £ budget must never reappear on the Strategy tab or in any engine | `tests/zk_dipplan_test.mjs` |
| R16 | 2026-11-18 | auth | Sign-in box flashed on refresh before the saved-session check finished | `tests/login_flash_browser_test.py` |
| R17 | 2026-11-18 | sync | A cut-off pipeline run left half-written snapshots / restarted history from zero | `tests/legacy_interrupt_test.py` |
| R18 | 2026-11-18 | commits | Claude / Anthropic / Co-Authored-By signature in commits (owner forbids it) | `tests/standards_test.py` |

## Known gaps (fixed, not fully guarded yet)

- **G1** Python vs JS number formatting parity: Python rounds halves to even, JS rounds halves up (8.5% showed as 8% vs 9%). Parity tests compare values and buckets, not formatted text.
- **G2** Table inventory gate is a manual SQL query: a customer table missing from migrate.js TABLES (analyst_ratings) is only caught by hand. Needs a nightly check; required before cutover step 7.
- **G3** 360px header overflow is guarded only by ui_layout_test.py, which needs Supabase secrets. Needs a synthetic-data header test that runs everywhere.
- **G4** Backfill older fix commits into this register; build the real-browser end-to-end test (login, Analyst, Lynch) from issue #9; run data_quality_test.py --live once with real secrets (not run offline).

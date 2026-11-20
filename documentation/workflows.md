# Workflows & schedules

The exact triggers and commands of every GitHub Actions workflow are in the generated [Workflow reference](reference/workflows.md). This page says what each one is **for** and what depends on what.

> Standing rule: **nothing runs while the app is closed** for the private app. The owner opens the app each morning and presses **Refresh**; sync, analysis, alerts and phone push happen then. The scheduled workflows below serve the legacy dashboard, public data, tests and maintenance. Backups and maintenance run unattended; the owner has no manual steps.

## Data pipelines

| Workflow | Purpose | Writes |
|---|---|---|
| **CapitalLens** (`monitor.yml`) | Takes Trading 212 snapshots on weekday mornings and afternoons; fires alerts and ntfy push | `portfolio_snapshots`, `positions`, `alerts` |
| **Daily Portfolio Services** (`daily_services.yml`) | After the morning snapshot: T212 sync, analyst ratings, value-buy scores, profit booking, strategy, returns, pie history | `t212_*`, `analyst_ratings`, `value_buy_scores`, `profit_booking*`, `strategy_recommendations`, `returns_summary`, `realised_pnl`, `dividends`, `pie_history` |
| **T212 History Sync** (`t212_sync.yml`) | Manual lossless history pull / full re-sync | `t212_*` |
| **Watchlist Analysis** (`watchlist.yml`) | This week's call for each bookmarked stock | `watchlist_analysis` |
| **Weekly Intelligence Report** (`weekly_intelligence.yml`) | Saturday: institutional flow report, holding decisions | `institutional_flow_reports`, `holding_decisions` |
| **IPO Calendar** (`ipo_calendar.yml`) | Validates and upserts `config/ipo_calendar.json`; runs on changes and weekdays | `ipo_calendar` |
| **Public market cache** (`public_market.yml`) | Central cache of public market data for a popular subset (scheduled trigger currently disabled; the private app uses it plus the relay fallback) | `market_cache` |
| **Send Password Reset Email** (`send_reset_email.yml`) | Legacy reset flow, triggered by the worker | — |

## If the page is reloaded or closed while a refresh is running (private app)

The refresh runs in the browser, so a reload, a closed tab or lost signal kills it part-way. Nothing is left corrupt, and the next **Refresh now** finishes the job:

- Every write is an encrypted **upsert by a fixed row id** in batches, so an interrupted run leaves only complete rows (old or new, never half a row) and re-running is idempotent (no duplicates).
- **Portfolio snapshot:** the dashboards read positions by the *latest snapshot id*, so the snapshot row is the **commit record**: positions and alerts are written first, the snapshot last, then monitor state. A run killed before the snapshot leaves unreferenced leftovers and the previous complete snapshot stays the latest (it used to be the other way round, which could show a new snapshot with missing positions).
- **Trading 212 history:** newest pages are stored first. A catch-up cut off after page 1 would have stopped at "already stored history" next time and never fetched the older new orders, so the walk now stores a `resume` marker in `sync_state` after each page that had new items; the next run continues from it and clears it when done. A first-ever full walk cut off part-way already resumed via the `walking` marker.
- The sign-in key/secret for Trading 212 are never stored, so after a reload you re-enter them and press Refresh again. The page asks "Leave site?" while a refresh is running.
- Small leftover: a run killed after alerts but before the snapshot can raise the same alert again on the next refresh (a duplicate is preferred to a lost alert).
- **Legacy page (GitHub Actions: `monitor.py`, `services/t212_sync_service.py`):** a reload cannot touch it (it runs on the server), but a cancelled or timed-out run can be cut off the same way, so it has the same two guarantees. `monitor.py` saves snapshot + positions + alerts through one database function, `save_snapshot()` (`db/tenant/25_refresh_safety.sql`), so they commit together or not at all (it falls back to the old three inserts only if the function is not deployed). The history sync keeps `t212_sync_state.resume` after each page with new items and continues from it next run.
- **Demo:** the demo's data is refreshed daily inside Postgres by `demo_refresh()` (`pg_cron`): one function = one transaction, so it either completes or changes nothing, and no browser is involved, so a reload cannot interrupt it. The demo page has no refresh button.
- Tests: `tests/legacy_interrupt_test.py` (legacy), `tests/zk_interrupt_test.mjs` (kills the run at each write and between order pages, reruns, checks nothing is half-shown and nothing is missed).

## Safety, maintenance and deployment

| Workflow | Purpose |
|---|---|
| **Database Maintenance** | Daily: move history older than 45 days to archive tables (never delete), purge alerts cleared more than 30 days ago |
| **Database Backup** | Weekly schema snapshot to git; **daily encrypted data backup to Cloudflare R2** (details in [Database & data flows](database.md)) |
| **Security checks** | Daily static checks (`tests/security_check.py`): policy, secrets, headers |
| **Deploy Cloudflare Worker** (`deploy_worker.yml`) | Publishes `cloudflare-worker/worker.js` when it changes |
| **Deploy Cloudflare Relay** (`deploy_relay.yml`) | Publishes the stateless `cloudflare-worker/relay.js` when it changes |
| **Vendor front-end libraries** | Keeps the vendored chart library pinned |
| **Cleanup old workflow runs** | Weekly housekeeping |

## Tests (run on every push)

| Workflow | What it proves |
|---|---|
| **Zero-knowledge tests** (`zk_tests.yml`) | Every `tests/zk_*_test.mjs`, Python tests, the **standards test** (`CLAUDE.md` rules), **documentation freshness**, generated pages not stale, worker syntax |
| **UI tests (mobile layout)** (`ui_tests.yml`) | Playwright at 320/360/390px for every dashboard and the documentation portal: no sideways scroll; plus the login-flash and IPO-watch browser tests. Also runs weekday mornings after the data refresh |

## Order on a weekday (UTC)

```
02:23 maintenance → 03:41 backup → 06:15 IPO calendar → 07:47 UI tests
08:00–08:30 monitor snapshots → 08:20 daily services → 08:40 watchlist analysis
14:30–15:00 monitor snapshots          Saturday 06:00 weekly intelligence
```

## Secrets used

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `R2_*`, Cloudflare deploy token, `GH_PAT` (worker → email dispatch), Trading 212 credentials for the legacy pipeline. **No secret is ever committed or logged.**

## Changing a workflow

Edit the YAML, then `python3 scripts/build_docs.py` so the reference updates, and describe the purpose in the tables above. The standards test fails if a workflow is not documented here or in the reference.

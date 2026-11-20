# Database & data flows

Postgres on Supabase. Two projects: **production** (`kloqkcxchstfoljpqcbq`, the original `t212` project converted to multi-user in place) and **demo** (`ggprfdetivzekjxlpvyq`, synthetic data). Every column of every table is in the generated [Table reference](reference/database-tables.md); this page explains how they fit together.

## Where the SQL lives

| Path | Role |
|---|---|
| `db/schema.sql` | Source of truth for a full rebuild (exported from the live database) |
| `db/tenant/01…15_*.sql` | The multi-user and zero-knowledge build, in order (schema, demo seed, isolation test, views, broker connect, legacy conversion, instrument exposure, per-user UI prefs, keys, encrypted rows, market cache, audit log, Lynch columns, IPO calendar) |
| `supabase/migrations/` | Exact history of every change applied |
| `db/export_schema.py` | Regenerates `db/schema.sql` and migrations from the live database (`--check` reports drift) |
| `db/tenant/*RUNBOOK*.md`, `CUTOVER_PLAN.md`, `SECURITY_TIER3_DESIGN.md` | Go-live, cutover and security design notes |

Making a change: apply as a migration, keep the SQL in `db/tenant/` and `supabase/migrations/` identical, run the **Database Backup** workflow (or wait for Sunday) to re-export, and regenerate these docs (`python3 scripts/build_docs.py`).

## Three kinds of data

| Kind | Tables (examples) | Who can read | Notes |
|---|---|---|---|
| **Shared public data** | `instruments`, `instrument_exposure`, `instrument_country_weights`, `instrument_sector_weights`, `market_cache`, `ipo_calendar`, `support_levels`, `institutional_flow_reports` | Any signed-in user (row-level security); writes only by the service role | Contains nothing about any customer. `instrument_*` are limited to instruments a user holds or watches |
| **Per-user plaintext** (legacy / multi-user build) | `portfolio_snapshots`, `positions`, `alerts`, `analyst_ratings`, `holding_decisions`, `profit_booking(_summary)`, `strategy_recommendations`, `returns_summary`, `realised_pnl`, `dividends`, `value_buy_scores`, `watchlist(_analysis)`, `pie_history`, `t212_orders/dividends/transactions/sync_state` | Owner only (row-level security) | Used by the legacy, demo and multi-user dashboards |
| **Zero-knowledge encrypted** (private app) | `enc_rows`, `user_keys` | Owner only, and even then only ciphertext | The same dashboard data as the previous row, encrypted in the browser. See below |

Support tables: `profiles`, `broker_connections`, `broker_secrets`, `sync_jobs` (multi-user plumbing), `user_ui_prefs` (collapse state), `audit_log` (tamper-evident record of privileged writes), `platform_admins` (the staff allow-list for the internal ops page; customers cannot read it), `ops_daily` (one row a day of size and user counts for growth history; staff only), `app_settings`, `dashboard_auth` (legacy single-owner login), `portfolio_snapshots_archive` and `positions_archive` (history older than 45 days, moved by maintenance, never deleted), `t212_sync_state` (cursor for the lossless Trading 212 history sync), `zk_probe` (a small test table that proves the encrypted path works end to end).

## The encrypted store (private app)

`enc_rows(user_id, kind, id, nonce, ct, key_version, updated_at)`

- `kind` is the logical table name (`positions`, `alerts`, `ipo_watch`, …), restricted to `^[a-z0-9_]{1,40}$`. **A new per-user kind needs no migration.**
- Everything else (the original id, tickers, amounts, dates) is inside `ct`, encrypted with AES-GCM using a data key the server never has.
- `user_keys` holds only salts and the data key **wrapped** twice (by the password, and by the recovery key).
- `docs/zk/store.js` encrypts/decrypts; `docs/zk/shim.js` answers the dashboards' `PROXY` calls: tables in its `ENCRYPTED` map come from decrypted rows, tables in `SHARED` are forwarded with the user's token.
- Query results pass `parseJsonCols` (JSON columns parsed) **then** `defuse`.

## Retention and safety

Treat all portfolio data as precious.

| Rule | How |
|---|---|
| Keep **45 days** of history in live tables | `archive_portfolio_history(45)` moves older rows to `*_archive` (never deletes). Runs daily (Database Maintenance) |
| Cleared alerts deleted after **30 days** | `purge_cleared_alerts(30)` |
| Daily **encrypted** off-site backup to **Cloudflare R2** | `Database Backup` workflow: `pg_dump` → gzip → AES-256 gpg → R2; 7 daily / 35 weekly / 400 monthly kept |
| Schema snapshot to git | Weekly, plus on demand |
| Public repository: data is never committed | Backups are encrypted before they leave the runner |

## Data flows

### A. Legacy / multi-user build (server-side pipeline)

```
Trading 212 API ──► t212_sync_service ──► t212_orders / t212_dividends / t212_transactions
       │                                          │
       ▼                                          ▼
 monitor.py ──► portfolio_snapshots + positions   returns_service ─► returns_summary, realised_pnl, dividends
       │                                          pie_history_service ─► pie_history
       ├─► alert_service ─► alerts ──► ntfy push
       ├─► analyst_service ─► analyst_ratings
       ├─► value_buy_service ─► value_buy_scores
       ├─► profit_booking_service ─► profit_booking(_summary)
       ├─► strategy_service ─► strategy_recommendations
       └─► weekly: institutional_flow_service, holding_decision_service
Dashboards ──► Cloudflare worker (legacy) or Supabase REST + RLS (multi-user) ──► tables above
```

### B. Private zero-knowledge build (browser-side pipeline)

```
Open the app each morning ─► ⚙ Settings ─► Refresh now
   │  T212 key (used once, never saved) ─► stateless relay ─► Trading 212
   ▼
 t212sync.js ─► pipeline.js ─► monitor / returns / piehistory / analystratings / valuebuy / profitbooking /
                               strategy / holdingdecision / flow / watchlist  (docs/zk/*.js, same maths as services/*.py)
   ▼
 store.js encrypts ─► enc_rows (ciphertext only)         market data ◄─ market_cache (public) or relay fallback
   ▼
 shim.js decrypts in the browser ─► the same dashboard code renders the menus
```

Nothing runs while the app is closed. The browser build and the Python services share the same rules and are kept equal by parity tests where both exist (for example Lynch).

### C. Public data

`config/ipo_calendar.json` → `services/ipo_service.py` → `ipo_calendar` (weekdays 06:15 UTC) and `config/popular_tickers.json` → public market job → `market_cache`. Neither touches a customer table.

## Table → menu

| Table(s) | Feeds |
|---|---|
| `portfolio_snapshots`, `positions` | Overview, P&L Bubbles, Positions |
| `pie_history` | Positions drill-down charts |
| `instrument_exposure`, `instrument_*_weights` | Tooltips (names, flags), Sector Map, Country Exposure |
| `analyst_ratings` | Analyst |
| `institutional_flow_reports`, `holding_decisions`, `value_buy_scores`, `strategy_recommendations`, `support_levels` (public; demo copy `demo_support_levels`) | Strategy |
| `profit_booking`, `profit_booking_summary` | Profit Booking |
| `returns_summary`, `realised_pnl`, `dividends` | Returns |
| `watchlist`, `watchlist_analysis`, `ipo_calendar`, `ipo_watch` (encrypted) | Watchlist & IPO Watch (card order = `sort_order` inside the encrypted watchlist row; legacy plaintext table has `watchlist.sort_order`, migration 24) |
| `alerts` | Alerts, Overview "Active Alerts" |
| `user_ui_prefs` | Collapsed/expanded cards everywhere |

## Adding a table or kind

1. Shared public table: SQL in `db/tenant/NN_*.sql` **and** `supabase/migrations/…` (identical); enable RLS; grant `authenticated` select only; add to the worker `READABLE` list and the shim `SHARED` list.
2. Per-user table in the private app: add a name to the shim `ENCRYPTED` map (no migration).
3. Add the dashboard reader; update the menu page and rebuild the docs. `tests/standards_test.py` checks the table is served by both the worker and the shim.

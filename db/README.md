# Database

Postgres (currently Supabase, project `kloqkcxchstfoljpqcbq`, Postgres 17).

| Path | What it is |
|---|---|
| `db/schema.sql` | **Source of truth for a rebuild.** Full, ordered DDL for the `public` schema, generated from the live DB: extensions, roles, sequences, 18 tables, keys, indexes, RLS, policies, grants, comments. Re-runnable (`if not exists` / `drop … if exists`) and tested on an empty Postgres and on an existing one. No data, no credentials. |
| `supabase/migrations/` | Exact SQL of every change applied through Supabase, exported from `supabase_migrations.schema_migrations` (credential seeds redacted). This is **history**, not a full build — the original core tables (snapshots, positions, alerts, analyst ratings …) were created in the SQL editor before migrations were tracked, so replay these *on top of* `schema.sql`, never on an empty DB. |
| `db/export_schema.py` | Regenerates both of the above from the live DB. `--check` reports drift. |
| `db/legacy_migrations/` | Hand-written notes from before this export existed. Superseded; kept for reference. |
| `.github/workflows/db_backup.yml` | Weekly schema snapshot → git, daily encrypted data backup → Cloudflare R2. |
| `db/r2_backup.sh` | Uploads one encrypted backup to R2, verifies it, promotes to weekly/monthly, prunes old copies. |

## Making a schema change

1. Apply it as a migration (Supabase MCP `apply_migration`, or `supabase migration new … && supabase db push`).
2. Run the **Database Backup** workflow (or wait for Sunday) — it re-exports and commits `db/schema.sql` + the new migration file.
   Locally: `SUPABASE_DB_URL=… python db/export_schema.py`.

## Backups

**One-time setup** — Settings → Secrets and variables → Actions → *New repository secret*:

| Secret | Value | Needed for |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase dashboard → **Connect** → *Session pooler* URI (port **5432**), with your DB password | schema export + `pg_dump` + data backups |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens (alternative if you'd rather not store the DB password) | schema export only |
| `BACKUP_PASSPHRASE` | a long random passphrase — **keep a copy outside GitHub**; without it a backup can't be opened | data backups |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 → right-hand panel *Account ID* | R2 upload |
| `R2_BUCKET` | the bucket name, e.g. `t212-backups` (create it with R2 → *Create bucket*; keep it **private**) | R2 upload |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 → *Manage API tokens* → *Create API token* → **Object Read & Write**, scoped to that one bucket only | R2 upload |

If any `R2_*` secret is missing the upload is skipped with a warning and the encrypted file is only kept as a 7-day run artifact.

**Schedule (UTC):**
- Sundays 03:17 — commits `db/schema.sql` if anything changed, and attaches a full `pg_dump --schema-only` (90-day artifact).
- **Daily 03:41** — encrypted data backup → R2 (runs after the 02:23 `db_maintenance`, so the day's archive move is included).
- On demand: Actions → *Database Backup* → *Run workflow* → tick **Also take an encrypted data backup**.

**What is in a data backup:** `pg_dump --data-only --schema=public`, i.e. every table including `portfolio_snapshots_archive`, `positions_archive` and the raw `t212_*` history. The run fails if the archive tables fall out of scope, if the file doesn't decrypt/unzip, or if the dump has no `t212_orders` block.

**Retention in R2** (grandfather-father-son, pruned by `db/r2_backup.sh`):

| Prefix | Made | Kept |
|---|---|---|
| `daily/` | every run | 7 days |
| `weekly/` | Sundays | 35 days |
| `monthly/` | 1st of the month | 400 days |

Files are `t212-data-YYYYMMDD-HHMM.sql.gz.gpg`. Cost is ~£0 — about 23 small files, well inside R2's 10 GB free tier, and downloads (egress) are free.

- This repository is **public**, so data is **never committed**. It's gzip'd and encrypted (AES-256, gpg symmetric) with `BACKUP_PASSPHRASE` before it leaves the runner; the run fails rather than store anything unencrypted. Keep the bucket private anyway.
- `dashboard_auth` (login) rows are **excluded** — create a login on the new database instead.
- A failed scheduled run emails you through GitHub's normal workflow-failure notification.
- **Test a restore** into a scratch Supabase project once (steps below) — a backup you've never restored is a hope, not a backup.

## Restore / move to another Postgres

```bash
# 1. Structure (any Postgres 15+, Supabase or not)
psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

# 2. Data (download from R2 → dashboard → bucket → daily/ , or from the Actions run artifact)
gpg --decrypt t212-data-20261117-0341.sql.gz.gpg | gunzip | psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1

# 3. A login for the dashboard (the worker hashes passwords with SHA-256)
psql "$NEW_DATABASE_URL" -c "insert into dashboard_auth (username, password_hash)
  values ('admin', encode(sha256('choose-a-strong-password'::bytea), 'hex'));"
```

Then point the app at the new database: GitHub secrets `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SUPABASE_KEY`, and the Cloudflare Worker bindings (redeployed by `deploy_worker.yml`).

**Leaving Supabase entirely?** The app talks to the database through Supabase's REST API (PostgREST) — from the Python services, the Worker and the dashboard proxy. On plain Postgres you'd also run [PostgREST](https://postgrest.org) (the `anon` / `authenticated` / `service_role` roles in `schema.sql` are there for it), or swap those calls for a direct driver. The tables, policies and data move as-is.

**Supabase → Supabase (new project):** steps 1–3 above, or `supabase link` + `supabase db push` after restoring the baseline.

## Retention & housekeeping

Runs daily via `.github/workflows/db_maintenance.yml` (02:23 UTC), using two database functions only the service role can execute:

| Data | Rule | How |
|---|---|---|
| `portfolio_snapshots` + `positions` (≈20 snapshots × 32 rows per weekday) | Live tables keep the **last 45 days**; older rows are **moved** (never deleted) to `portfolio_snapshots_archive` / `positions_archive`. The latest snapshot is never moved. | `archive_portfolio_history(45)` — one transaction |
| Full history readers (returns/XIRR, overview 3M/6M/1Y) | Read the `portfolio_snapshots_all` / `positions_all` views (live + archive) | views use `security_invoker` |
| `alerts` | **Cleared** alerts are deleted 30 days after you clear them. Archived and Inbox are kept. | `purge_cleared_alerts(30)` |
| One-row summaries (`returns_summary`, `strategy_recommendations`, `profit_booking_summary`) | Replaced on every run | services |
| Per-holding tables (`analyst_ratings`, `profit_booking`, `value_buy_scores`) | Upserted; rows for tickers you no longer hold are removed | services |
| `holding_decisions`, `institutional_flow_reports`, `realised_pnl`, `dividends` | Kept (small: one row per ticker/day or per transaction) | — |
| `watchlist_analysis` | Overwritten daily; removed with its watchlist row (cascade) | worker / service |
| `t212_orders`, `t212_dividends`, `t212_transactions` | **Raw Trading 212 history — append-only, never deleted** by any job. Re-syncs upsert (`last_seen` bumps); `raw` keeps T212's full JSON | `services/t212_sync_service.py` (daily, incremental; `t212_sync.yml` with `full` for a full re-walk) |
| `realised_pnl`, `dividends` | Derived — rebuilt from the raw tables on every sync | `t212_sync_service.rebuild_derived()` |
| `pie_history` | Derived — one row per pie + `__DIRECT__`, `__ALL__`, `__SOLD__`; rebuilt daily from `t212_orders` + Yahoo closes | `services/pie_history_service.py` |

Dead rows from replace-style updates are cleaned by Postgres autovacuum.

**Adding a column to `portfolio_snapshots` or `positions`?** Add it to the matching `_archive` table in the same migration, and recreate the `_all` view — the archive function copies rows with `select *` and will fail loudly (not silently) if the columns differ.

## Indexes

Beyond primary keys / unique constraints: `positions(snapshot_id)` (every page loads the latest snapshot's positions),
`portfolio_snapshots(created_at desc)`, `alerts(created_at desc)`, `alerts(alert_type, created_at desc)`,
`t212_orders(ticker, filled_at)` / `(filled_at)`, `t212_dividends(paid_on)`, `t212_transactions(date_time)`, trigram GIN indexes on `instruments(name, short_name)` for watchlist search, and the matching indexes on the archive tables.
Supabase's performance advisor reports no missing indexes.

## Security notes

- **The database is server-side only.** The public `anon` / `authenticated` roles have no access to any table, view, sequence
  or function (no `public_read` policies; default privileges revoked so new objects stay private too). RLS stays enabled.
- **Every read goes through the Cloudflare worker** with a signed-in session (`Authorization: Bearer <session>`), against an
  allowlist of dashboard tables. `dashboard_auth` and the raw `t212_*` history are never served. The worker uses the service
  key server-side only and forwards no client headers.
- **Login:** salted PBKDF2-SHA256 passwords (old SHA-256 hashes upgrade on next sign-in); 5 failed attempts lock sign-in for
  15 minutes (`failed_logins`, `locked_until`); a password reset signs out every session.
- **Front end:** no third-party scripts (Chart.js self-hosted from npm, integrity-pinned — `docs/vendor/`), a strict
  Content-Security-Policy, and every worker response sanitised at one gate (`defuse()` in `docs/js/api.js`).
- **Checked automatically:** `tests/security_check.py` (`security.yml`, every change + daily) probes the worker and database as
  an outsider; `tests/ui_layout_test.py` runs an XSS attack pass with a payload in every text field.
- `db/schema.sql` and `supabase/migrations/` contain structure only; the export redacts any credential seed it finds.

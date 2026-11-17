# Database

Postgres (currently Supabase, project `kloqkcxchstfoljpqcbq`, Postgres 17).

| Path | What it is |
|---|---|
| `db/schema.sql` | **Source of truth for a rebuild.** Full, ordered DDL for the `public` schema, generated from the live DB: extensions, roles, sequences, 18 tables, keys, indexes, RLS, policies, grants, comments. Re-runnable (`if not exists` / `drop … if exists`) and tested on an empty Postgres and on an existing one. No data, no credentials. |
| `supabase/migrations/` | Exact SQL of every change applied through Supabase, exported from `supabase_migrations.schema_migrations` (credential seeds redacted). This is **history**, not a full build — the original core tables (snapshots, positions, alerts, analyst ratings …) were created in the SQL editor before migrations were tracked, so replay these *on top of* `schema.sql`, never on an empty DB. |
| `db/export_schema.py` | Regenerates both of the above from the live DB. `--check` reports drift. |
| `db/legacy_migrations/` | Hand-written notes from before this export existed. Superseded; kept for reference. |
| `.github/workflows/db_backup.yml` | Weekly schema snapshot → git, and an optional encrypted data backup. |

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

**Schedule:** Sundays 03:17 UTC → commits `db/schema.sql` if anything changed, and attaches a full `pg_dump --schema-only` (90-day artifact).

**Data backup (on demand):** Actions → *Database Backup* → *Run workflow* → tick **Also take an encrypted data backup**.
You get `t212-data-YYYYMMDD-HHMM.sql.gz.gpg` attached to the run for 30 days.

- This repository is **public**, so data is **never committed**. It's gzip'd and encrypted (AES-256, gpg symmetric) with `BACKUP_PASSPHRASE`; the run fails rather than store anything unencrypted.
- `dashboard_auth` (login) rows are **excluded** — create a login on the new database instead.
- **Where it goes long-term is undecided.** When you pick a destination (S3, Cloudflare R2, Google Drive …), add an upload step after "Dump, compress, encrypt" in the workflow.

## Restore / move to another Postgres

```bash
# 1. Structure (any Postgres 15+, Supabase or not)
psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql

# 2. Data (download the artifact from the Actions run first)
gpg --decrypt t212-data-20261117-0317.sql.gz.gpg | gunzip | psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1

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

Dead rows from replace-style updates are cleaned by Postgres autovacuum.

**Adding a column to `portfolio_snapshots` or `positions`?** Add it to the matching `_archive` table in the same migration, and recreate the `_all` view — the archive function copies rows with `select *` and will fail loudly (not silently) if the columns differ.

## Indexes

Beyond primary keys / unique constraints: `positions(snapshot_id)` (every page loads the latest snapshot's positions),
`portfolio_snapshots(created_at desc)`, `alerts(created_at desc)`, `alerts(alert_type, created_at desc)`,
trigram GIN indexes on `instruments(name, short_name)` for watchlist search, and the matching indexes on the archive tables.
Supabase's performance advisor reports no missing indexes.

## Security notes

- Public read (`anon`) is **select-only** on every table except `dashboard_auth` (no access at all). All writes use the service role (GitHub Actions + Worker).
- `db/schema.sql` and `supabase/migrations/` contain structure only; the export redacts any credential seed it finds.

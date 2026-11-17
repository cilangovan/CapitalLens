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

## Security notes

- Public read (`anon`) is **select-only** on every table except `dashboard_auth` (no access at all). All writes use the service role (GitHub Actions + Worker).
- `db/schema.sql` and `supabase/migrations/` contain structure only; the export redacts any credential seed it finds.

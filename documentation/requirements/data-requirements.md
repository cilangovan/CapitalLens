# Data and database requirements

Concepts and flows are in [Database & data flows](../database.md); the generated [table reference](../reference/database-tables.md) lists every table and column (38 in the `public` schema at the time of writing).

## A. Requirements

| ID | Requirement | How it is met | Check | Status |
|---|---|---|---|---|
| DB-1 | **Three kinds of data, kept apart.** Shared public data (instruments, market cache, IPO calendar, institutional flow reports); per-user plaintext (legacy, demo, multi-user); per-user encrypted (`enc_rows`, `user_keys`) | Table design and policies | `rls_isolation_test()` | ✅ |
| DB-2 | **Row-level security on every table.** A user reads and writes only their own rows; shared tables are read-only for signed-in users and writable only by the service role; `anon` has nothing | Policies per table; `anon` revoked | `db/tenant/03_rls_isolation_test.sql`: 63 checks passed on the demo project on 20 Nov 2026; `tests/security_check.py` live probes | ✅ (demo project verified; production not inspected) |
| DB-3 | **Zero knowledge.** The server stores ciphertext (`enc_rows.ct`) plus owner, kind, size and time; never plaintext holdings, tickers, amounts or the broker key. The data key is generated in the browser and stored only wrapped (by the password key and by the recovery key) | `docs/zk/store.js`, `user_keys` | `tests/zk_crypto_test.mjs`, `zk_flow_test.mjs` | ✅ |
| DB-4 | **A new per-user kind needs no migration.** `kind` matches `^[a-z0-9_]{1,40}$` | `enc_rows` check | `tests/zk_migrate_test.py` | ✅ |
| DB-5 | **No holdings data in JavaScript.** Names, flags, sectors and countries live in the database and are served to every dashboard | `instrument_exposure`, `instrument_*_weights` | `tests/standards_test.py` | ✅ |
| DB-6 | **Keep 45 days of history in live tables; older rows move to archive tables, never deleted** (`portfolio_snapshots_archive`, `positions_archive`) | `archive_portfolio_history(45)`, daily Database Maintenance workflow | workflow run; no automated restore of archived rows | 🟡 |
| DB-7 | **Cleared alerts are deleted after 30 days**; archived alerts are kept and dated | `purge_cleared_alerts(30)`, daily | workflow run | 🟡 |
| DB-8 | **Daily encrypted off-site backup** of the Supabase database to Cloudflare R2: `pg_dump` → gzip → AES-256 gpg → R2; keep 7 daily, 35 weekly, 400 monthly. Backups are encrypted before they leave the runner; data is never committed to the public repository | `db_backup.yml`, `db/r2_backup.sh` | workflow run | 🟡 |
| DB-9 | **Backups are restorable.** A restore into a scratch project is rehearsed at least yearly and after any backup change, with the result recorded | `db/README.md` says to do it once | no record that a restore drill was done | ⬜ |
| DB-10 | **Schema in git.** `db/schema.sql` and `supabase/migrations/` match the live database; `db/export_schema.py --check` reports drift; SQL in `db/tenant/` and `supabase/migrations/` is identical | Weekly schema snapshot | `Database Backup` workflow | 🟡 |
| DB-11 | **Lossless broker history.** Trading 212 orders, dividends and transactions are stored raw with a sync cursor (`t212_sync_state`) so history is rebuilt, never lost | `services/t212_sync_service.py`, `docs/zk/t212sync.js` | `tests/zk_t212sync_test.mjs` | ✅ |
| DB-12 | **No duplicates.** Re-running a sync never duplicates rows; a Scan/Fix tool exists | `docs/zk/dedupe.js` | `tests/zk_dedupe_test.mjs` | ✅ |
| DB-13 | **JSON columns parsed before sanitising.** `parseJsonCols` runs before `defuse` (which swaps quotes) | `docs/zk/shim.js` | `tests/zk_shim_test.mjs` | ✅ |
| DB-14 | **Deleting an account removes its data.** Every per-user foreign key cascades on `auth.users` | Foreign keys with `on delete cascade` | demo clean-up proves the cascade for visitor accounts (`tests/demo_access_test.sql`) | ✅ for demo accounts; ⚠ for customers (no self-service delete) |
| DB-15 | **Customer data export and erasure on request.** A customer can see what is stored (account page "what is stored") and can ask for export or deletion; the procedure and time limit are written down | account page lists counts | no documented export or erasure procedure | ⬜ |
| DB-16 | **Hosted-data location and processors are recorded** (Supabase region, Cloudflare, GitHub) | — | not recorded in the docs | ⬜ |
| DB-17 | **Public data holds nothing about any customer.** `instrument_*` limited to instruments a user holds or watches (read filter) | policies | `rls_isolation_test()` | ✅ |
| DB-18 | **Demo data is synthetic and isolated.** Visitor accounts are throw-away copies; the master is locked; expiry is enforced in the database | `db/tenant/17_demo_access.sql`, `18_demo_refresh.sql` | `tests/demo_access_test.sql` | ✅ |
| DB-19 | **Staff tables are unreadable to customers.** `platform_admins`, `ops_daily`, `audit_log` (own rows only), `demo_*` have no customer policies | policies and grants | advisor shows RLS on, no policy (deny by default); `tests/zk_ops_test.mjs` | ✅ |
| DB-20 | **Growth is tracked.** One `ops_daily` row a day: size and user counts | `ops_record_daily()` | `tests/zk_ops_test.mjs` | ✅ (recorded when staff open the page; see LOG-9) |
| DB-21 | **Performance.** List queries are indexed and paged; heavy tables (`positions`) stay small through archiving | indexes in migrations | performance advisor not reviewed for this pack | ⬜ |

## B. Data flows (summary)

1. **Legacy / multi-user:** GitHub Actions run services (`daily_services`, `t212_sync`, `watchlist`, `weekly_intelligence`, `public_market`, `ipo_calendar`) which write plaintext rows with the service role; dashboards read through the worker or row-level security.
2. **Private (zero knowledge):** the user presses Refresh; the browser calls the stateless relay with the one-time broker key, analyses in the browser, encrypts and writes `enc_rows`; dashboards read ciphertext and decrypt locally.
3. **Public data:** instruments, market cache, IPO calendar and flow reports are written by schedules or the browser's public-market sync and read by every signed-in user.
4. **Demo:** a daily job re-seeds the master; each visitor gets a copy; clean-up deletes it.

## C. Retention summary

| Data | Live | Afterwards |
|---|---|---|
| Snapshots and positions | 45 days | archive tables, kept |
| Cleared alerts | 30 days | deleted |
| Archived alerts | kept, dated | — |
| Audit log | no deletion allowed (append-only) | no retention limit defined (see LOG-8) |
| Demo usage rows | 30 days | deleted |
| Backups | 7 daily · 35 weekly · 400 monthly | expire |

## D. Test scenarios

- **TS-DB1** Two users, same table → neither reads the other's rows (`rls_isolation_test()`).
- **TS-DB2** Sign in as `anon` → no dashboard table returns rows (`tests/security_check.py`, live).
- **TS-DB3** Run maintenance with snapshots older than 45 days → they appear in the archive and are gone from the live table; the row count is unchanged in total.
- **TS-DB4** Re-run a broker sync twice → no duplicate orders.
- **TS-DB5** Delete a visitor account → all its rows are gone, the master is untouched.
- **TS-DB6** Restore the latest backup into a scratch project → table counts match (⬜ not yet performed).

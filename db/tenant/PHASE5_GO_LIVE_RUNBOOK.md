# Phase 5 — go-live runbook (Tier 3 zero-knowledge)

Nothing here has been run against production. Every step marked **[needs go-ahead]** changes production or is irreversible.
Rollback at any point before step 7: say "rollback" (resets `main` to `restore/pre-tier3-2026-11-18`, restores tables from schema `rollback_20261118`).

## What still depends on the all-access service key (inventory, 18 Nov 2026)
| Area | Files | Retire by |
|---|---|---|
| Python services (sync, returns, alerts, strategy, holding/value-buy, pie history, profit booking, watchlist, flow) | `services/*.py` | replaced by browser modules `docs/zk/*.js` (parity-tested); flow stays server-side but **public data only** (`FLOW_PUBLIC_MODE=1`) |
| Scheduled jobs | `.github/workflows/{t212_sync,daily_services,monitor,watchlist,weekly_intelligence,db_maintenance}.yml` | disable (step 5); keep `public_market.yml` (+ flow job) which touches only shared tables |
| Legacy single-user worker | `cloudflare-worker/worker.js`, `deploy_worker.yml` | delete worker (step 6) |
| Broker Edge Function + Vault (`broker_secrets`, `broker_cron_secret`) | `supabase/functions/broker`, `db/tenant/05_broker_connect.sql` | delete function, drop broker tables/secrets (step 6). **Keep** Vault secret `zk_salt_pepper` (used by login) |
| Backups / maintenance | `db_backup.yml`, `r2_backup.sh` | keep; they see only ciphertext after step 4 |

## Order of the production switch
1. **Pre-flight (safe):** `tests/zk_*_test.mjs` all green in CI (`zk_tests.yml`); `/zkapp/` verified in a real browser on demo (done 18 Nov); relay deployed and live-checked (done).
2. **[needs go-ahead] Apply to production:** `db/tenant/09..13` SQL (ui prefs, zk keys, enc_rows, market_cache, audit_log). Point `docs/zkapp/zkapp-auth.js` constants at the production project; rebuild page (`python3 scripts/build_zkapp.py`); commit.
3. **[needs go-ahead] Migrate the owner's data:** log in at `/zk/` → "Upgrade it to a private account" (browser reads existing rows, encrypts, uploads; see `docs/zk/migrate.js`). Save the recovery key offline. Verify counts per table equal the plaintext counts, and open `/zkapp/` to compare dashboards with the old app side by side.
4. **Do not delete plaintext yet.** Keep it read-only for at least one week of daily use; compare numbers.
5. **[needs go-ahead] Stop scheduled server jobs** that read customer tables (disable the workflows above). Schedule `public_market.yml` and the flow job. Decide the "nothing runs while the app is closed" option first (see Open decisions).
6. **[needs go-ahead] Retire all-access paths:** delete `capitallens-proxy` worker, broker function, broker/Vault secrets; remove `SUPABASE_SERVICE_KEY` from GitHub secrets (keep only for the public-market job if it needs write access to shared tables — use a narrowly scoped DB role instead); rotate the service key and the JWT secret.
7. **[needs go-ahead, irreversible] Drop plaintext customer tables** only after step 4 passes and a fresh restore test succeeds. Take a final encrypted backup first. This is the point of no return for rollback.
8. Close issue #7 only when every box is ticked **and** production verified.

## Controls to switch on (owner actions in dashboards — cannot be done from code)
- [ ] MFA on every staff account: GitHub, Supabase, Cloudflare, Google (the Supabase dashboard is the main staff entry point).
- [ ] Supabase Auth → leaked-password protection ON (flagged by the advisor on demo; may need a paid plan).
- [ ] Supabase Auth → minimum password length >= 10, email confirmation on, rate limits reviewed.
- [ ] Supabase logs retained >= 90 days (needed because Postgres triggers cannot record SELECTs).
- [ ] Branch protection on `main` (PRs + required `zk_tests` check) once you stop pushing straight to main.
- [ ] Cloudflare: relay stays secretless; no KV/D1/R2 bindings (check at each deploy).

## Audit log (db/tenant/13_audit_log.sql)
Records every write to `user_keys`, `enc_rows`, `broker_secrets` that is not the owner in their own session: actor (service_role / postgres / other), customer, table, operation, row id, time. No values. Append-only (even the service role cannot edit or delete). Customers can read their own entries. Review weekly: `select actor, table_name, op, count(*) from audit_log where at > now() - interval '7 days' group by 1,2,3;` — after step 6 any `service_role` or `postgres` entry on customer tables should be explainable (migration, restore test) or treated as an incident.
Gap: reads are not recorded (see log retention above); reads return only ciphertext.

## Key rotation / recovery runbook
- Customer forgot password: recover with the recovery key at `/zk/` (re-wraps the data key). No recovery key and no password = data is unrecoverable by design; say so at sign-up.
- Compromised Trading 212 key: delete it in Trading 212 (Settings → API); it is never stored by us, so nothing to rotate on our side.
- Service key / JWT secret leaked: rotate in Supabase, update GitHub secrets, check `audit_log` for entries in the exposure window.
- Pepper (`zk_salt_pepper`): never rotate casually — it changes every customer's login salt. Back it up with the project secrets.
- Quarterly: restore test of backups into a scratch project + the RLS isolation test (`db/tenant/03_rls_isolation_test.sql`).

## External penetration test (go-live gate)
Scope: `/zk/` and `/zkapp/` (XSS — see risk below —, key handling in memory/sessionStorage, CSP), Supabase API (RLS bypass between two test customers, `zk_login_params` account enumeration and rate limits, `enc_rows` size/abuse), relay (SSRF/open-proxy attempts, header injection, origin lock), CI/deploy (secret exposure, third-party actions pinned). Provide the tester two throwaway accounts and the demo project; fix, then retest.

## Known residual risks (decide before launch)
1. **Inline scripts: RESOLVED on `/zkapp/` (18 Nov 2026).** The page's policy is `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval`). The dashboards' ~90 inline `on*` handlers run through `docs/zk/handlers.js`: attributes are moved to `data-on*`, then parsed with a tiny grammar (function calls with literal arguments only) and may call only an allowlist of the app's own functions, generated at build time (`docs/zkapp/handler-names.js`). Verified in real Chrome: injected `onclick="eval(...)"`, `fetch(...)`, `setTimeout(...)`, assignments and an inline `<script>` all fail to run. Remaining XSS defences: server text sanitised (`defuse`), no third-party scripts, SRI on every script, `connect-src` limited to Supabase + relay + ntfy. Still do: pen-test the dashboards' `innerHTML` rendering for injection (e.g. a hostile company name from Yahoo).
2. **Nothing runs while the app is closed** — DECIDED (owner, 18 Nov 2026): option A. The user opens the app each morning and presses Refresh; sync, analysis, alerts and the phone push happen then. No scheduled/delegated mode; full zero-knowledge guarantee kept. (Document this plainly on the sign-up page.)
3. Trading 212 sync, ntfy push and password-reset flows have not been exercised end-to-end against real services.

## Dry-run findings — production recon, 18 Nov 2026 (read-only: row counts and table names only)
- Production has **1 auth user**; none of `user_keys`, `enc_rows`, `market_cache`, `audit_log`, `zk_login_params` or the `zk_salt_pepper` Vault secret exist yet. Extensions `pg_net`, `pg_cron`, `supabase_vault` are present. So steps 2 (SQL 09/10/11/12/13) are purely additive; nothing existing is altered. `user_ui_prefs` already exists (09 applied).
- Plaintext to migrate: about 8,000 rows (positions ~1,300, realised_pnl ~2,700, t212_orders ~2,800, t212_transactions ~600, dividends/t212_dividends ~400 each, snapshots 36, alerts 26, the rest < 70). Browser migration of this size: well within one run.
- `migrate.js` TABLES covers every per-customer table in production. Not migrated, by design: `analyst_ratings` (global table, 32 rows; recomputed encrypted on first Refresh), `app_settings` (0 rows), `t212_sync_state` (cursors; the first Refresh does a full re-sync and needs the Trading 212 key), `profiles`, `user_ui_prefs`, `dashboard_auth` (legacy password hash, retired at step 6).
- `broker_connections` has **0 rows**: the Edge-Function/Vault broker flow was never used in production, so retiring it (step 6) loses nothing.
- The pages `/zk/` and `/zkapp/` currently point at the **demo** project. For the switch, build a production variant (separate output folder) and keep the demo variant for testing.

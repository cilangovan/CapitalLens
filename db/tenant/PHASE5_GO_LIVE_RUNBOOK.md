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
1. **CSP still allows inline scripts** (`script-src 'unsafe-inline'`) because the dashboards use inline `onclick=` handlers (~32 static plus many generated). In a zero-knowledge app an XSS is the main threat (it could read the unlocked key). Mitigations today: all server text is sanitised before rendering (`defuse`), no third-party scripts, every script pinned by hash, strict `connect-src` (an injected script cannot send data to another host). Proper fix: replace inline handlers with delegated listeners and drop `unsafe-inline` — a sizeable refactor of `docs/js/*`; recommended before opening to other customers.
2. **Nothing runs while the app is closed** (no server holds a key): daily sync, alerts and push happen only when the app is opened. Options for the owner to choose: (a) accept and rely on opening the app daily, (b) opt-in "delegated" mode where the customer stores an encrypted read-only broker key server-side for scheduled jobs (weaker guarantee, clearly labelled), (c) a small always-on personal device/browser tab. Needs an explicit decision.
3. Trading 212 sync, ntfy push and password-reset flows have not been exercised end-to-end against real services.

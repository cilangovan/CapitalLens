# Security requirements

Design is in [Architecture & security](../architecture-and-security.md) and `db/tenant/SECURITY_TIER3_DESIGN.md`. This page is the requirement layer: threats, the control for each, how it is checked, and what is not done.

## A. What we protect and from whom

| Asset | Worst case | Main threats |
|---|---|---|
| Customer holdings and broker key | Read by anyone but the owner | Server or staff access, another customer, a leaked database, a stolen session, a malicious page script |
| Customer password and recovery key | Lost or guessed | Phishing, weak or reused passwords, guessing, a stolen recovery key |
| Availability and integrity of the data | Lost or altered history | Bad migration, bug, deletion, ransomware on a backup |
| The service and its keys | Abuse of keys or free resources | Leaked service key, bot abuse of public endpoints, supply-chain script |
| Staff tools | Misuse of operations pages | Stolen staff login |

Trust boundary: the browser and the user's keys are trusted; the server, relay, GitHub, Cloudflare and Supabase staff are **not** trusted with plaintext.

## B. Requirements

| ID | Requirement | Control | Check | Status |
|---|---|---|---|---|
| SEC-1 | The server never sees plaintext customer holdings | Browser-side AES-GCM; ciphertext only in `enc_rows` | `tests/zk_crypto_test.mjs`, `zk_flow_test.mjs` | ✅ |
| SEC-2 | The broker key is read-only, used once through a stateless relay and never saved | Relay stores nothing; key entered per refresh | `tests/zk_t212sync_test.mjs`; relay code review | ✅ |
| SEC-3 | Users are isolated from each other | Row-level security on every table; `anon` revoked | `rls_isolation_test()` 63 checks pass (demo project) | ✅ |
| SEC-4 | Strict Content-Security-Policy; no inline script in the private app; connect only to the project, relay and ntfy | `scripts/build_zkapp.py` | `tests/zk_zkapp_page_test.mjs`, `security_check.py` | ✅ |
| SEC-5 | No inline handlers except through the whitelisted interpreter | `docs/zk/handlers.js` | `tests/zk_handlers_test.mjs` | ✅ |
| SEC-6 | Everything from the server is sanitised (`defuse`); page code escapes what it inserts | `docs/js/api.js` | `security_check.py` | ✅ |
| SEC-7 | Every local script is pinned by SRI hash and content-hash URL; no third-party script at run time | `scripts/build_zkapp.py` | CI fails if stale; `security_check.py` | ✅ |
| SEC-8 | No `eval`, `new Function`, `document.write` or string timers | static scan | `security_check.py` | ✅ |
| SEC-9 | No framing, no referrer, `noindex` on private pages; the demo page refuses to run in a frame | page meta; framing guard | `security_check.py`; `docs/demo/demo-auth.js` | ✅ |
| SEC-10 | Secrets are never committed or logged; demo credentials never in the repo | GitHub secrets; checks | `tests/standards_test.py` (demo password check); secret scanning not enabled as a check | ⚠ |
| SEC-11 | Passwords: salted slow hashing; the login-parameter lookup does not reveal whether an email exists | `zk_login_params` returns a pepper-derived decoy for unknown emails; legacy PBKDF2 | `security_check.py` (legacy); advisor lists `zk_login_params` as anon-callable by design | ✅ |
| SEC-12 | Leaked-password protection is on in Supabase Auth | A platform setting | the advisor reports it **disabled** on the demo project | ⬜ |
| SEC-13 | Privileged access to key and ciphertext tables is recorded and tamper-evident | `audit_log` (append-only, triggers) | `db/tenant/13_audit_log.sql`; see LOG-1 | ✅ |
| SEC-14 | Staff pages need staff listing **and** a second factor, enforced in Postgres | `ops_is_admin()` needs `platform_admins` + `aal2` | `tests/zk_ops_test.mjs` | ✅ (real MFA sign-in not yet exercised) |
| SEC-15 | Customers can use a second factor | Supabase Auth MFA for customer accounts | not offered | ⬜ |
| SEC-16 | Temporary demo access is time-boxed and isolated; the master account cannot be changed by visitors | `docs/demo`, `17_demo_access.sql` | `tests/demo_access_test.sql` | ✅ |
| SEC-17 | Public endpoints are rate-limited and abuse-resistant | demo: 25 sessions, 5 per address per hour, kill-switch; Supabase Auth limits | `tests/demo_access_test.sql`; bot protection (Turnstile) not built | ⚠ (#36) |
| SEC-18 | Security functions run with a fixed `search_path` and only the intended roles can call them | `security definer set search_path = ''`; grants | advisor review below | ✅ with the findings in section C |
| SEC-19 | Static and live security checks run daily and on every change | `security.yml` | CI | ✅ |
| SEC-20 | The legacy worker: no debug endpoint, no wildcard CORS, reads need a session, login table and raw broker history never readable | `cloudflare-worker/worker.js` | `security_check.py` | ✅ |
| SEC-21 | Backups are encrypted before leaving the runner; the passphrase is a secret; R2 keys are scoped | `db/r2_backup.sh` | workflow; R2 scope not inspected | 🟡 |
| SEC-22 | Dependencies and vendored libraries are pinned and updated deliberately | `vendor_libs.yml`, SRI | no vulnerability scan is run | ⚠ |
| SEC-23 | Incident response: who does what if a key leaks, a user reports a problem or data is exposed; how customers are told | — | no written procedure | ⬜ |
| SEC-24 | Customer data requests (export, erasure) and breach notification obligations are understood before public launch | — | not written (see DB-15) | ⬜ |

## C. Security advisor findings (demo project, 20 Nov 2026)

| Finding | Assessment | Action |
|---|---|---|
| Leaked password protection disabled | Real gap | Enable in Supabase Auth settings if the plan allows (SEC-12) |
| `zk_login_params` callable by `anon` | Intended: it is needed before sign-in and returns a decoy for unknown emails | Accepted; documented |
| `demo_*` and `ops_*` functions callable by `authenticated` | Intended: each checks its own caller (`demo_touch`, `demo_end` act only on the caller's own session; `demo_owner_reset_template`, `demo_end_all`, `demo_parity`, `ops_*` refuse non-staff) | Accepted; covered by `tests/demo_access_test.sql`. `demo_parity` was tightened to staff-only during this review |
| RLS enabled, no policy on `broker_secrets`, `demo_sessions`, `demo_settings`, `ops_daily`, `platform_admins`, `sync_jobs` | Intended deny-by-default: only the service role or definer functions touch them | Accepted |

The production project was not inspected for this pack; run the advisor there and record the result (SEC-25 below).

| ID | Requirement | Status |
|---|---|---|
| SEC-25 | The security advisor is run on every project after each migration and its findings are triaged in this table | ⚠ run today for the demo project only |

## D. Test scenarios

- **TS-SEC1** As another user, request someone's `enc_rows` → no rows.
- **TS-SEC2** Inject `<img onerror>` in a ticker name served from the database → it is displayed as text.
- **TS-SEC3** Load a private page → no request to any host other than the project, the relay and ntfy; CSP blocks inline script.
- **TS-SEC4** Call `demo_owner_reset_template` as a visitor → refused.
- **TS-SEC5** Call an `ops_*` function with a password-only staff session → refused (needs `aal2`).
- **TS-SEC6** Change a script file without rebuilding → CI fails on the SRI mismatch.
- **TS-SEC7** Sign in with a leaked password (once SEC-12 is on) → refused.

## E. Accepted risks
- Losing both password and recovery key loses the data. By design; the UI asks the user to check the key weekly.
- Postgres triggers cannot see reads; privileged reads are covered by Supabase logs and by everything readable being ciphertext (zero-knowledge build only; the legacy, demo and multi-user builds hold plaintext and rely on row-level security).
- Screening aids are not financial advice; each section says so.

# Logging and audit requirements

What is recorded, what must never be recorded, how long it is kept and who can read it. Today the product has strong audit of privileged access and operational history from GitHub Actions and Supabase, but **no central application log, no redaction rule and no alerting beyond what GitHub and the ops page show**. Those are listed as gaps, not hidden.

## A. What exists today

| Source | What it holds | Who reads it | Kept |
|---|---|---|---|
| `audit_log` (Postgres) | Privileged writes to `user_keys`, `enc_rows`, `broker_secrets`: actor, customer, table, operation, row id, time, caller and database user; plus `DEMO_OWNER_RESET` events. **Metadata only, never ciphertext, keys or values** | The customer sees their own entries; staff with the service role can read all; nobody can change or delete (append-only trigger) | no deletion; no retention limit written |
| Supabase API and Postgres logs | Requests and database activity, including privileged reads | Project owner in the Supabase dashboard | the docs say at least 90 days (plan-dependent, not verified here) |
| GitHub Actions run history | Result of every scheduled and test workflow | Public repository; the ops page lists recent runs and failures | GitHub's default |
| `ops_daily` | Database size, record counts, users and active users, one row a day | Staff only (second factor) | kept |
| `demo_sessions` | Demo session start, end, reason, hashed address (no email, no raw IP) | Staff only | 30 days |
| `demo_settings.last_refresh` | Outcome of the last daily demo refresh | Staff | latest only |
| Service output (`print` in `services/*.py`, `monitor.py`) | Pipeline progress in Actions logs | Anyone who can read the Actions log (public repo) | GitHub's default |
| Browser console | `console.error` for a failed tab load and a blocked handler | The user's own browser | session |

## B. Requirements

| ID | Requirement | How | Check | Status |
|---|---|---|---|---|
| LOG-1 | Every privileged write to key, ciphertext and broker-secret tables is recorded with who, what, which customer and when | `audit_privileged()` triggers | `db/tenant/13_audit_log.sql`; `tests/zk_ops_test.mjs` shows the events | ✅ |
| LOG-2 | The audit log is append-only; updates, deletes and truncates are refused | `audit_log_immutable` trigger | in the migration | ✅ |
| LOG-3 | A customer can see who touched their data | Policy "own audit read" | `rls_isolation_test()` covers isolation of own rows | ✅ |
| LOG-4 | **Never log** plaintext holdings, tickers or amounts, the broker key or secret, passwords, recovery keys, session tokens, ciphertext, raw email addresses in demo usage, raw IP addresses | Design rule; audit stores metadata only; demo stores a salted hash of the address | `tests/standards_test.py` checks no demo password in the repo; no log-content scan exists | ⚠ |
| LOG-5 | Logs in the public repository (Actions output) contain no secret or customer data | Secrets masked by GitHub; services print counts and names of steps | no automated scan of printed output | ⚠ |
| LOG-6 | Privileged **reads** are covered | Supabase logs ≥ 90 days; in the zero-knowledge build everything readable is ciphertext | retention not verified | 🟡 |
| LOG-7 | Failed scheduled jobs are visible to staff | Ops page lists failed Actions runs | `tests/zk_ops_test.mjs` | ✅ |
| LOG-8 | A retention period is defined for `audit_log` and Supabase logs, and long-term copies are kept if the plan's log retention is shorter than the legal need | — | not defined | ⬜ |
| LOG-9 | Growth history is recorded daily without a person opening the page | `ops_record_daily()` runs only when staff open the page | a scheduled job is not set up ("nothing runs while closed" applies to customers, not to staff metrics) | ⚠ |
| LOG-10 | Demo sessions leave a usage record without personal data | `demo_sessions`: reason, times, hashed address | `tests/demo_access_test.sql` | ✅ |
| LOG-11 | Client-side errors are captured safely: a short error code and the area, never data, sent only if the user opts in | — | not built; errors only reach the browser console | ⬜ |
| LOG-12 | Edge Function and Worker errors are logged with a request id and no payload, and staff can see them | Edge Function logs `demo-access failed` with the error text only; Worker has some `console` output | no staff view; ops "Worker errors" needs a provider token (#17) | ⚠ |
| LOG-13 | Alerting: staff are told when a backup, sync or security check fails, the database nears its size limit, or auth error rates spike | GitHub emails on failed runs (default) | no alert for database size, auth errors or Worker errors | ⬜ |
| LOG-14 | Logs and audit entries are time-stamped in UTC and carry an actor, so an incident can be reconstructed | `audit_log.at`, `actor`, `caller_uid` | in the migration | ✅ |
| LOG-15 | Log access is itself limited and recorded | Supabase dashboard access (owner); service-role key held in GitHub secrets | access list not reviewed here | 🟡 |
| LOG-16 | A redaction rule and test: any new log line or audit field is reviewed against LOG-4; a test fails if a log call prints a secret-like value | — | not built (backlog #21) | ⬜ |

## C. Test scenarios

- **TS-LOG1** Write to `enc_rows` with the service role → one `audit_log` row (service role, customer id, table, operation) and no ciphertext in `detail`.
- **TS-LOG2** As the owner in their own session, write an encrypted row → no audit row (not privileged).
- **TS-LOG3** Try to update or delete an audit row → refused.
- **TS-LOG4** Reset the demo master as the owner → one `DEMO_OWNER_RESET` row; password not in the row.
- **TS-LOG5** Break a scheduled workflow → the ops page lists the failed run.
- **TS-LOG6** (once LOG-16 exists) Add a log line that prints a token → the check fails.

## D. Data protection notes
Audit entries about a customer are personal data about that customer. They are visible to them, kept without a deletion path (append-only) and need a stated retention and erasure position before public launch (LOG-8, DB-15).

# CapitalLens — Tier 3 (zero-knowledge) cutover plan

Owner: HOOP (`cilangovan`) · Tracking issue: #7 · Plan written 18 Nov 2026 · Status: **in progress — step 2 (additive SQL) authorised**
Companion docs: `SECURITY_TIER3_DESIGN.md` (why/how), `PHASE5_GO_LIVE_RUNBOOK.md` (controls, audit log, pen-test scope, risks).

## 1. What we are delivering
> "Even our own people cannot see customer data."
Customer data (positions, orders, dividends, alerts, watchlist, strategy…) is encrypted **in the customer's browser** with a key derived from their password (and a recovery key). The database, backups, the service key and staff see only ciphertext. All analysis (returns, strategy, alerts, watchlist verdicts…) runs in the browser. A tiny stateless relay forwards read-only calls to Trading 212 and Yahoo and stores nothing.

Accepted trade-off (decision A, 18 Nov 2026): **nothing runs while the app is closed.** The owner opens the app each morning and presses Refresh; sync, analysis, alerts and the phone push happen then.

## 2. Where we are (18 Nov 2026)
| Area | State | Evidence |
|---|---|---|
| Crypto + key handling (PBKDF2→HKDF, AES-256-GCM, wrapped data key, recovery key) | Built, tested | `tests/zk_crypto_test.mjs` (20) |
| Encrypted row store | Built, tested, verified in real Chrome (demo) | `docs/zk/store.js` |
| Browser ports of every Python service (sync, monitor, returns, pie history, profit booking, strategy, holding decisions, value-buy, alert report, analyst ratings, watchlist, flow) | Built; byte/1e-9 parity vs the Python originals | 21 JS suites, CI `zk_tests.yml` |
| Private dashboard `/zkapp/` (ZK login, all dashboards, Refresh pipeline, phone push, watchlist search/add/chart) | Built; verified in real Chrome on the **demo** project | issue #7 comments |
| Relay (`capitallens-relay`) | Deployed; fixed `redirect:'error'` bug (Workers reject it); live-verified against Yahoo | commits 2ea1127, 1f75722 |
| Strict CSP (no inline script) + eval-free handler layer + SRI on all scripts | Done; attack-tested in Chrome | `docs/zk/handlers.js` |
| Audit log (append-only, customers can read own entries) | Applied to **demo**; tested | `db/tenant/13_audit_log.sql` |
| Production database | Untouched by Tier 3 so far (recon 18 Nov: 1 user, ~8,000 plaintext rows, no ZK tables) | runbook "Dry-run findings" |
| Not yet exercised against real services | Trading 212 sync with a real key; ntfy push; password reset/change flows | — |

## 3. Decisions log
| Date | Decision | By |
|---|---|---|
| 18 Nov | Go for **Tier 3** (zero-knowledge); history rewrite for attribution cleanup OK; rollback plan + issue #7 (close when successful) | owner |
| 18 Nov | Market data: **both** — central public cache for a curated popular set + relay fallback | owner |
| 18 Nov | Closed-app behaviour: **option A** (open app, press Refresh) | owner |
| 18 Nov | Commits authored `cilangovan <7702527+cilangovan@users.noreply.github.com>`, **no Claude attribution lines**; push straight to `main` | owner |
| 18 Nov | Every production change needs explicit go-ahead; plaintext is deleted only after verification + a week of parallel use | owner |
| 18 Nov | Additive SQL (step 2) authorised "if safe" | owner |

## 4. The cutover, step by step
Legend: 🟢 safe/additive · 🟠 changes production behaviour · 🔴 irreversible. **Gate** = what must be true before the step. **Undo** = how to back out.

### Step 1 — Pre-flight 🟢 (done)
Gate: all `tests/zk_*_test.mjs` green in CI; `/zkapp/` verified in a real browser on demo; relay deployed and live-checked; production recon done.

### Step 2 — Additive SQL on production 🟢 (authorised; see Execution log)
Apply, one at a time, to project `kloqkcxchstfoljpqcbq`, checking after each:
1. `10_zk_keys.sql` — **without the `zk_probe` demo table**: `user_keys` (salts + wrapped keys, owner-only RLS), Vault secret `zk_salt_pepper`, function `zk_login_params` (login salts; fake stable salt for unknown emails).
2. `11_zk_enc_rows.sql` — `enc_rows` (ciphertext rows, owner-only RLS).
3. `12_market_cache.sql` — public market cache (signed-in read, service-role write).
4. `13_audit_log.sql` — append-only audit log + triggers on `user_keys`, `enc_rows`, `broker_secrets`.
Verify: tables exist with RLS on and the right policies; advisor shows no new ERROR/regression; a rolled-back test proves (a) owner writes are not logged, (b) service-role writes are, (c) the log cannot be edited; the live app still loads and shows the same numbers.
Undo: `ROLLBACK_zk_phase2_5.sql` (drops only the new objects). Nothing existing is touched.

### Step 3 — Production page variant 🟢
Build `/zkapp/` and `/zk/` for the **production** Supabase project (URL + publishable key + CSP `connect-src`) into a separate output folder; keep the demo variant for testing. Production `/zk/` has **no "private notes" probe**. CI `zk_tests.yml` guards both builds. The legacy dashboard keeps working at its current URL.
Gate: step 2 verified. Undo: delete the folder.

### Step 4 — Migrate the owner's data 🟠 (needs go-ahead; owner types the password)
At the production `/zk/`: log in with the existing email/password → **"Upgrade it to a private account"**. The browser (1) creates the key material, (2) reads each plaintext table, encrypts every row with AAD `table|id|userId`, uploads to `enc_rows`, (3) verifies per-table row counts and a content fingerprint (`ZKMigrate.verify`). **Save the recovery key offline** (password manager + paper). Plaintext is **not** deleted.
Gate: step 3 live. Undo: delete the user's `enc_rows`/`user_keys` rows (surgical), or `ROLLBACK_zk_phase2_5.sql`.
Acceptance: per-table counts equal plaintext counts (see §6); `/zkapp/` dashboards match the legacy app side by side (totals, positions, alerts, returns, watchlist).

### Step 5 — Parallel run 🟠 (≥ 7 days)
Use `/zkapp/` every morning: Refresh (needs the Trading 212 key — generated read-only in Settings → API; first Refresh does a full history re-sync). Keep the legacy jobs running read-only for comparison. Review the audit log weekly. Fix any numeric differences before moving on.
Gate: step 4 accepted. Undo: just keep using the legacy app.

### Step 6 — Stop server jobs and retire all-access paths 🟠 (needs go-ahead)
1. Disable the workflows that read customer tables: `t212_sync`, `daily_services`, `monitor`, `watchlist`, `weekly_intelligence`, `db_maintenance` (keep `public_market.yml` + flow job — shared tables only; schedule them now).
2. Delete the legacy single-user worker (`capitallens-proxy`, `deploy_worker.yml`), the broker Edge Function and its tables/Vault secret (`broker_connections` has 0 rows in production — never used). **Keep** the Vault secret `zk_salt_pepper`.
3. Remove `SUPABASE_SERVICE_KEY` from GitHub secrets (give the public-market job a narrowly scoped DB role instead); **rotate** the service key and JWT secret; retire `dashboard_auth`.
Gate: step 5 complete with zero unexplained differences. Undo: re-enable workflows; redeploy worker from git (still in history).

### Step 7 — Drop plaintext customer tables 🔴 (needs explicit go-ahead; point of no return)
Take a final **encrypted** backup, run a restore test into a scratch project, confirm recovery key works (log in with it once), then run `ZKMigrate.purgePlaintext` / drop the plaintext tables. After this, the "full rollback" (§5) no longer restores readable data unless the pre-Tier-3 backup is kept — **keep the `rollback_20261118` schema export offline until you are certain.**
Gate: steps 4–6 accepted; fresh restore test passed; owner confirms.

### Step 8 — Close out
Tick every box on issue #7, verify production, close the issue. Publish the plain-language security page (including: nothing runs while the app is closed; forgotten password + lost recovery key = data unrecoverable by design).

## 5. Rollback matrix
| If you are at… | Do this | Effect |
|---|---|---|
| Steps 2–3 | `ROLLBACK_zk_phase2_5.sql`; delete page variant | Back to today, nothing lost |
| Step 4–5 | Surgical delete of the user's `enc_rows`/`user_keys` (or the SQL above); keep using legacy | Plaintext untouched |
| Step 6 | Re-enable workflows / redeploy worker from git | Legacy path restored |
| Any time before 7 | Say **"rollback"** → reset `main` to `restore/pre-tier3-2026-11-18` (0f0268f) and restore tables from schema `rollback_20261118` | Complete return to pre-Tier-3 |
| After 7 | Only from the offline pre-Tier-3 backup | Point of no return — hence the week of parallel running |

## 6. Verification checklist (tick during steps 2–5)
- [ ] Step 2: 4 objects present, RLS on, policies owner-only, advisor clean of new problems, rolled-back audit test passes, legacy app unchanged
- [ ] Step 4 per-table counts (plaintext → encrypted): positions ~1,300 · portfolio_snapshots 36 · alerts 26 · dividends ~400 · t212_dividends ~400 · t212_orders ~2,800 · t212_transactions ~600 · realised_pnl ~2,700 · holding_decisions 64 · value_buy_scores 32 · pie_history 9 · profit_booking 32 (+ summary 1) · returns_summary 1 · strategy_recommendations 1 · watchlist 9 · watchlist_analysis 9 · archives as present
- [ ] `ZKMigrate.verify` reports `same: true` for every table
- [ ] Dashboards: Overview totals, Positions, Analyst, Strategy, Profit Booking, Returns, Watchlist, Alerts equal the legacy app (allow rounding ≤ 1p)
- [ ] Recovery-key login tested once, then logged out
- [ ] Phone push received from a Refresh (ntfy topic saved encrypted)
- [ ] `select * from audit_log` shows only the migration/maintenance actions you expect

## 7. Owner action checklist (cannot be done from code)
- [ ] MFA on GitHub, Supabase, Cloudflare, Google
- [ ] Supabase Auth: leaked-password protection ON; min password length ≥ 10; log retention ≥ 90 days
- [ ] Generate a **read-only** Trading 212 API key (Settings → API); never paste it anywhere except the Refresh panel
- [ ] Store the recovery key offline
- [ ] Branch protection on `main` once you stop pushing straight to it
- [ ] Delete "Generated by Claude Code" footers from PRs #1–#4 and issues #5/#7 bodies; delete the `t212-monitor.pages.dev` Cloudflare project
- [ ] Book the external pen test (scope in `PHASE5_GO_LIVE_RUNBOOK.md`)

## 8. Risk register
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Forgotten password **and** lost recovery key | Low | Total data loss (by design) | Recovery key offline; sign-up page says so; Trading 212 can always re-sync history |
| XSS in the dashboards leaks an unlocked key | Low | High | Strict CSP, eval-free handlers, allowlist, SRI, `defuse`, `connect-src` limited; pen test of `innerHTML` rendering |
| Relay outage / Yahoo rate limits | Medium | Charts/analysis degraded | Central market cache first, relay fallback; steps degrade with clear messages |
| Browser analysis differs from the Python numbers | Low | Wrong decisions | Parity-tested; step 5 side-by-side week |
| Staff/service-key misuse | Low | High | Service key retired (step 6); audit log; MFA; ciphertext only |
| Reads by privileged roles are not in the audit log | Known | Medium | Supabase logs ≥ 90 days; everything readable is ciphertext |
| Stale SRI hash breaks the page | Medium | Page won't load | CI regenerates and diffs `docs/zkapp`; test fails on stale hash |

## 9. Execution log
| When (UTC) | Step | What happened | Result |
|---|---|---|---|
| 18 Nov 13:47 | 2 | Plan written; go-ahead given ("apply to production if safe") | see below |

*(Entries below are appended as steps run.)*

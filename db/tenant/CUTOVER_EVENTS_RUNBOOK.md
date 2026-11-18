# CapitalLens Tier 3 — cutover and migration: event log as runbook items

Snapshot written 18 Nov 2026, 22:52 UTC. Times are UTC, taken from the cutover execution log and from commit timestamps; where an event has no exact time it is placed by the surrounding commits and marked "~".
Companion docs: `CUTOVER_PLAN.md` (the plan, gates, rollback matrix), `PHASE5_GO_LIVE_RUNBOOK.md` (controls, audit log, pen-test scope), `SECURITY_TIER3_DESIGN.md`.

How to read it: every event has **Run-book item** = what to do (or check) next time so the event does not repeat. Part B collects those into one checklist to run before and during any future migration (a second customer, or a rebuild).

---

## Part A — Event log (18 Nov 2026, UTC)

### A1. Build and pre-flight (10:31 – 13:46)
| Time | Event | Commit | Run-book item |
|---|---|---|---|
| 11:34 | Tier 3 design written (audit, threat model, phases, decisions). Owner decisions: go for zero-knowledge, public market cache + relay fallback, **closed app = open and press Refresh**, no Claude attribution on commits, every production change needs explicit go-ahead. | 0f0268f | Record decisions in the plan's decision log before building. |
| 11:37 – 12:42 | Crypto core, sign-up/login/recovery page, encrypted row store, browser ports of every Python service (sync, monitor, returns, pie history, profit booking, strategy, holding decisions, value-buy, alert report, analyst ratings, watchlist, flow), each with Python parity tests. | de9a4a5 … 65081b4 | A port is not done until a parity test against the Python original passes. |
| 13:02 – 13:08 | Read adapter (PostgREST dialect over decrypted rows) and the private dashboard `/zkapp/` with one-button Refresh. | 1b16e00, c67076f, 4d4d3a9 | Test every dashboard query the old pages make (41 queries). |
| 13:19 – 13:20 | Relay bugs found against live services: upstream exceptions returned Worker error 1101; Cloudflare Workers reject `redirect:'error'`. | 1f75722, 2ea1127 | Live-verify the relay against Yahoo and Trading 212 before relying on it; unit tests do not catch runtime restrictions. |
| 13:31 – 13:43 | Append-only audit log, SRI hashes on scripts, CI for zero-knowledge tests, strict CSP (no inline script) with an eval-free handler allowlist. CI caught an untracked `popular_tickers.json` (hidden by an ignore rule). | a275e9a … 50d9eac | Keep the CI diff guard on generated pages; check `.gitignore` rules against new data files. |
| 13:46 | Production recon: 1 user, ~8,000 plaintext rows, no ZK tables. | 1e8d2f2 | Always recon production (row counts per table) before step 2. |

### A2. Step 2 — additive SQL on production (13:47 – 13:50) ✅
| Time | Event | Result | Run-book item |
|---|---|---|---|
| 13:47 | Plan written; go-ahead given ("apply to production if safe"), scope = additive SQL only. | — | Written go-ahead with scope before touching production. |
| 13:49 | Baseline security advisors recorded (3 INFO, 1 WARN: leaked-password protection off). | baseline | Record advisor baseline first so changes are attributable. |
| 13:49 – 13:50 | Applied `user_keys` + Vault `zk_salt_pepper` + `zk_login_params` (no `zk_probe`), `enc_rows`, `market_cache`, `audit_log`. | RLS on, owner-only policies, anon cannot read, fake salts stable per email | Apply one at a time and check after each. |
| 13:50 | Rolled-back test as owner, other user and service role. | Owner writes not logged; service-role writes logged; log cannot be edited; cross-user write blocked | Run this proof after any change to RLS or triggers. |
| 13:50 | Post-checks. Legacy tables untouched (positions 1,367 · snapshots 44 · alerts 26 · orders 2,775). | OK | Compare legacy row counts before/after. |

### A3. Step 3 — production page variant (13:55) ✅
| Time | Event | Commit | Run-book item |
|---|---|---|---|
| 13:55 | Production pages built by `scripts/build_zkapp.py` (`zk-prod`, `zkapp-prod`): production URL/key, CSP without the demo host, separate sign-in storage keys (`zkp_*`), no demo probe, no plaintext-delete button. | 9f7c6e4 | The build asserts no demo project id appears in production output; keep that assertion. |

### A4. Step 4 — migrate the owner's data (14:34 – 15:00)
| Time | Event | Cause | Fix | Run-book item |
|---|---|---|---|---|
| 14:34 | First upgrade ran: 8,479 rows, all 17 tables matched. Owner then could not log in. | The sign-up box on the account page showed a recovery key for an email that already existed, so the owner generated several recovery keys and none matched the account. Supabase reset emails were rate-limited (429). | Sign-up no longer shows a key for an existing email; sign-up box removed from the production page (6efc659). | One sign-in page, one obvious path. Never show a recovery key unless the account was actually created. |
| ~14:40 | Owner: "Invalid email or password" repeatedly; typed the temporary password in the normal Log in box. | Normal login derives the key from the typed password and the stored salt; a temporary password only works in the one-time upgrade flow. | Upgrade option removed after upgrade; clear one-time setup flow with repeat-password check (7cef04c, e57c3d3). | State in the UI which box takes which password; confirm the new password by typing it twice. |
| 14:55 | **Redo, with explicit go-ahead ("option 2")**: deleted the owner's `enc_rows`/`user_keys`, set a temporary auth password. Plaintext untouched (positions 1,367 · orders 2,775). | Cleanest recovery from several unusable key sets. | Audit log recorded 8,480 privileged deletes (expected). | Surgical delete of the user's ZK rows is the standard undo for steps 4–5. |
| 14:58 | Second upgrade via "Set up my private account". | — | 8,479 encrypted rows, 1 key set, all 17 tables match, password switched after encryption. | Verify counts per table before changing the password. |
| ~15:00 | Owner confirmed login and data visible; pasted "Show what is stored" counts (all equal). | — | Step 4 logged complete (724a4f6). | Acceptance = per-table counts equal plaintext + dashboards match legacy. |

### A5. Step 4/5 — what the first live use exposed (15:10 – 17:21)
| Time | Event | Cause | Fix | Run-book item |
|---|---|---|---|---|
| ~15:10 | First Refresh blocked the screen ("full walk page 1…7, 0 new") for minutes. | Refresh ran in the foreground. | Refresh minimises to a progress chip, warns before closing the tab (5e2dafe); credentials cleared as soon as read (d36e49b). | Long jobs run in the background with visible progress. |
| 15:28 | Analyst tab empty. | `analyst_ratings` (32 rows) was never on the migration list: it was treated as shared reference data. | Regenerated by Refresh; added to `TABLES` (1f8b1fd). | **Table inventory gate**: classify every public table with rows against the migration list before step 4 and step 7 (see `CUTOVER_PLAN.md`). |
| 15:28 | Also found at the same check: `profiles.ntfy_topic` is a plaintext secret. | Not part of the encrypted set. | Blank at step 6 once the topic is saved encrypted. | Scan profile-type tables for secrets. |
| 15:42 | Compare: private 3,525 orders vs old 2,775, 0 differing ids = **750 duplicates**. | Migration stored rows under random ids; the app stores rows under ids derived from the natural key, so a re-sync wrote a second copy of everything it re-read. Same in 8 other kinds. | `dedupe.js` Scan/Fix (write deterministic copy, re-read, then delete extras); migration now writes deterministic ids (555f923). | Migration must use the same id rule as the app. After migration run Scan; expect 0 extra. |
| ~15:45 | Owner: "none of my saved keys work i lost it". | Several recovery keys in circulation. | Replace the recovery key while signed in (confirm before activating, verify after save) (7f71aa3); recovery-key check (local only) and weekly reminder under Settings (624c584). | A recovery key must be testable without logging out; remind weekly. |
| 15:51 | Owner ran Fix duplicates. Server check: 16 of 18 tables equal to plaintext; alerts 32 vs 26 and holding_decisions 96 vs 64 explained by new Refresh runs. Scan later showed 0 extra everywhere. | — | Duplicates resolved (5bed2cc). | Explain every count difference; "expected" needs a reason. |
| 16:48 – 16:50 | Settings window had unclear Help/Minimise/Close buttons. | Text buttons, no standard window controls. | Mac-style close/minimise dots and a round help button (536cca7, 2a2069e). | Match familiar window conventions. |
| 17:18 – 17:21 | Peter Lynch six-bucket classification added to the Analyst tab (browser) and the old app (Python mirror). The first Python push broke the JS/Python analyst parity test (10 failures); fixed in 6b1802e. | Python added "Unclassified" rows when no fundamentals existed. | Only add Lynch fields when fundamentals exist. | Parity tests are the guard; run them before pushing a Python mirror change. |

### A6. Step 5 — parallel run, day 1 (21:43 – 22:49)
| Time | Event | Cause | Fix | Run-book item |
|---|---|---|---|---|
| 21:43 – 21:46 | Owner had to press Refresh after every release to see new analysis. | Analysis code changes did not invalidate stored results. | Auto re-analysis on login when stale (6h) or when `ZK_ANALYSIS_VERSION` changed (6e177b6); CI guard fails if analysis code changes without a version bump (393dc95). | Any change to analysis code bumps `ZK_ANALYSIS_VERSION`; CI enforces it. |
| 21:48 – 21:53 | Mobile layout test failed at 360px (popups 382px wide). | **The header row** (title, LIVE pill, timestamp, Sign out) was too wide and stretched the whole page, so fixed popups inherited the wider layout viewport. First two CSS fixes on the popups did not help. | Header wraps on small screens (f17ba68). Found by reproducing the test locally with synthetic data. | Reproduce CI failures locally with synthetic data before guessing; the failing element is not always the one named. |
| 22:00 | Lynch refinement: blend earnings and revenue growth (each capped ±100%); SGLN, SSLN and similar precious-metal ETCs classed as Fund; analysis version `lynch-2`. Python rounding differed from JS (8.5% shown as "8%" vs "9%"). | Yahoo's earnings growth is a noisy single quarter; Python rounds halves to even. | 919461f | Parity tests must cover formatting, not only values. |
| ~22:05 | Overview differed: private £9,274.08 / P&L £49.71 vs old £9,226.92 / P&L £2.80. | The private app was showing the **migrated 04:05 snapshot** (exact match to the old 04:05 row); no Refresh with the Trading 212 key had written a newer one. Not a calculation bug (`monitor.js` and `monitor.py` compute totals identically). | Refresh the old side (monitor workflow dispatched via REST) and Refresh the private side. | Compare both sides **after refreshing both**; check the snapshot timestamp first. |
| 22:30 | Refresh ran 8+ minutes ("orders full walk page 22…"). | The migration did not carry `sync_state`, so every endpoint looked never-synced → full walk of 2,775 orders (~56 pages at 6 requests/min); interrupted runs restarted from zero. | Full walk only when the store is empty or a previous walk was cut off (`walking` marker); migrated history is incremental (1f3215d). Refresh ≈ 1 minute. | A migration must carry or seed every piece of sync state, not just the data. |
| 22:32 | Refresh failed with `M.T212 is undefined` / `M.Client is undefined`. | GitHub Pages caches each file ~10 min on its own clock: new HTML paired with an old cached script; the integrity hash blocked it. | Every script URL carries its content hash (`?v=…`) (71d8b4c). | After any deploy, wait for Pages to finish; hashed URLs make mismatches impossible. |
| 22:41 | **First real Refresh with a read-only Trading 212 key**: history incremental, 32 positions / 7 pies saved encrypted, all steps ✓. | — | — | — |
| 22:45 | Old dashboard refreshed: £9,225.68 · cash £4,343.72 · P&L £1.38. Private (22:41): £9,225.60 · £4,343.72 · £1.21. Winners 11 / losers 21 / positions 32 / alerts 5 identical. | Differences (8p, 17p) = the 4-minute gap. | Logged in the cutover plan, issue #9 and the Project doc. | Accept when totals agree within pennies and counts are identical. |
| 22:49 | Overview shows data age and a stale-data warning banner (>12 h) with a Refresh button. | Stale numbers looked live. | bd6be84 | Every dashboard states when its data is from. |

---

## Part B — Repeatable checklist (derived from the events above)

### Before step 2 (additive SQL)
- [ ] Written go-ahead with scope; advisor baseline recorded; production recon (row counts per table, users, legacy secrets).
- [ ] Rollback script exists and was read (`ROLLBACK_zk_phase2_5.sql`); `rollback_20261118` schema export kept offline.

### Before step 4 (migrate data)
- [ ] **Table inventory gate** run; every table with rows classified (customer / shared / legacy); migration `TABLES` matches the customer list.
- [ ] Migration writes rows with the **same deterministic ids** the app uses; `dedupe` Scan reports 0 extra after migration.
- [ ] Migration **carries or seeds sync state** (or the sync treats existing history as complete).
- [ ] One sign-in page: login / forgot password; a separate clearly named one-time "Set up my private account" with repeat-password check; no sign-up box that can show a key for an existing email.
- [ ] Recovery key saved offline **and** tested (Settings → check, no logout needed); weekly reminder on.
- [ ] Supabase: reset-email redirect URL allow-listed for `/zk-prod/`; custom SMTP to avoid 429 (issue #8).

### During step 4
- [ ] "Show what is stored" counts equal plaintext for every table; password switched only after encryption; plaintext untouched.
- [ ] If anything goes wrong: surgical delete of the user's `enc_rows`/`user_keys`, temporary password, redo (explicit go-ahead).

### Step 5 (parallel run, ≥ 7 days) — each morning
- [ ] Hard-reload the private app (wait ~10 min after a deploy; script URLs are hashed so a mismatch should not occur).
- [ ] Settings → Refresh with a read-only Trading 212 key; log must show "incremental", all steps ✓, ~1 minute.
- [ ] Compare against the old dashboard **after refreshing both** (same minute): totals within pennies, counts identical, snapshot time shown.
- [ ] Settings → Scan duplicates: 0 extra.
- [ ] Weekly: review `audit_log`; test recovery-key check.
- [ ] After any release that changes analysis code: confirm `ZK_ANALYSIS_VERSION` was bumped (CI enforces) and the app re-analysed on login.

### Release hygiene (every push)
- [ ] `python3 scripts/build_zkapp.py` run; generated pages committed; `tests/zk_*_test.mjs` and Python parity tests green.
- [ ] Mobile layout test green at 360 and 390px (reproduce locally with synthetic data if red).
- [ ] No Claude attribution lines in commits; author `cilangovan`.

### Open items at this snapshot
- Issue #9: live-site sign-in smoke test red; T212 History Sync job red; real-browser end-to-end test (login → Analyst → Lynch) not built.
- Verify Lynch buckets for AMZN, GOOGL, SGLN, SSLN after the next login re-analysis.
- Step 5 days 2–7. Steps 6 and 7 need explicit go-ahead (step 7 is irreversible; run the table-inventory gate first).
- Owner actions in issue #8 (MFA, leaked-password protection, redirect URL, custom SMTP, delete attribution footers, pen test).

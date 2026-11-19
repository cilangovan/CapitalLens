# Architecture & security

## Components

```
Browser ── GitHub Pages (static, docs/) ─────────────────────────────────────┐
   │  dashboards: / · /demo/ · /app/ · /zkapp/ · /zkapp-prod/ · /zk-prod/     │  /help/ (this portal)
   │                                                                          │
   ├─ legacy  ──► Cloudflare Worker `capitallens-proxy` ──► Supabase (service key, allow-listed tables)
   ├─ multi-user ► Supabase REST + Auth, row-level security
   └─ private ──► Supabase (ciphertext only) + stateless relay `capitallens-relay` ──► Trading 212 / Yahoo / MSN
GitHub Actions: scheduled pipelines, tests, backups (see Workflows)        Cloudflare R2: encrypted backups
```

| Piece | Where | Job |
|---|---|---|
| Dashboards | `docs/` | Static HTML + vendored JS; no build step for the legacy page |
| Generators | `scripts/build_app.py`, `scripts/build_zkapp.py`, `scripts/build_docs.py` | Produce `docs/app`, `docs/zkapp`, `docs/zkapp-prod`, `docs/zk-prod`, `docs/help` from the sources. Generated files are never edited by hand; CI fails if stale |
| Worker | `cloudflare-worker/worker.js` | Legacy auth, allow-listed `READABLE` tables, watchlist/alert/settings routes, chart route |
| Relay | `cloudflare-worker/relay.js` | **Stateless** pass-through so the browser can call Trading 212 and market sources; stores nothing |
| Services | `services/*.py`, `monitor.py` | Server-side analysis for the legacy/multi-user build |
| Browser engine | `docs/zk/*.js` | The same analysis in the browser for the zero-knowledge build |
| Database | Supabase Postgres | See [Database & data flows](database.md) |

## Zero-knowledge model (Tier 3, user-held keys)

- The data key is generated in the browser. It is stored only **wrapped**: once by the password-derived key, once by the **recovery key** (`user_keys`).
- The server stores ciphertext (`enc_rows.ct`) plus owner, kind, size and time. It never sees plaintext holdings, tickers, amounts or the Trading 212 key.
- **Forgotten password:** recover with the recovery key. **Lost both:** the data cannot be recovered by anyone, by design. Check the key weekly (⚙ Settings).
- **Trading 212 key:** read-only, entered per refresh, used once through the stateless relay, never saved.
- **Audit trail:** privileged writes to `user_keys`, `enc_rows` and `broker_secrets` (anything not the owner in their own session) are recorded in `audit_log` with metadata only. Customers can read their own entries; nobody can edit or delete. Postgres triggers cannot see reads; privileged reads are covered by Supabase logs (≥ 90 days) and by the fact that everything readable is ciphertext.
- Public data (instruments, market cache, IPO calendar) is shared; it contains nothing about any customer.

## Browser security rules

| Rule | Enforced by |
|---|---|
| Strict Content-Security-Policy: no inline scripts in the private app; connect only to the project, relay and ntfy | `scripts/build_zkapp.py`, `tests/zk_zkapp_page_test.mjs`, `tests/security_check.py` |
| No inline handlers except via the whitelisted interpreter | `docs/zk/handlers.js`, `tests/zk_handlers_test.mjs` |
| Everything from the server passes `defuse()`; page code escapes what it inserts | `docs/js/api.js`; JSON columns parsed first |
| Every local script pinned by an SRI hash and a content-hash URL | `scripts/build_zkapp.py`; CI fails if stale |
| No referrer, no framing, `noindex` on private pages | page `<meta>` tags |
| Documentation portal: CSP with no scripts at all | `scripts/build_docs.py` |

## Row-level security

Every table has RLS enabled. Per-user tables allow a user only their own rows (`user_id = auth.uid()`); shared tables allow `authenticated` select only; writes to shared tables are service-role only; `anon` is revoked. `db/tenant/03_rls_isolation_test.sql` proves one user cannot read another's rows.

## Notifications

In-app inbox and **ntfy** phone push (topic stored in settings). Email for multiple users is deferred until a sending domain exists; the owner's personal domain is not used for CapitalLens.

## What is and is not guaranteed

- Prices, ratings, scores and calls are **screening aids built from public data**, not financial advice.
- Where data cannot be verified the UI says so; ratings and dates are never invented and always name their source.
- Limits: Trading 212 allows 6 requests a minute, so a first sync is slow; the private app cannot refresh while closed; the IPO calendar is curated, not a live feed.

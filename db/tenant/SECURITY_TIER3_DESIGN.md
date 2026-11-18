# Tier 3 security: zero-knowledge customer data

**Goal:** nobody on our side (developers, database admins, anyone holding the Supabase service key, GitHub secrets,
Cloudflare or Supabase staff) can read a customer's holdings, orders, balances or returns. Only the customer can.

## Where we are today (audit, 18 Nov 2026)
- Customers are isolated from each other: RLS on all 34 tables, no anonymous reads, broker keys in Vault.
- Staff are NOT locked out: SQL editor / service key read every row in plain text; GitHub secret `SUPABASE_SERVICE_KEY`,
  the `broker` edge function and the legacy Cloudflare worker bypass RLS; daily Python jobs read and compute on plain data.
- Open advisor items: leaked-password protection off; `app_settings`, `broker_secrets`, `sync_jobs` have RLS but no policy (intended, service-only).

## Threat model
In scope: curious/compromised staff, leaked service key, DB dump or backup theft, malicious SQL.
Out of scope / residual (be honest with customers): a malicious *front-end release* could steal keys (mitigations below);
a customer's own compromised device; Trading 212 itself.

## Design
1. **Keys.** Each customer gets a random 256-bit data key (DK) created in the browser. DK is stored only wrapped:
   once by a key derived from their password (Argon2id/PBKDF2, WebCrypto), once by a one-time **recovery key** shown at sign-up.
2. **Login without telling the server the password.** From the password, the browser derives two independent values (HKDF):
   an *auth secret* (sent to Supabase Auth as the "password") and an *encryption key* (never leaves the browser).
3. **Encrypted rows.** Every customer table keeps only `id`, `user_id`, timestamp, `key_version`, `nonce`, `ciphertext`
   (AES-256-GCM, AAD = table|id|user_id). Tickers, quantities, prices, P&L all live inside the ciphertext. The server cannot filter,
   sort or aggregate; the browser does.
4. **Public reference data stays public** (instrument names, flags, sector weights, analyst/institutional market data). It is fetched
   in bulk so the request pattern does not reveal what a customer holds (the "held only" RLS rule is retired for this reason).
5. **Trading 212 sync moves to the browser.** The customer's T212 API key is stored encrypted under DK. The browser calls T212
   through a stateless, non-logging relay (T212 blocks browser CORS), encrypts the results, uploads ciphertext.
   Residual trust: the relay sees the key and data in transit. Documented, open-sourced, no logging, no storage.
6. **Calculations move to the browser** (returns/XIRR, profit booking, holding decisions, value-buy, strategy): ported from the Python
   services to JS. Anything built only from public market data stays server-side.
7. **Alerts / email / phone push.** Cannot work on ciphertext. Default: evaluated in the browser while the app is open.
   Optional, explicit opt-in "background alerts": the customer shares only thresholds + tickers with the server (this reveals those tickers).
8. **Remove all-access paths:** service key no longer touches customer tables; legacy single-user worker and its service key retired;
   `broker` edge function reduced to a public-data helper; Vault broker-key storage replaced by client-side encryption.
9. **Front-end integrity** (the classic web-app weakness): Subresource Integrity on every script, pinned/signed releases, CSP locked,
   deploy requires two-person approval, optional installable app with signed updates. Published as part of the security statement.
10. **Still do (Tier 1 items):** MFA for all staff accounts, leaked-password protection on, audit log of every service-role call,
    short-lived scoped keys, key rotation runbook, quarterly restore + isolation tests, external pen test before launch.

## Consequences customers must accept
- **Forgot password + lost recovery key = data cannot be recovered** (we cannot help; nobody can). They can reconnect Trading 212 and re-sync history.
- No server-side search/reporting on customer data; support cannot "look at your account".
- Alerts need the app open unless they opt in to background alerts.

## Phases
| # | Deliverable | Notes |
|---|---|---|
| 0 | Decisions below + threat-model sign-off | this document |
| 1 | Crypto core (WebCrypto): derive, wrap/unwrap, AES-GCM, tests with fixed vectors | no data touched |
| 2 | Auth rework: derived auth secret, `user_keys`, sign-up / login / password change / recovery key / reset | breaking for existing logins |
| 3 | Encrypted tables + browser-side migration of the one existing real account, then delete plaintext | brief window where migration reads plaintext |
| 4 | Browser sync via relay; port calculations to JS; client-side alerts | largest piece |
| 5 | Retire service key/legacy worker/Vault flow; audit log; SRI; pen test | go-live gate |

## Decisions needed
1. Alerts: client-only by default + opt-in background alerts? (recommended)
2. Accept "no recovery without recovery key"? (required for true zero-knowledge)
3. Accept the stateless relay for Trading 212 sync as the one trusted hop?
4. Web app only, or also an installable signed app?

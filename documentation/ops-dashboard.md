# Internal operations dashboard (platform team only)

Status: **phase 1 built** (epic #23). Page: `docs/ops/` (not linked from any customer page, `noindex`). Built in-house on purpose: no third-party monitoring service and no service-role key leaves our own systems.

## Who and what

For the people who run CapitalLens, **not customers**. Phase 1 shows: database size and daily growth, largest tables, stored-record counts by kind, users and active users (24 h, 7 d, 30 d), sign-ups for the last 30 days, privileged-access events from the audit log, and recent GitHub Actions runs with failures.

## How access is enforced (in Postgres, not in the browser)

1. The page signs in with Supabase Auth using a **dedicated staff account**, separate from any customer account.
2. The account must be listed in `platform_admins` **and** have passed a **second factor (authenticator app)**. The database functions `ops_overview()` and `ops_record_daily()` refuse any session that is not both (the token must carry `aal2`). A password alone is never enough.
3. The functions are `security definer` with a fixed `search_path` and return **counts and sizes only**: no email, key, ciphertext or portfolio data. Customers have no grants and no policies on `platform_admins` or `ops_daily`.
4. The page holds only the public key. The session lives in memory (nothing in browser storage) and ends on sign-out or reload.
5. Hiding the URL is not the protection; the database refusing everyone else is.

## Making a staff account (owner steps)

1. In the Supabase dashboard, Authentication, add a user (a new staff email and a strong password stored in your password manager).
2. Tell the engineer the account's email. They run one statement that inserts that account's id into `platform_admins`.
3. Open `/ops/` on the Pages site, sign in, and add the authenticator on first sign-in (type the shown key into your authenticator app), then enter the 6-digit code.

## What is not shown yet

API calls, egress, Cloudflare R2 backup size and growth, and Worker errors need a read-only token. They will be fetched by a small server-side function that checks the same staff and second-factor rule, so no token is ever in a page (tracked in #16 to #21). Until then use the Supabase and Cloudflare dashboards. GitHub run data is public, so it is read directly.

## Data and tables

`platform_admins`, `ops_daily` (see the database page); migration `db/tenant/16_ops_dashboard.sql`. Growth needs at least two days of snapshots; the page says so rather than inventing a trend. A snapshot is recorded each time staff open or refresh the page ("nothing runs while the app is closed").

## Tests

`tests/zk_ops_test.mjs` (helpers, no secrets in the page, strict CSP, no storage, the database rule requires the second factor, no grants for customers) and `tests/ops_layout_test.py` (phone layout and the signed-out view).

## Backlog

Epic #23: #15 tooling and access (decided: build in-house), #16 database, #17 API and egress, #18 active users, #19 failed runs, #20 R2, #21 logs and redaction, #22 documentation. The public/admin documentation split is #10; this page moves to the admin-only docs when that is done.

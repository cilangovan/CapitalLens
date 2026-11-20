# Demo user (pre-sales)

Operational guide for the temporary demo logins (epic #32). Requirements, business rules, wireframes and test scenarios are in [demo-requirements.md](demo-requirements.md).

## What a visitor gets
- **Try the demo** on the demo sign-in box (`docs/demo/`). The `demo-access` Edge Function creates a throw-away account, copies the master demo portfolio onto it and shows a **temporary email + password on screen** (Copy buttons, **Open the demo**).
- Valid **1 hour**. Ends earlier after **45 minutes without activity**, or when the tab is closed (90 seconds of grace so a refresh survives). The header shows a countdown, turning amber for the last 5 minutes.
- Expiry is enforced **in Postgres** (restrictive RLS policy `demo_expiry` on every per-user table, via `demo_access_ok()`), not in the page. A cleaned-up account and all its rows are deleted every minute (`demo_cleanup()`, pg_cron `demo-cleanup`); usage rows (no email, hashed IP) are kept 30 days.
- Limits (`demo_settings`): 25 live sessions, 5 per address per hour, and a kill-switch (`enabled`).

## The owner-managed master account
- The template account (`demo@capitallens.test`) is **never handed out**. A trigger on `auth.users` blocks changes to its email/password, and to every visitor account's.
- **Only the owner resets it**: in the Supabase SQL editor run `select public.demo_owner_reset_template();` (prints a new random password once, writes an audit row), or call it with your own password as the argument (12+ characters). Platform admins with a second factor can also call it from the ops dashboard.
- Switch the demo off: `update demo_settings set value='false' where key='enabled';` then `select public.demo_end_all();`.
- Credentials never go in the repo (`tests/standards_test.py` checks this).

## Daily refresh
`demo_refresh()` runs at **05:17 UTC** (pg_cron `demo-daily-refresh`): it re-seeds the master portfolio with `seed_demo_portfolio` so dates are current, and records the outcome in `demo_settings.last_refresh`. New visitors get a copy of the refreshed master.

## Parity today
`select public.demo_parity();` (SQL editor owner or staff only) lists every real-dashboard feature and whether the demo has rows for it. **Not yet filled (shown empty in the demo):** holding decisions, profit booking (+summary), realised P&L, returns summary, strategy recommendations, value-buy scores, watchlist analysis, pie history, the Markets-I-hold cache, IPO calendar and analyst ratings. The seeded portfolio, positions, orders, alerts and dividends are present. The demo page has no market relay, so market charts need a relay route (open item). Prices are synthetic; the daily refresh does **not** pull real market moves yet.

## Deploy / verify
- DB: `db/tenant/17_demo_access.sql`, `18_demo_refresh.sql`. Test: `tests/demo_access_test.sql` (run in the SQL editor; it ends with a deliberate error and rolls everything back, so a message starting `TEST OK` is a pass).
- Function: `supabase/functions/demo-access` (deploy with verify-JWT off; it is public by design and rate-limited in Postgres).
- Client: `docs/demo/demo-session.js`; tests `tests/zk_demo_session_test.mjs`, `tests/demo_layout_test.py`.

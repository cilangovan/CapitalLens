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
`select public.demo_parity();` (SQL editor owner or staff only) lists every real-dashboard feature and whether the demo has rows for it. **Filled by the daily refresh (`db/tenant/19_demo_insights.sql`, `seed_demo_insights`):** Analyst (ratings with Lynch class, institutional flow report), Profit Booking (per-holding score, trim ladder, trailing stop, summary) and Strategy (weekly £75 split, holding decisions, value-buy entry scores). All values are invented for illustration and derived from the demo holdings. **Returns** (`20_demo_returns.sql`): profit curve and period/yearly/monthly breakdown from the demo snapshots, dividends and 5 invented closed trades. **Markets, Watchlist, Pie history, IPO** (`21_demo_markets.sql`, `seed_demo_markets`): mock daily price paths for 13 indices, watchlist symbols and every holding (so Markets I hold, drill-down charts and the Overview history work), a verdict, price points and budget for each of the 5 watchlist items, per-pie history from the snapshots, and 11 fictional IPOs. Parity shows no gaps. **Not available in the demo:** intraday (1D) charts, live search, adding to the watchlist, and IPO bookmarking (they need the live relay). **Why demo-only tables:** the demo shares a Supabase project with the private app, so invented charts, IPOs and the weekly flow report live in `demo_market_cache`, `demo_ipo_calendar` and `demo_institutional_flow_reports`, and `docs/demo/demo-shim.js` maps the routes. Nothing invented is ever written to the shared tables the private app reads. Chart prices are synthetic paths (not market data); watchlist cards are labelled "demo data". The seeded portfolio, positions, orders, alerts and dividends are present. The demo page has no market relay, so market charts need a relay route (open item). Prices are synthetic; the daily refresh does **not** pull real market moves yet.

## Parity guard (issue #28)
`tests/demo_parity_test.py` runs in CI every time and daily: (1) offline, every table the dashboards read must be in the parity list, so a new live feature cannot be forgotten; (2) live, when the repo secrets `DEMO_SUPABASE_URL` and `DEMO_SERVICE_KEY` (the demo project) are set, it calls `demo_parity_gaps()` (service role only, returns feature names only) and fails if any feature is empty. Without the secrets the live part is skipped, not passed.

## Deploy / verify
- DB: `db/tenant/17_demo_access.sql`, `18_demo_refresh.sql`, `19_demo_insights.sql`, `20_demo_returns.sql`, `21_demo_markets.sql`, `22_demo_parity_guard.sql`. Test: `tests/demo_access_test.sql` (run in the SQL editor; it ends with a deliberate error and rolls everything back, so a message starting `TEST OK` is a pass).
- Function: `supabase/functions/demo-access` (deploy with verify-JWT off; it is public by design and rate-limited in Postgres).
- Client: `docs/demo/demo-session.js`; tests `tests/zk_demo_session_test.mjs`, `tests/demo_layout_test.py`.

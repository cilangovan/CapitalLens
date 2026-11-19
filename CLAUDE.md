# CapitalLens — standing requirements (read this before EVERY change)

This file is the single source of truth for what the owner (HOOP, GitHub `cilangovan`) has asked for. Every build, fix and feature must follow it, and
anything new the owner asks for as a *standing* rule is added here in the same change. `tests/standards_test.py` enforces the rules a machine can check.

## How to work (non-negotiable)
1. **Push straight to `main`.** No pull requests, no manual steps for the owner. Maintenance and backups run unattended.
2. **No signatures.** No Claude / Anthropic / `Co-Authored-By` lines in commits, PRs or logs. Commits are authored as `cilangovan` (`7702527+cilangovan@users.noreply.github.com`).
3. **Every bug fix ships with a regression test** that fails without the fix, and it runs in CI every time. Say in the commit which test guards it.
4. **Before pushing:** run `python3 scripts/build_app.py && python3 scripts/build_zkapp.py`, then every suite (`for t in tests/zk_*_test.mjs; do node $t; done`, `python3 tests/standards_test.py`, the python UI tests). Generated pages must not be stale.
5. **Roll a feature out to EVERY dashboard**: legacy `docs/index.html`, `docs/demo`, `docs/app`, `docs/zkapp`, `docs/zkapp-prod`. Edit the sources (`docs/index.html`, `docs/demo/index.html`, `docs/js/*`, `docs/zk/*`) and rebuild; never edit generated files.
6. **Be consistent**: reuse the existing patterns (collapsible cards, chips, `.w-cats` tabs, `api()` helper, defuse, encrypted store). Before adding UI, look at how the nearest existing feature does it.
7. **Be honest about data** (and use Trading 212's own definitions for account figures: investments value, cost basis, unrealised result; label estimates): if data can't be verified, say so in the UI (no fake "clear" status). Never invent ratings, prices or dates; name the source.
8. When finishing a task, report what was verified and what could not be (e.g. no live data offline).
9. **Documentation is part of the product, in git.** `documentation/` holds the complete docs: a page per menu (`documentation/menus/`), the UI and style guide, database and data flows, workflows, architecture and security, engineering guide. Any change to a menu, UI pattern, table, workflow or rule updates the matching page **in the same commit**, then run `python3 scripts/build_docs.py` (it regenerates `documentation/reference/*` from the code and the portal `docs/help/`). Never edit `docs/help/*` or `documentation/reference/*` by hand.

## UI rules
- **Mobile first.** The owner views on a phone. Every dashboard/section must fit 360px and 390px with no sideways scroll, and this is checked by automated UI tests every time (`tests/ui_layout_test.py`, `tests/ipo_layout_test.py`). Tap targets >= 40px.
- **Every dashboard section/sub-section is collapsible**, and the open/closed state is stored in the database per user (`user_ui_prefs`), remembered across logout/login (`docs/js/collapse.js`; any `.card` with an `<h3>` gets it automatically).
- **Tooltips**: P&L bubbles (and similar) show the full name and country flag for every holding. New tooltip/dashboard features are rolled out across every dashboard.
- **Alerts are review reports**: holding weight vs strategic target with difference; threshold check (latest GBP price, daily change, 20-day closing high, drawdown); a review flag; a data-coverage note. No alert or "clear" status for holdings whose data can't be verified. Alerts behave like an inbox: mark read, dismiss, archive (dated Archived category), retrieve/restore.
- **Watchlist** is split into Stocks, Commodities, Crypto: search any stock worldwide + crypto via Yahoo/MSN Money, commodities via Trading 212 or markets; bookmark for weekly purchase with an enter/hold/accumulate call, entry price points, how much to buy, RSI, volume and quality; removing an item stops tracking it. **IPO Watch** (card under Watchlist) works like the stock watchlist: **nothing is preloaded**; you search the IPO calendar (all markets) by company, ticker, **exchange or country** (country chips + exchange filter), ☆ Bookmark what you want and it appears under **My IPO list** (per user, encrypted); ✕ removes it. Each IPO shows where it lists, status, rating **with its source**, opens/closes/listing dates.
- A **Profit Booking Strategy** dashboard supports profit-booking and capital-protection decisions.
- Shares held outside pies (NVIDIA, SpaceX, SGLN…) are listed on the positions dashboard in an **Untagged** category. The Emerging Markets pie is included everywhere.
- History (value, 24h change, rate of return, 1D–1Y charts) comes from Trading 212's own data stored in Supabase, shown as a positions drill-down.
- **Every dashboard has a footer with a 📘 Documentation link** to the portal (`/help/`, relative to the page: `help/` from `docs/index.html`, `../help/` from the others), plus a link on the sign-in box. The portal also fits 360px/390px (`tests/docs_layout_test.py`).
- **Never a blank screen while loading:** the private app shows a boot splash (spinner + text) until the sign-in box or the dashboard appears, and every card's "Loading…" placeholder has a spinner (`.loading.busy`). CSS-only (strict CSP); checked by `tests/login_flash_browser_test.py`.
- No login flash on refresh: the sign-in box stays hidden until the saved-session check finishes (`tests/login_flash_browser_test.py`).

## Data and security rules
- **Zero-knowledge (Tier 3, user-held keys)** is the model for customer data: the server never sees plaintext holdings. Per-user data goes in the encrypted store (`enc_rows`, `docs/zk/store.js`); only public data (instruments, market cache, IPO calendar) is in shared tables.
- **No holdings data in JS files** and no hardcoded ETF names/flags: they live in the database and are served to every dashboard. (Lists in JS are not secure for a multi-tenant app.)
- Everything from the server passes `defuse`; page code escapes anything it puts in HTML. Strict CSP: no inline scripts, no new inline handlers except via the whitelisted interpreter (`handler-names.js`). Parse JSON columns *before* defuse (it swaps `"`), see `parseJsonCols` in `docs/zk/shim.js`.
- Treat all portfolio data as precious: keep **45 days** of history in live tables, move older rows to archive tables (never delete); cleared alerts are deleted after **30 days**. Encrypted daily backups of the Supabase DB go off-site to **Cloudflare R2**.
- For zero-knowledge market data: central public tables for a popular subset **plus** the stateless relay as fallback for other tickers. **Nothing runs while the app is closed**: the owner opens the app each morning and presses Refresh (sync, alerts and phone push happen then). Multi-user email alerts are deferred until a domain exists; in-app alerts and ntfy push only. Do not use the owner's personal domain for CapitalLens.
- The original Supabase project (t212) is converted to multi-user in place; keep the old GitHub Actions pipeline running until per-user results match.

## Product rules
- The product is called **CapitalLens** (repo `cilangovan/CapitalLens`, worker `capitallens-proxy`). Heading to a public multi-user SaaS: self-service signup, users connect Trading 212 first and Zerodha later by API key, plus a **dummy demo user** with mock data. For now one real user (the owner) and the demo user are testing.
- Strategy: base case ~10% annual growth, optimistic 15%. **Aggressive mode**: the monthly maximum budget is pumped in weekly across pies based on performance, market fear and news. Weightings calibrated to a recurring £30 contribution on the Trading 212 pies (Defence, Atomic Resources, Cloud Empire, speculative tech, emerging markets).
- Wants dip alerts, when to sell / buy more, rebalancing advice, email + phone notifications (see deferral above), and a dashboard that supports buy/sell decisions. Walk the owner step by step through connecting Trading 212.
- Product backlog = **GitHub Issues** on `cilangovan/CapitalLens` (no Jira). Log backlog items there.

- **Internal operations dashboard** (epic #23, page `docs/ops/`): for platform staff only, built in-house (no third-party monitoring, no service-role key outside our systems). Access is enforced in Postgres: listed in `platform_admins` AND signed in with a second factor (`aal2`). Aggregate/operational data only (no portfolio data, ciphertext, keys or emails), nothing stored in the browser, never linked from customer pages, exempt from the "every dashboard" roll-out. Documented in `documentation/ops-dashboard.md`; guarded by `tests/zk_ops_test.mjs` and `tests/ops_layout_test.py`.

## Adding a new standing rule
When the owner says "always / from now on / every dashboard…", append it to the right section above in the same commit, and add a check to `tests/standards_test.py` if a machine can verify it.

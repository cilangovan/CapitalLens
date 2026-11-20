# Product requirements: CapitalLens

## 1. Summary
CapitalLens turns a Trading 212 account into a decision dashboard: where the money is, how it performs, what the data says about each holding, and when to buy, hold, trim or review. It is built phone-first, keeps customer holdings private by encrypting them in the browser, and shows its working. It is heading from one owner to a public multi-user service.

## 2. Contacts
Owner and product lead: HOOP (GitHub `cilangovan`). One real user today (the owner) plus the demo user.

## 3. Background
The owner invests through Trading 212 pies and wanted one place for allocation, performance, alerts and a weekly plan, read mainly on a phone. Existing tools either hide how they reach their numbers or need the data handed to a third party. Now that the dashboards work, the goal is to open it to other self-directed investors without ever holding their plaintext portfolios.

## 4. Objective and key results
Help a self-directed investor decide each week what to buy, hold, trim or review, with figures they can trust.

| ID | Key result | Measured by |
|---|---|---|
| PRD-KR1 | Every figure shown matches the broker's own definition or is labelled as an estimate | Overview "How the numbers add up"; `tests/zk_overview_stale_test.mjs` |
| PRD-KR2 | Every dashboard fits a 360px and 390px phone with no sideways scroll | `tests/ui_layout_test.py`, `ipo_layout_test.py`, `docs_layout_test.py`, `demo_layout_test.py` |
| PRD-KR3 | The server holds no plaintext customer holdings | RLS isolation test; zero-knowledge store tests (`tests/zk_crypto_test.mjs`) |
| PRD-KR4 | No data is lost: history archived never deleted, daily encrypted off-site backup | Database Maintenance and Database Backup workflows |
| PRD-KR5 | A prospect can try the product in one tap with no sign-up | Demo user epic #32 |
| PRD-KR6 | Self-service sign-up, Trading 212 connect and a first useful dashboard without help | ⬜ not yet measured (no onboarding metric exists) |

## 5. Market segments
Defined by the job, not by demographics.
1. **Pie investor (core, today).** Holds Trading 212 pies, checks the phone each morning, wants weekly allocation and dip or profit-taking prompts.
2. **Privacy-minded self-directed investor (next).** Will connect a broker only if the service cannot read the portfolio.
3. **Prospect evaluating the product (pre-sales).** Wants to see a complete, believable dashboard in a minute without giving anything.
Out of scope for now: advisers, institutions, brokers other than Trading 212 (Zerodha is planned), trading or order placement.

## 6. Value propositions
**Pie investor.** *Who:* a self-directed investor with Trading 212 pies. *Why:* decide each week where the money goes and when to trim. *What before:* flipping between the broker app, spreadsheets and news, with figures that disagree. *How:* one phone-first dashboard using the broker's own definitions, alerts that explain themselves, a weekly allocation plan. *What after:* a morning routine of one refresh and a clear list of what to review. *Alternatives:* the broker app alone, spreadsheets, portfolio trackers that need the data uploaded to them. *Statement:* see your whole account the way your broker defines it, and know what to review this week, without handing your portfolio to anyone.

**Privacy-minded investor.** *Why:* use analytics without exposing holdings. *What before:* choose between privacy and insight. *How:* data encrypted in the browser with a key only the user holds; the server stores ciphertext. *What after:* full analysis, and nobody at the service can read it. *Alternatives:* local spreadsheets, trackers that read the portfolio. *Trade-off to state honestly:* losing both password and recovery key means the data cannot be recovered by anyone.

**Prospect.** *Why:* judge the product fast. *How:* "Try the demo" gives a one-hour temporary login on synthetic data. *Alternatives:* screenshots, a sales call.

## 7. Solution
- 7.1 UX: eleven areas behind one shell (sign-in, header, menu bar, cards, footer). See [UI requirements](ui-requirements.md) and the wireframes there.
- 7.2 Key features: Overview, P&L Bubbles, Positions, Analyst, Strategy, Profit Booking, Returns, Watchlist and IPO Watch, Alerts, Settings and account, Demo, internal Ops dashboard.
- 7.3 Technology: static pages on GitHub Pages; Supabase (Postgres, Auth, Edge Functions); Cloudflare Worker and stateless relay; GitHub Actions for schedules and tests; Cloudflare R2 for encrypted backups. See [Architecture and security](../architecture-and-security.md).
- 7.4 Assumptions and open questions:
  - Assumed: the investor opens the app each morning and presses Refresh. Nothing runs while the app is closed (a stated limit, not a goal).
  - Assumed: Trading 212 keeps its read-only API and the 6-requests-a-minute limit.
  - Open: pricing and plans; email alerts (needs a sending domain; the owner's personal domain is excluded); Zerodha support; a rating source for the IPO calendar (all rows "Not rated" today); legal position of screening aids for a public service (they are labelled not-advice; not reviewed by a lawyer).
  - Open: an accessibility standard (none set, see [UI requirements](ui-requirements.md)).

## 8. Release
- **Now:** one real user and the demo user; private app on production, legacy dashboards kept until results match.
- **Next:** self-service sign-up, Trading 212 connect by read-only key, demo with temporary logins (built), ops dashboard phase 1 (built).
- **Later:** Zerodha, email alerts, public/admin documentation split (#10), ops metrics needing a read-only provider token (#16–#21).
- **Explicitly not doing:** placing trades, holding customer funds, giving personalised advice, running while the app is closed, third-party analytics or monitoring in the pages.

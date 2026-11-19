# CapitalLens documentation

CapitalLens is a portfolio dashboard for Trading 212 investors: positions, pies, analyst views, strategy and profit-booking guidance, returns, a watchlist with IPO Watch, and an alert inbox. This is the complete product documentation. It lives in git next to the code (`documentation/`), is published as this portal (`/help/`) and is linked from the footer of every dashboard.

## Where to look

| I want to know… | Read |
|---|---|
| What the product is, who it is for, the plans | [Product overview](product-overview.md) |
| What each menu does, what each card shows, which data it uses | [Menus](menus/app-shell.md) — one page per menu |
| Colours, type, components, mobile rules, how cards collapse | [UI & style guide](ui-design-system.md) |
| What is in the database, who writes each table, how data flows | [Database & data flows](database.md) · [Table reference](reference/database-tables.md) |
| What runs when, and on what schedule | [Workflows & schedules](workflows.md) · [Workflow reference](reference/workflows.md) |
| Keys, encryption, what the server can and cannot see | [Architecture & security](architecture-and-security.md) |
| How to add a feature or fix a bug the project's way | [Engineering guide](engineering-guide.md) |

## The menus

| Menu | Purpose in one line |
|---|---|
| [📊 Overview](menus/overview.md) | Account totals, gain by position, split by pie, sector and country maps, active alerts |
| [🫧 P&L Bubbles](menus/pnl-bubbles.md) | Every holding as a bubble sized and coloured by profit or loss over 1D / 1W / 1M |
| [📋 Positions](menus/positions.md) | Holdings grouped by pie, plus an **Untagged** group; tap any pie for its value chart |
| [🔬 Analyst](menus/analyst.md) | Analyst ratings per holding and Peter Lynch buckets |
| [🎯 Strategy](menus/strategy.md) | Institutional money flow, holding decisions, entry analysis, weekly allocation |
| [💰 Profit Booking](menus/profit-booking.md) | Staged profit-booking and capital-protection guidance with a rulebook |
| [📈 Returns](menus/returns.md) | Real returns from your Trading 212 cash flows: money in, profit, charts |
| [⭐ Watchlist & IPO Watch](menus/watchlist.md) | Stocks, commodities and crypto you track, plus IPOs across all markets |
| [🔔 Alerts](menus/alerts.md) | Review reports that behave like an inbox: read, archive, clear, restore |

## How this documentation is kept true

- It is **in git** and changes in the same commit as the feature (standing rule in `CLAUDE.md`).
- The **table, workflow and menu references are generated from the code**, so they cannot drift.
- `tests/standards_test.py` fails the build if a menu has no page, a page is missing from the portal, the generated pages are stale, or a dashboard lacks the footer link.
- Every dashboard footer links here: **📘 Documentation**.

> Honest-data rule: where a number cannot be verified the app says so. These pages name the source of every figure and call out what is estimated.

# Product overview

## What it is

CapitalLens turns a Trading 212 account into a decision dashboard: where the money is, how it is performing, what the data says about each holding, and when to buy, hold, trim or review. It is built phone-first and shows its working: every figure names its source, and anything that cannot be verified is labelled rather than guessed.

## Who it is for

Self-directed Trading 212 investors who use **pies** and want one place for allocation, performance, alerts and a weekly plan. The product is heading to a public multi-user service: self-service sign-up, Trading 212 connected first (Zerodha later) by read-only API key, and a **demo user** with mock data. Today one real user (the owner) and the demo user are testing.

## The dashboards (variants)

All variants share the same dashboard code; they differ only in how they sign in and where data comes from.

| Variant | Path | Data and sign-in | Use |
|---|---|---|---|
| Private (zero-knowledge) | `/zkapp-prod/` | Production project; data encrypted in the browser with a key only the user holds | The real product |
| Private (test) | `/zkapp/` | Demo project, same encrypted shell | Testing the private shell |
| Multi-user | `/app/` | Production project, ordinary sign-in | Earlier multi-user build |
| Demo | `/demo/` | Demo project, synthetic data | Showing the product |
| Legacy | `/` | Cloudflare worker proxy, single owner | Original dashboard, kept until results match |

Account creation, recovery and upgrade live on the account page (`/zk-prod/`). See [App shell](menus/app-shell.md).

## Investing approach it supports

- Base-case growth about **10% a year**, optimistic **15%**.
- **Aggressive mode:** the monthly maximum budget is paid in weekly across pies, weighted by performance, market fear and news. Weightings are calibrated to a recurring **£30** contribution on the Trading 212 pies (Defence, Atomic Resources, Cloud Empire, speculative tech, emerging markets).
- Dip alerts, when to sell or buy more, rebalancing advice, and phone notifications.

These are screening aids and rule-based estimates, **not financial advice**.

## Principles

1. **Zero knowledge:** the server never sees plaintext holdings; per-user data is encrypted in the browser. Only public data (instruments, market cache, IPO calendar) is shared. See [Architecture & security](architecture-and-security.md).
2. **Honest data:** no fake "all clear"; ratings and prices carry their source; missing data is said to be missing.
3. **Mobile first:** every section fits 360px and 390px with no sideways scroll; tap targets are at least 40px.
4. **Everything collapses,** and the open/closed state is remembered per user.
5. **One rollout:** a feature reaches every dashboard variant, built from the same sources.
6. **Nothing runs while the app is closed:** the owner opens the app each morning and presses Refresh; sync, alerts and phone push happen then.

## Notifications

In-app alerts and phone push through ntfy. Email alerts for multiple users are deferred until a sending domain exists.

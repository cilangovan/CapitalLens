# Demo user for pre-sales: requirements and wireframes

Epic: [#32](https://github.com/cilangovan/CapitalLens/issues/32) · Status: **built, see the traceability table at the end for what is verified** · Owner (product owner): HOOP · How it works day to day: [Demo user (pre-sales)](demo.md)

> Method: lean PRD (summary, objective, segments, value proposition, solution, release), user stories in the 3 C's / INVEST form with testable acceptance criteria, test scenarios, a stakeholder map and a pre-mortem. These come from the open-source *pm-skills* pack by Paweł Huryn (MIT licence). Plain language on purpose.

## 1. Summary

A prospect who wants to see CapitalLens should be able to press **Try the demo** and, within seconds, be inside a complete, believable dashboard filled with invented holdings. They get a **temporary login generated on screen**. It works for **one hour**, stops after **45 minutes without activity**, and stops when they close the tab. Nobody but the owner can ever reset or change the demo account's own email and password.

## 2. Stakeholders

| Stakeholder | Role | Power | Interest | Strategy | What they need |
|---|---|---|---|---|---|
| HOOP (owner) | Product owner, platform admin | High | High | Manage closely | Safe demo, no manual steps, only he can reset the master demo account |
| Prospect | Investor evaluating CapitalLens | Low | High | Keep informed | Instant access, no sign-up, a dashboard that looks real and works on a phone |
| Pre-sales helper (future) | Hands the demo link to prospects | Low | High | Keep informed | A link and a one-page guide, nothing to reset |
| Real customers | Use the live app | Low | Low | Monitor | Their data never mixes with the demo |
| Cloud providers (Supabase, GitHub) | Host the demo | High | Low | Keep satisfied | Stay inside free/paid limits (rate limits and clean-up protect this) |

## 3. Background

CapitalLens is heading to a public, multi-user product. The owner needs something to show people before they trust it with a Trading 212 key. The demo project already has two seeded demo users and a `/demo/` page, but the logins are shared and permanent, the data stops moving (the newest snapshot was three days old), and several menus are empty. A shared permanent password is a leak waiting to happen; a stale or empty demo loses the sale.

## 4. Objective and key results

Make the demo **safe to share publicly** and **good enough to sell the product**.

- KR1: a prospect gets from the sign-in page to a populated Overview in **under 15 seconds** with no typing.
- KR2: **100%** of temporary logins stop working within one minute of the time limit, the idle limit, or tab close (tested).
- KR3: **0** demo credentials in the repository (checked by an automated test).
- KR4: every menu of the live dashboard shows data in the demo (tracked in the parity table in section 12; today some are still empty).

## 5. Market segments

1. **Prospect investors** (main): self-directed Trading 212 users with pies, mostly on a phone, who want to see the product before connecting a real account.
2. **The owner** (support): needs to run the demo without babysitting it.

Constraints: mobile first (360 and 390 px), strict browser security policy (no inline scripts in new code paths, only the Supabase origin allowed for network calls), no real portfolio data anywhere in the demo.

## 6. Value proposition

- **Who:** a Trading 212 investor who is curious about CapitalLens.
- **Why:** they want to judge the product before trusting it with an API key.
- **What before:** they read a landing page or watch a video; there is nothing to try, or they are handed a shared password.
- **How:** one button creates a private, one-hour copy of a full demo portfolio; they explore every menu.
- **What after:** they have seen the real product with believable numbers and can decide quickly.
- **Alternatives:** screenshots, a recorded video, a shared demo password. We win because it is hands-on, private to them, and safe for us.

*Statement:* Try the real CapitalLens dashboard for an hour, with invented money, without signing up.

## 7. Scope

**In (version 1):** Try-the-demo button; server-generated temporary login shown on screen; 60-minute hard limit; 45-minute idle limit; end on tab close; countdown and warning in the dashboard; clean-up of expired accounts; owner-only lock and reset of the master demo account; rate limits, capacity cap and a kill-switch; daily refresh of the master demo data; a parity report that lists empty menus; this documentation.

**Out / not now:** bot challenge (Cloudflare Turnstile needs a site key from the owner; the rate limits cover version 1); real market prices in the demo data (the data is synthetic and rolls forward daily); any email sending (no domain yet); letting visitors save work between sessions.

## 8. Business rules

| ID | Rule |
|---|---|
| BR-1 | A visitor login is valid for **60 minutes** from creation. It cannot be extended. |
| BR-2 | It also ends after **45 minutes without activity**. |
| BR-3 | It also ends when the visitor **closes the tab** (a 90-second grace lets a page refresh survive). |
| BR-4 | The password is generated by the server, shown **once** on screen, stored only as a hash, and never written to the repo, docs or logs. |
| BR-5 | The **master demo account** is never handed out. Only the owner can change or reset its email or password, and the database enforces it. |
| BR-6 | Visitor accounts cannot change their email or password or use "forgot password". |
| BR-7 | Every visitor gets an **isolated copy** of the demo data. No visitor can read another's data or any real customer's data. |
| BR-8 | Demo data is **invented** (never the owner's holdings) and is **refreshed daily** so dates are current. |
| BR-9 | At most **25 demo sessions at once** and **5 new logins per network address per hour**. The owner has a **kill-switch**. |
| BR-10 | Expiry is enforced **in Postgres**, so editing the page cannot extend a session. |
| BR-11 | Expired accounts and their copied data are **deleted** automatically (within about a minute). A small usage record (no personal data) is kept for statistics. |
| BR-12 | The demo is clearly labelled: a "Demo data" banner and a countdown are always visible. |

## 9. User stories

### US-1 Get a demo login in one tap
As a **prospect**, I want to press one button and get a login, so that I can look around without signing up.
1. The sign-in page shows a **Try the demo** button above the normal sign-in form.
2. Pressing it shows a temporary email and password on screen, each with a **Copy** button, within 5 seconds.
3. The screen says the login lasts 60 minutes, ends after 45 minutes idle or when I close the tab, and is shown only once.
4. **Open the demo** signs me in and lands on the Overview.
5. If the demo is busy, switched off, or I tried too often, I see a friendly message and no login is created.
6. Works at 360 and 390 px wide with tap targets of at least 40 px.

### US-2 See how much time I have left
As a **prospect**, I want a countdown, so that I am not surprised when the demo ends.
1. A badge in the header shows the time left as `mm:ss`.
2. At 5 minutes left the badge turns amber and says so.
3. A **Show login** button shows my email and password again (this tab only).
4. A "Demo data, not real holdings" banner is always visible.

### US-3 It ends when the time is up
As the **owner**, I want expired logins to stop working, so that the demo can be public.
1. At 60 minutes the dashboard stops and shows "Demo session ended (time limit)" with a **Try the demo** button.
2. After 45 minutes without a click, key press or scroll, the same happens ("inactivity").
3. Closing the tab ends the session after a 90-second grace; reopening within the grace (a refresh) keeps it.
4. A copied token or password does not work after expiry: the database returns nothing.
5. Each of the three causes is recorded with its reason.

### US-4 Only the owner controls the master demo account
As the **owner**, I want the master demo account locked, so that nobody can take it over.
1. The master account's email and password cannot be changed through the app, the API or "forgot password".
2. The owner can reset it with one documented command that needs the project owner (SQL editor) or a platform admin who has passed the second factor.
3. The reset can generate a random password and shows it once.
4. Each reset is written to the audit log.

### US-5 Visitors cannot interfere with each other
As a **prospect**, I want my own private copy, so that nobody sees or changes what I do.
1. Each login has its own copy of the master demo data.
2. A visitor cannot read another visitor's rows or any real customer's rows.
3. A visitor cannot change their own email or password.
4. Changes a visitor makes disappear with the session.

### US-6 Keep the demo clean and cheap
As the **owner**, I want old demo accounts deleted, so that the database does not grow.
1. A job runs every minute and ends sessions that are past a limit.
2. Ended accounts and their copied rows are deleted.
3. A usage record (time, reason, no personal data) stays for statistics.
4. The job's result is visible to the owner.

### US-7 Protect against abuse
As the **owner**, I want limits, so that a public button is not a cost or security problem.
1. No more than 25 sessions are active at once; the next visitor sees "demo is busy".
2. No more than 5 new logins per network address per hour.
3. The owner can switch temporary logins off with one setting.
4. The network address is stored only as a salted hash.

### US-8 The demo always looks current
As a **prospect**, I want recent dates and moving numbers, so that it feels real.
1. Every day the master demo data is regenerated up to today.
2. New visitor copies are taken from the refreshed master.
3. A report lists every menu and whether the demo has data for it.
4. A menu with no demo data is flagged, not hidden.

## 10. Non-functional requirements

- **Security:** expiry and isolation enforced by Postgres row-level security; service-role key only inside Supabase; no secrets in the repo (test); the master lock is a database trigger.
- **Performance:** login generation under 5 s (about 4,000 rows are copied); heartbeat at most once a minute.
- **Mobile:** fits 360 and 390 px with no sideways scroll; tap targets at least 40 px.
- **Accessibility:** buttons have text labels; the countdown updates the visible text only once per second and is not announced continuously.
- **Honesty:** the page says it is invented data; the parity report names what is still empty.

## 11. Wireframes

### W1 Sign-in page (phone)

```
┌────────────────────────────────────┐
│  🌐 CapitalLens Demo               │
│  Demo portfolio — synthetic data   │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ ▶  Try the demo              │  │
│  │    (free 1-hour login)       │  │
│  └──────────────────────────────┘  │
│                                    │
│  ───── or sign in ─────            │
│  [ Email                       ]   │
│  [ Password                 👁 ]   │
│  [ 🔐 Sign In                  ]   │
│                                    │
│          📘 Documentation          │
└────────────────────────────────────┘
```

### W2 Temporary login shown on screen

```
┌────────────────────────────────────┐
│  🌐 CapitalLens Demo               │
│  Your temporary login              │
│                                    │
│  Email                             │
│  demo-k7qm2wzp@demo.…invalid [Copy]│
│  Password                          │
│  K7QM-2WZP-X9RA-4HTE         [Copy]│
│                                    │
│  ⏱ Valid for 60 minutes.           │
│  Ends sooner after 45 min idle or  │
│  when you close this tab.          │
│  Shown once — copy it if you need  │
│  to sign in again.                 │
│                                    │
│  [ Open the demo  →            ]   │
└────────────────────────────────────┘
```

### W3 Inside the dashboard

```
┌────────────────────────────────────┐
│ CapitalLens   ⏱ 58:12   [Sign out] │
├────────────────────────────────────┤
│ ℹ Demo data — invented holdings,   │
│   not real money.   [Show login]   │
├────────────────────────────────────┤
│  📊 Overview  📋 Positions  …      │
│  ...                               │
└────────────────────────────────────┘
```

### W4 Five minutes left

```
│ CapitalLens   ⏱ 04:59 (amber) [x]  │
│ ⚠ 5 minutes left. The demo ends at │
│   the time limit.                  │
```

### W5 Session ended

```
┌────────────────────────────────────┐
│  🌐 CapitalLens Demo               │
│  Demo session ended (time limit)   │
│                                    │
│  [ ▶ Try the demo again        ]   │
└────────────────────────────────────┘
```
Other reasons: "inactivity" and "you closed the demo".

### W6 Refusals

```
  The demo is busy right now. Please try again in a few minutes.          (capacity)
  Too many demo logins from your network. Try again later.                (rate limit)
  The demo is switched off at the moment.                                 (kill-switch)
  Could not reach the demo. Check your connection and try again.          (network)
```

## 12. Data requirements and parity

The demo is the same dashboard code reading the same tables as the live app. Per-visitor copies are cloned from the **master demo account** (`demo@capitallens.test`).

Tables copied for each visitor: `broker_connections`, `portfolio_snapshots`, `positions`, `alerts`, `dividends`, `t212_orders`, `t212_dividends`, `t212_transactions`, `t212_sync_state`, `holding_decisions`, `profit_booking`, `profit_booking_summary`, `realised_pnl`, `returns_summary`, `strategy_recommendations`, `value_buy_scores`, `watchlist`, `watchlist_analysis`, `pie_history`.

Parity is measured by the database function `demo_parity()` (run by the daily job). The table in [Demo user (pre-sales)](demo.md#parity-today) is regenerated from it by hand when the report changes; it is the source of truth for "what is still empty".

## 13. Test scenarios

| ID | Story | Scenario | Expected |
|---|---|---|---|
| TS-1 | US-1 | Press Try the demo as a new visitor | Email and password appear within 5 s; Open the demo lands on the Overview |
| TS-2 | US-1 | Press it 6 times from one address within an hour | The 6th shows the rate-limit message and creates nothing |
| TS-3 | US-1/US-7 | 25 sessions active, 26th visitor | "Demo is busy" and nothing created |
| TS-4 | US-7 | Kill-switch off | "Switched off" message |
| TS-5 | US-3 | Set the session's expiry to the past | Next request returns no rows; the page shows "time limit" |
| TS-6 | US-3 | Last activity 46 minutes ago | Session ended with reason idle |
| TS-7 | US-3 | Tab closed, grace passes | Session ended with reason closed; refresh within grace keeps it |
| TS-8 | US-4 | Try to change the master password with a normal update | Refused by the database |
| TS-9 | US-4 | Owner reset function as owner and as anyone else | Works only for the owner path and writes an audit row |
| TS-10 | US-5 | Visitor A selects visitor B's rows | Zero rows |
| TS-11 | US-6 | Run clean-up with an expired session | Account and copied rows are gone; the usage record stays |
| TS-12 | US-8 | Run parity report | Lists every menu with row counts and flags empty ones |

## 14. Pre-mortem (what could make this fail)

| Type | Risk | Urgency | Mitigation |
|---|---|---|---|
| Tiger | Bots or one person mint many logins and fill the database | Launch-blocking | Per-address limit, capacity cap, kill-switch, one-minute clean-up; bot challenge listed as a follow-up |
| Tiger | An empty menu in a sales demo (Strategy, Returns, Watchlist) | Launch-blocking for sales | Parity report names every empty menu; seeding tracked in #27/#28 |
| Tiger | Clean-up fails and expired data lingers | Fast-follow | Expiry is also enforced by row-level security, so lingering rows are unreadable |
| Elephant | The master-account lock could interfere with the authentication service's own updates | Investigate | Lock only blocks changes to email, password and recovery fields, and only for the master and visitor accounts |
| Paper tiger | "The demo can be copied" | Track | It is invented data by design |
| Paper tiger | Visitor passwords seen in the page | Track | Throw-away, one hour, isolated |

## 15. Release plan

1. Database layer, generate-login function, sign-in screen, clean-up and daily refresh (this release).
2. Seed the remaining empty menus so the parity report is all green (tracked in #27/#28/#29).
3. Bot challenge, a guided tour and demo usage on the ops dashboard (tracked in #31/#36).

## 16. Traceability

| Requirement | Issue | Where built | Check |
|---|---|---|---|
| US-1 | #33 | `supabase/functions/demo-access`, `docs/demo/demo-session.js`, `docs/demo/index.html` | `tests/zk_demo_session_test.mjs`, `tests/demo_layout_test.py` |
| US-2 | #33 #31 | `docs/demo/demo-session.js` | `tests/zk_demo_session_test.mjs` |
| US-3, BR-1..3, BR-10 | #34 | `db/tenant/17_demo_access.sql` | `tests/demo_access_test.sql` |
| US-4, BR-5, BR-6 | #25 #26 | `db/tenant/17_demo_access.sql` | `tests/demo_access_test.sql`, `tests/standards_test.py` |
| US-5, BR-7 | #30 | row-level security + restrictive policies | `tests/demo_access_test.sql` |
| US-6, BR-11 | #35 | `demo_cleanup()` + pg_cron | `tests/demo_access_test.sql` |
| US-7, BR-9 | #36 | `demo_can_issue()`, function, settings | `tests/demo_access_test.sql` |
| US-8, BR-8 | #27 #28 #29 | `demo_refresh()` + pg_cron, `demo_parity()` | `tests/demo_access_test.sql` |

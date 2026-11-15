# T212 Portfolio Monitor

Live portfolio dashboard for Trading 212 — positions, pies, alerts, analyst ratings, strategy recommendations, and returns analysis.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHub Actions (cron)                        │
│                                                                     │
│  monitor.yml          daily_services.yml       deploy_worker.yml   │
│  Every 15 min         Daily 06:30 UTC          On worker.js push   │
│  Mon–Fri 07–17 UTC                                                  │
│       │                      │                        │             │
│  monitor.py           daily_services.py        CF REST API deploy  │
│  - Fetch T212 API     - Analyst ratings                             │
│  - Store snapshots    - Strategy recs          send_reset_email.yml │
│  - Fire alerts        - Returns/XIRR           On repository_dispatch│
│       │                      │                        │             │
└───────┼──────────────────────┼────────────────────────┼─────────────┘
        │                      │                        │
        ▼                      ▼                        ▼
┌───────────────────┐  ┌───────────────────┐  ┌────────────────────┐
│     Supabase      │  │   ntfy / Gmail    │  │   Gmail SMTP       │
│   (Postgres DB)   │  │  Push + Email     │  │  Password reset    │
│                   │  │    Alerts         │  │  emails            │
│  Tables:          │  └───────────────────┘  └────────────────────┘
│  portfolio_snapshots                                               
│  positions                                                         
│  alerts                                                            
│  analyst_ratings                                                   
│  strategy_recommendations                                          
│  returns_summary                                                   
│  dashboard_auth ◄─── RLS (service key only)                        
└────────┬──────────┘
         │  REST API
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Cloudflare Worker  (t212-proxy)                        │
│                                                                     │
│  /auth/login            POST → verify password, issue session       │
│  /auth/change-password  POST → update password (session required)   │
│  /auth/reset-request    POST → store reset token, trigger GH email  │
│  /auth/reset-confirm    POST → consume reset token, set password    │
│  /auth/debug            GET  → env var presence check               │
│  /{table}               GET  → proxy to Supabase (anon key)         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │  HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│          Cloudflare Pages  (t212-monitor.pages.dev)                 │
│              docs/index.html — Single-page dashboard                │
│                                                                     │
│  Auth modes:                                                        │
│    Master  → full view, change password, 7-day session              │
│    Guest   → financial values masked (***), read-only               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## GitHub Secrets

Settings → Secrets and Variables → Actions → New repository secret

| Secret | Used by | Value |
|--------|---------|-------|
| `T212_API_KEY` | monitor.yml | Trading 212 API key |
| `GMAIL_USER` | monitor.yml, send_reset_email.yml | your@gmail.com |
| `GMAIL_APP_PASS` | monitor.yml, send_reset_email.yml | Gmail app password |
| `NTFY_TOPIC` | monitor.yml | e.g. `hoop-t212-x7k29` |
| `SUPABASE_URL` | all workflows | `https://<ref>.supabase.co` |
| `SUPABASE_KEY` | monitor.yml, deploy_worker.yml | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SERVICE_KEY` | deploy_worker.yml | Supabase secret key (`sb_secret_...`) |
| `CF_API_TOKEN` | deploy_worker.yml | Cloudflare API token (Workers Scripts: Edit) |
| `CF_ACCOUNT_ID` | deploy_worker.yml | Cloudflare account ID |
| `GH_DEPLOY_PAT` | deploy_worker.yml | GitHub PAT with `repo` scope (for reset email dispatch) |

---

## Cloudflare Worker — Environment Variables

Bound automatically by `deploy_worker.yml` via Cloudflare REST API:

| Variable | Type | Value |
|----------|------|-------|
| `SUPABASE_URL` | plain_text | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | secret_text | Supabase secret key (bypasses RLS on `dashboard_auth`) |
| `SUPABASE_KEY` | secret_text | Supabase publishable key (anon, for public table reads) |
| `SUPABASE_ANON_KEY` | secret_text | Same as `SUPABASE_KEY` (alias used in proxy section) |
| `GH_PAT` | secret_text | GitHub PAT for `repository_dispatch` (reset email) |
| `GH_REPO` | plain_text | `cilangovan/t212-monitor` |

> **Never set these manually** — the deploy workflow overwrites all bindings on every deploy.

---

## Dashboard Auth

Single-user, server-side auth via Cloudflare Worker + Supabase.

- **Username:** `admin`
- **Default password:** `***` (change via 🔑 Password button after first login)
- **Session:** 7-day token stored in `sessionStorage`
- **Password reset:** Forgot password → link sent to `****@****.com` (1-hour expiry)
- **Guest mode:** Friends can view without password — financial values (`Total Value`, `Invested`, `Cash`, `P&L`, amounts) show as `***`

Password is stored as SHA-256 hash in Supabase `dashboard_auth` table (RLS blocks all public access — service role key required).

---

## Alert Thresholds

| Alert | Threshold |
|-------|-----------|
| Dip alert | −8% from rolling high |
| Buy signal | −12% from rolling high |
| Trim / take profit | +40% from avg cost |
| Rebalance nudge | >5% drift from baseline |
| Growth lag | Annualised return < 7.5% |

Edit `monitor.py` lines 25–30 to adjust.

---

## Schedule

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `monitor.yml` | Every 15 min, Mon–Fri 07:00–17:00 UTC | Fetch T212, store snapshot, fire alerts |
| `daily_services.yml` | Daily 06:30 UTC | Analyst ratings, strategy recs, XIRR returns |
| `deploy_worker.yml` | On push to `cloudflare-worker/worker.js` | Redeploy Cloudflare Worker |
| `send_reset_email.yml` | `repository_dispatch: send_reset_email` | Send password reset email via Gmail |

---

## Files

```
monitor.py                              main fetch + alert script
daily_services.py                       analyst ratings + strategy + returns
cloudflare-worker/worker.js             Cloudflare Worker (auth + Supabase proxy)
docs/index.html                         dashboard SPA (served by Cloudflare Pages)
.github/workflows/monitor.yml           main cron workflow
.github/workflows/daily_services.yml    daily enrichment workflow
.github/workflows/deploy_worker.yml     worker deploy via CF REST API
.github/workflows/send_reset_email.yml  password reset email via Gmail SMTP
supabase_schema.sql                     full DB schema
```

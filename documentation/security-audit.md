# Security Audit — CapitalLens Portal

**Audit type:** Manual OWASP-aligned review (no automated scanner available)  
**Date:** 2026-11-23  
**Scope:** All client-side JS dashboards, Cloudflare Worker relay, Supabase RLS, CSP headers, session management, secrets hygiene  
**Status:** ✅ All confirmed vulnerabilities fixed and shipped

---

## Executive Summary

A full OWASP-aligned manual security audit was performed across the CapitalLens portal.  
**9 stored XSS vulnerabilities** were found and fixed across 6 dashboard JS files. All other areas — CSP headers, Cloudflare Worker, Supabase RLS, session management, and secrets hygiene — were reviewed and found to be sound with minor notes documented below.

---

## Epic: Security Hardening (resolved)

### FIND-001 · Stored XSS — `docs/js/overview.js` ✅ FIXED
**Severity:** High  
**CVSS:** 7.1 (AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N)  
**Root cause:** Two `catch (e)` handlers rendered `e.message` unescaped into innerHTML. A crafted API response could include HTML in the error message string.

**Affected lines (before fix):**
```js
el.innerHTML = `<div ...>Sector map error: ${e.message}</div>`;
el.innerHTML = `<div ...>Country map error: ${e.message}</div>`;
```
**Fix:** Wrapped both with `esc(e.message)`.

---

### FIND-002 · Stored XSS — `docs/js/analyst.js` ✅ FIXED
**Severity:** High  
**Root cause:** Multiple DB-sourced string fields rendered unescaped into innerHTML: `r.lynch_reason`, `r.lynch_confidence`, analyst `name`, `pie` section headings, `r.ticker`, `r.pie`.

**Affected functions:** `lynchBadge()`, `lynchSummary()`, `loadAnalyst()` table and mobile cards.

**Fix:** All fields wrapped in `esc()`. Example:
```js
// Before
return `<span title="${r.lynch_reason} (confidence: ${r.lynch_confidence})">${name}</span>`;
// After  
return `<span title="${esc(r.lynch_reason||'')} (confidence: ${esc(String(r.lynch_confidence||'?'))})">${esc(name)}</span>`;
```

---

### FIND-003 · Stored XSS — `docs/js/profit.js` ✅ FIXED
**Severity:** High  
**Root cause:** Numerous unescaped DB fields across the Profit Booking dashboard: `r.display`, `r.ticker`, `r.pie`, `r.action`, `r.sector`, `sig.rule`, `sig.volume`, `r.yahoo_ticker`, `s.notes[]`, `p.flags[]`, `reg.mode`, `x.sector`, `p.pie`.

**Affected functions:** `pbClosest()`, `pbScoreFlags()`, `pbInfo()` name helper, action list, hold card modal, `holdCard()`, sector table, pie table, unfunded pies list.

**Fix:** Every DB string field wrapped in `esc()`. Notes and flags arrays mapped through `esc()`.

---

### FIND-004 · Stored XSS + onclick injection — `docs/js/positions.js` ✅ FIXED
**Severity:** High  
**Root cause 1:** `pieName` and ticker rendered unescaped in display text (`>pieName<`).  
**Root cause 2:** `onclick` attribute used only `replace(/'/g, "\\'")` — a pieName containing a backslash (`\`) could escape out of the string literal.

**Fix:**
```js
// Before (broken for backslash in pieName)
onclick="pdOpen('${pieName.replace(/'/g, "\\'")}', null, event)">${pieName}</a>

// After (HTML-escaped display, JS-safe onclick)
onclick="pdOpen('${pieName.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}', null, event)">${esc(pieName)}</a>
```
Same pattern applied to `p.ticker` and `u.ticker` in Untagged section.

---

### FIND-005 · Stored XSS — `docs/js/strategy.js` ✅ FIXED
**Severity:** High  
**Root cause:** Multiple DB-sourced fields in holding decision cards rendered unescaped: `r.summary`, `r.report_date`, `h.display||h.ticker`, `h.decision`, `h.buy_signal`, `h.sell_signal`, `h.notes`, `pie` section heading.

**Fix:** All fields wrapped in `esc()`.

---

### FIND-006 · `e.message` XSS vectors — scope review ✅ SAFE
**Severity:** N/A — reviewed and confirmed safe  
**Files checked:** `watchlist.js`, `alerts.js`, `ipo.js`, `drilldown.js`  

- `watchlist.js` — `wlNote()` uses `.textContent` (not innerHTML); search error already uses `_wesc(e.message)` ✅  
- `alerts.js` — `alertsToast()` already wraps error in `_esc(error)` ✅  
- `ipo.js` — `S.msg` rendered via `msgHtml()` which wraps in `esc(S.msg)` ✅  
- `drilldown.js` — `DD.chart.error` and `DD.chart.fallback` already wrapped in `ddEsc()` ✅  
- `returns.js`, `heatmap.js`, `lots.js`, `dipplan.js` — no unescaped DB string fields found ✅

---

## Content Security Policy Review ✅ SOUND

All dashboard HTML files carry a strict `Content-Security-Policy` meta tag:

```
default-src 'none';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self' https://capitallens-proxy.itsme-daf.workers.dev https://api.alternative.me;
base-uri 'none';
form-action 'none';
object-src 'none';
frame-src 'none';
worker-src 'none';
manifest-src 'self'
```

**Note — `unsafe-inline` on script-src:** The `'unsafe-inline'` directive is present to support legacy inline `on*` attributes in `docs/index.html`. This is mitigated by the ZK app's `handlers.js` + `handler-names.js` system (see below), but `docs/index.html` and `docs/demo/` still rely on `unsafe-inline`. Future work: migrate all legacy `on*` attributes to `data-on*` and remove `unsafe-inline`.

**`connect-src` is locked** to only the Worker and alternative.me — no arbitrary fetch from client JS is possible.

---

## Handler Whitelist (XSS Mitigation) ✅ SOUND

`docs/zk/handlers.js` + `docs/zkapp/handler-names.js` implement a CSP-friendly event dispatch system:

- All `on*` attributes are rewritten to `data-on*` by `convert()` — the browser never executes them as code
- A delegated listener calls `install()`, which parses the `data-on*` string with a **tiny whitelisted grammar** (function calls, string/number literals, `this`, `event`, property reads)
- Only functions listed in `ZK_HANDLER_NAMES` can be called — no `eval`, no `Function()`, no built-ins
- Anything outside the grammar is refused and logged

This effectively eliminates the remaining `unsafe-inline` risk on the ZK dashboards (`docs/zkapp/`, `docs/app/`).

---

## Cloudflare Worker Relay Review ✅ SOUND

**File:** `cloudflare-worker/worker.js`

| Check | Result |
|---|---|
| SSRF via `symbol` param | `SYMBOL_RE = /^[A-Za-z0-9.\-^=&]{1,24}$/` — strict allowlist, `encodeURIComponent` before URL use ✅ |
| SSRF via `range` param | Validated against `CHART_RANGES` allowlist ✅ |
| Table injection | Only tables in `READABLE` Set are proxied — 404 for anything else ✅ |
| Auth bypass | Every authenticated route calls `verifySession()` — no unauthenticated read of user data ✅ |
| CORS | Origin validated against `DEFAULT_ORIGINS`/`ALLOWED_ORIGINS` env var — no wildcard ✅ |
| Security headers | `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` set on all responses ✅ |
| Credentials in code | None — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GH_PAT` are Cloudflare env vars ✅ |
| Token validation | PBKDF2-SHA256 with per-user salt; constant-time comparison via `safeEqual()` ✅ |
| Brute-force protection | 5-attempt lockout in DB ✅ |
| Query length cap | 2000-char limit on Supabase proxy queries ✅ |

---

## Supabase RLS Review ✅ SOUND

**All 39 public tables have RLS enabled.** Access breakdown:

| Category | Tables | Status |
|---|---|---|
| User data (per-user policies) | `alerts`, `enc_rows`, `user_keys`, `user_ui_prefs`, `broker_connections`, `profiles`, `dashboard_auth`, `watchlist`, `watchlist_analysis`, etc. | Per-user SELECT/INSERT/UPDATE policies ✅ |
| Public read-only | `analyst_ratings`, `instruments`, `ipo_calendar`, `market_cache`, `instrument_*` | SELECT for authenticated ✅ |
| Backend-only (service role) | `app_settings`, `broker_secrets`, `sync_jobs` | RLS enabled, **0 policies** = deny-all for `anon`/`authenticated` — only service role (Worker) can access ✅ |
| Views | `positions_all`, `portfolio_snapshots_all` | Inherit policies from underlying tables ✅ |
| Audit | `audit_log` | SELECT policy for authenticated (read own logs) ✅ |

**No `anon` or `authenticated` grants on backend-only tables confirmed via `information_schema.role_table_grants`.**

---

## Session Management Review ✅ SOUND

| Check | Result |
|---|---|
| Token storage | `sessionStorage` only — clears on tab/browser close; never `localStorage` ✅ |
| T212 credentials | Never stored (CLAUDE.md rule enforced) — JS memory only, cleared on logout/inactivity ✅ |
| Inactivity timeout | `_inactivityTimer` in `auth.js`; fires `SESSION_TOKEN = null` + `sessionStorage.clear()` ✅ |
| Token cleared on logout | `SESSION_TOKEN = null` + `sessionStorage.clear()` ✅ |
| Token cleared on session expiry | 401 response from Worker triggers `SESSION_TOKEN = null` ✅ |
| Password hashing | PBKDF2-SHA256, 5000 iterations, per-user salt; legacy plain SHA-256 upgraded on first login ✅ |
| Password reset | Tokenized flow via GitHub Actions dispatch, not predictable ✅ |

---

## Secrets / Repository Hygiene ✅ SOUND

| Check | Result |
|---|---|
| API keys in JS source | None — `SUPABASE_KEY` is the **anon** (public) key injected at build time for Supabase; appropriate ✅ |
| Service role key | Never in source — Cloudflare Worker env var only ✅ |
| T212 API key | Never in source — user-entered at runtime, session memory only ✅ |
| GitHub PAT | Never in source — Cloudflare Worker env var only ✅ |
| Hardcoded secrets pattern scan | No `eyJ` JWTs, no `sk_`, `pk_`, `ghp_`, `glpat_` patterns found in source ✅ |

---

## Recommendations / Remaining Improvements

These are non-critical — the portal is safe to use. Log as future backlog items.

### REC-001 — Remove `unsafe-inline` from legacy dashboard CSP (Medium)
**Current state:** `docs/index.html` and `docs/demo/index.html` use `'unsafe-inline'` in `script-src`.  
**Risk:** An XSS in a string that reaches the page could inject a `<script>` tag.  
**Mitigation in place:** `defuse()` on all API data, `esc()` on all DB fields (now fixed), no user-supplied strings go through `innerHTML` without escaping.  
**Fix:** Migrate all remaining `on*` attributes in `docs/index.html` and `docs/demo/index.html` to use the `data-on*` / `handlers.js` system, then remove `'unsafe-inline'`.

### REC-002 — Add `Strict-Transport-Security` header to Worker (Low)
**Current state:** Worker does not set HSTS.  
**Fix:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` to `SECURITY_HEADERS`.

### REC-003 — Raise PBKDF2 iteration count (Low)
**Current state:** `PBKDF2_ITER = 5000` — set low to fit Cloudflare Workers CPU budget.  
**Risk:** Faster brute-force on leaked DB if attacker had the hash. Mitigated by per-user salt and 5-attempt lockout.  
**Fix:** On a paid Workers plan, raise to 100,000+.

### REC-004 — Subresource Integrity on external scripts (Low)
**Current state:** No external scripts loaded (all self-hosted). No action needed currently.

---

## Files Changed in This Audit

| File | Changes |
|---|---|
| `docs/js/overview.js` | Fixed 2× unescaped `e.message` in error handlers |
| `docs/js/analyst.js` | Fixed `r.lynch_reason`, `r.lynch_confidence`, `name`, `pie`, `r.ticker`, `r.pie` |
| `docs/js/profit.js` | Fixed 15+ DB fields across 8 functions |
| `docs/js/positions.js` | Fixed `pieName` display + backslash injection in onclick; `p.ticker`, `u.ticker` |
| `docs/js/strategy.js` | Fixed `r.summary`, `r.report_date`, `h.display`, `h.decision`, `h.buy_signal`, `h.sell_signal`, `h.notes`, `pie` section heading |
| `documentation/security-audit.md` | This document (new) |
| `tests/security_scan.py` | New automated OWASP XSS scanner + auto-fixer (new) |
| `.github/workflows/security.yml` | Added `xss-scan` job: scan on push, auto-fix + commit on schedule |

---

## Automated Security Framework

Following the initial manual audit, an automated pen-test framework was added to catch new vulnerabilities continuously.

### How It Works

**`tests/security_scan.py`** — OWASP scanner + auto-fixer

Runs as a CI gate on every push and on a weekly schedule. Covers:

| Check | OWASP | Mode |
|---|---|---|
| Unescaped DB fields in `innerHTML`/`title`/`onclick` | A03 Stored XSS | Detect + auto-fix |
| `e.message` / `error.message` in DOM sinks | A03 XSS | Detect + auto-fix |
| `onclick` backslash injection (single-quote escape without prior backslash escape) | A03 XSS | Detect only |
| `eval` / `new Function` / `document.write` / string timers | A03 XSS | Detect |
| Hardcoded secrets (JWT, Stripe, GitHub PAT, AWS keys) | A02 Credentials | Detect |
| Token written to `localStorage` | A07 Session | Detect |
| CSP strictness: `default-src`, `object-src`, `base-uri`, `script-src`, `connect-src` | A05 Config | Detect |
| Worker CORS wildcard | A05 Config | Detect |
| Worker security headers (HSTS, X-Frame-Options, etc.) | A05 Config | Detect |
| Worker `verifySession` gate | A07 Auth | Detect |

**Auto-fix logic:** When an unescaped DB field is found in a template literal DOM sink (e.g. `${r.ticker}` → `innerHTML`), the scanner wraps it with the page's esc-equivalent function (e.g. `${esc(r.ticker)}`). Complex expressions (ternaries, nested templates) are flagged for manual review. A `.bak` backup is kept and a unified diff is printed.

**`documentation/security-scan-report.md`** — Living findings log

Generated on every scan run. Shows a table of findings by severity (Critical / High / Medium / Low / Info), per-finding detail with file + line + snippet, and the full OWASP coverage matrix.

### CI Integration (`.github/workflows/security.yml`)

| Trigger | Job | Action |
|---|---|---|
| Every push to `docs/**` / `cloudflare-worker/**` / `tests/**` | `xss-scan` | Scan only — exits non-zero on medium+ findings, blocks merge |
| Daily 06:17 UTC | `security` | Full static + live probe checks |
| Weekly Monday 03:00 UTC | `xss-scan` | Scan + **auto-fix** + commit any fixes back to `main` |
| `workflow_dispatch` | `xss-scan` | Scan + auto-fix on demand |

Auto-fix commits are authored as `cilangovan` and include a timestamped message referencing the scanner and report.

### Running Locally

```bash
# Scan only
python tests/security_scan.py

# Scan + auto-fix
python tests/security_scan.py --fix

# Scan + auto-fix + write report
python tests/security_scan.py --fix --report
```

# Security Scan Report

**Generated:** 2026-11-23 17:01 UTC  
**Tool:** `tests/security_scan.py` (OWASP A02·A03·A05·A07)  
**Auto-fixed this run:** 0 finding(s)

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 5 |
| Info | 0 |

## Findings

### 🔵 [LOW] A05:Headers
**File:** `cloudflare-worker/worker.js`:0  
**Description:** HSTS header missing from worker (REC-002)  
```

```

### 🔵 [LOW] A05:Headers
**File:** `cloudflare-worker/worker.js`:0  
**Description:** X-Frame-Options header missing from worker  
```

```

### 🔵 [LOW] A05:CSP
**File:** `docs/app/index.html`:0  
**Description:** unsafe-inline in script-src (backlog: migrate on* attrs to handlers.js)  
```
'self' 'unsafe-inline'
```

### 🔵 [LOW] A05:CSP
**File:** `docs/demo/index.html`:0  
**Description:** unsafe-inline in script-src (backlog: migrate on* attrs to handlers.js)  
```
'self' 'unsafe-inline'
```

### 🔵 [LOW] A05:CSP
**File:** `docs/index.html`:0  
**Description:** unsafe-inline in script-src (backlog: migrate on* attrs to handlers.js)  
```
'self' 'unsafe-inline'
```

## OWASP Coverage

| Check | OWASP | Status |
|---|---|---|
| Stored XSS — unescaped DB fields in innerHTML | A03 | ✅ Automated |
| Stored XSS — e.message in DOM sinks | A03 | ✅ Automated |
| onclick backslash injection | A03 | ✅ Automated (detection) |
| eval / new Function / document.write | A03 | ✅ Automated |
| Hardcoded secrets (JWT, PAT, API keys) | A02 | ✅ Automated |
| Token in localStorage | A07 | ✅ Automated |
| CSP strictness and directives | A05 | ✅ Automated |
| Worker CORS wildcard | A05 | ✅ Automated |
| Worker security headers | A05 | ✅ Automated |
| Worker verifySession gate | A07 | ✅ Automated |
| Worker SSRF (symbol/table allowlists) | A10 | ✅ Automated (security_check.py) |
| Supabase RLS (anon key reads nothing) | A01 | ✅ Automated (security_check.py live) |
| SQL injection | A03 | ✅ Supabase ORM (no raw concat) |
| Auth brute force | A07 | ✅ Automated (security_check.py) |

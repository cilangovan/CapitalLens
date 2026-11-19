#!/usr/bin/env python3
"""
Live smoke test — the real published dashboard in a real browser, as a visitor would use it.

  1. Opens https://cilangovan.github.io/CapitalLens/ (no stubs, real worker).
  2. Signs in with a username that doesn't exist → must show "Invalid credentials" (proves the browser can
     reach the worker: CSP, CORS pre-check, login call). Unknown users never count towards the lockout.
  3. With a fake session, data requests must be refused cleanly (401 → back to sign-in), never "Failed to fetch".
Prints every worker request, console error and CSP violation. Exit 1 on failure.
"""

import os
import sys

from playwright.sync_api import sync_playwright

SITE = os.environ.get("SITE_URL", "https://cilangovan.github.io/CapitalLens/")


def main():
    ok = True
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True)
        page = ctx.new_page()
        log = []
        page.on("console", lambda m: log.append(f"console.{m.type}: {m.text[:220]}") if m.type in ("error", "warning") else None)
        page.on("requestfailed", lambda r: log.append(f"FAILED {r.method} {r.url[:90]} — {r.failure}"))
        page.on("response", lambda r: log.append(f"{r.request.method} {r.url.split('?')[0][-60:]} → {r.status}") if "workers.dev" in r.url else None)
        page.goto(SITE, wait_until="networkidle", timeout=60_000)
        page.fill("#login-user", "no-such-user-ci") if page.query_selector("#login-user") else None
        user = page.query_selector("#login-user") or page.query_selector("input[type=text], input[autocomplete=username]")
        pw = page.query_selector("#login-pass") or page.query_selector("input[type=password]")
        if not (user and pw):
            print("login form not found"); ok = False
        else:
            user.fill("no-such-user-ci"); pw.fill("not-the-password")
            page.click("#login-btn")
            page.wait_for_timeout(5000)
            err = page.evaluate("() => [...document.querySelectorAll('[id$=error], .login-error, #login-err')].map(e => e.textContent.trim()).filter(Boolean)")
            print("sign-in message:", err)
            if not any("Invalid credentials" in e for e in err):
                ok = False; print("✗ sign-in did not reach the worker")
            else:
                print("✓ sign-in reaches the worker from the live site")
        # fake session → data calls must be refused cleanly
        page.evaluate("() => { sessionStorage.setItem('t212_auth','master'); sessionStorage.setItem('t212_token','fake-session-ci'); }")
        page.reload(wait_until="load")      # a fake session lands on a dashboard that keeps polling, so the network never goes idle
        page.wait_for_timeout(4000)
        sub = page.evaluate("() => (document.getElementById('login-subtitle')||{}).textContent || ''")
        print("after fake session:", sub.strip())
        fails = [l for l in log if l.startswith("FAILED") and "workers.dev" in l]
        if fails:
            ok = False
        print("\n".join(log[:60]))
        b.close()
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

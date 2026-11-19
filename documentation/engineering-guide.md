# Engineering guide

How work is done on CapitalLens. The binding rules are in `CLAUDE.md` at the repository root (read it before every change); this page is the practical companion.

## Repository map

| Path | Contents |
|---|---|
| `CLAUDE.md` | The owner's standing requirements, the single source of truth |
| `documentation/` | This documentation (markdown); `reference/` is generated |
| `docs/` | The published site: `index.html` (legacy), `demo/`, `js/` (dashboard modules), `zk/` (zero-knowledge engine), `vendor/`, generated `app/ zkapp/ zkapp-prod/ zk-prod/ help/` |
| `services/`, `monitor.py` | Python analysis and pipelines |
| `cloudflare-worker/` | `worker.js` (legacy proxy), `relay.js` (stateless relay) |
| `db/`, `supabase/` | SQL, migrations, schema export, backup scripts |
| `config/` | Curated data: `ipo_calendar.json`, `popular_tickers.json` |
| `scripts/` | Generators and jobs: `build_app.py`, `build_zkapp.py`, `build_docs.py` |
| `tests/` | Node (`zk_*_test.mjs`), Python, Playwright, standards |
| `.github/workflows/` | CI and schedules |

## The rules in practice

1. **Push straight to `main`.** No pull requests, no manual steps for the owner.
2. **No signatures** in commits, pull requests or logs: no AI or assistant names, no `Co-Authored-By` lines. Commits are authored as `cilangovan <7702527+cilangovan@users.noreply.github.com>`.
3. **Every bug fix ships with a regression test** that fails without the fix and runs in CI. The commit message names the test.
4. **Roll features out to every dashboard.** Edit sources (`docs/index.html`, `docs/demo/index.html`, `docs/js/*`, `docs/zk/*`), then rebuild. Never edit generated files.
5. **Be consistent:** reuse existing patterns (see the [UI & style guide](ui-design-system.md)).
6. **Be honest about data** and name sources.
7. **Update the documentation in the same commit** (menu page, database page, workflow page), then rebuild it.

## Before every push

```bash
python3 scripts/build_app.py && python3 scripts/build_zkapp.py     # regenerate pages
python3 scripts/build_docs.py                                       # regenerate documentation
for t in tests/zk_*_test.mjs; do node "$t"; done                    # node suites
python3 tests/standards_test.py                                     # CLAUDE.md rules + docs completeness
python3 tests/docs_layout_test.py                                   # documentation portal fits 360/390px
python3 tests/ipo_layout_test.py && python3 tests/login_flash_browser_test.py && python3 tests/ipo_watch_browser_test.py
git push origin main
```

`tests/ui_layout_test.py` needs the Supabase service key and runs in CI.

## Adding a menu or a card

1. Add the tab `<div id="…" class="tab">` and nav button to `docs/index.html` and `docs/demo/index.html`; add the loader to `docs/js/router.js`.
2. Write the module in `docs/js/`; put a `<script>` for it in **both** pages (the standards test checks parity).
3. Cards use `<h3>` so they collapse automatically; names and flags come from the database.
4. Data: add the table (see [Database & data flows](database.md)); worker `READABLE`; shim `ENCRYPTED` or `SHARED`.
5. Add layout coverage at 360/390px; add unit tests.
6. Write `documentation/menus/<name>.md`, add it to `NAV` in `scripts/build_docs.py`, run the builder.
7. Rebuild generated pages, run all suites, push.

## Adding a standing rule

When the owner says "always / from now on / every dashboard…": append it to the right section of `CLAUDE.md` in the same commit and add a check to `tests/standards_test.py` if a machine can verify it. If it affects UI or data, update the matching documentation page too.

## Testing notes

- Playwright under a strict CSP: use IIFEs / polling with `evaluate`; string `wait_for_function` is blocked.
- JSON columns must be parsed before `defuse` (regression: Entry Analysis blank cards).
- Browser sign-in must not flash the login box on refresh (regression: `login_flash_browser_test.py`).
- The offline development sandbox cannot reach most websites, so live data cannot be verified there; say so when reporting.

## Documentation system

- Source: `documentation/**/*.md` (readable on GitHub as is).
- `python3 scripts/build_docs.py` writes the generated references and renders the portal into `docs/help/`; `--check` fails if anything is stale.
- Every dashboard footer links to the portal. Dashboards link to `help/` relative to their own path.

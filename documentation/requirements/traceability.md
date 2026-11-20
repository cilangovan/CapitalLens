# Traceability, test scenarios and gap register

## A. Requirement → delivery → check

| Requirement area | Delivered by | Checked by |
|---|---|---|
| UI-G1 phone fit | all dashboard pages, `docs/css`, per-page styles | `tests/ui_layout_test.py`, `ipo_layout_test.py`, `docs_layout_test.py`, `demo_layout_test.py`, `ops_layout_test.py` |
| UI-G3, CH-1 standard spans | `docs/js/overview.js`, `drilldown.js`, `returns.js`, `pie_drill.js`, `index.html` buttons | `tests/standards_test.py` |
| UI-G5 every dashboard | `scripts/build_app.py`, `build_zkapp.py` | `tests/standards_test.py`, CI stale-file check |
| UI-G6 footer | page footers | `tests/standards_test.py`, `docs_layout_test.py` |
| UI-G7, UI-G8 loading and login flash | boot splash, `zkapp-auth.js` | `login_flash_browser_test.py`, `zk_login_flash_test.mjs` |
| UI-G10/11 definitions, stale warning, CH-3 | `docs/js/overview.js` | `zk_overview_stale_test.mjs` |
| UI-16 alerts | `docs/js/alerts.js`, `docs/zk/alertreport.js` | `zk_alertreport_test.mjs`, `zk_notify_test.mjs` |
| UI-10 analyst | `docs/zk/analystratings.js`, `lynch.js` | `zk_analystratings_test.mjs`, `zk_lynch_test.mjs`, `zk_lynch_parity_test.mjs` |
| UI-11 strategy | `docs/zk/strategy.js`, `flow.js`, `holdingdecision.js`, `valuebuy.js` | `zk_strategy_test.mjs`, `zk_flow_test.mjs`, `zk_holding_value_test.mjs` |
| UI-12 profit booking | `docs/zk/profitbooking.js` | `zk_profitbooking_test.mjs` (logic only) |
| UI-13 returns | `docs/js/returns.js` | `zk_returns_test.mjs`, `zk_t212sync_test.mjs` |
| UI-14 watchlist | `docs/js/watchlist.js`, `docs/zk/watchlist.js` | `zk_watchlist_test.mjs`, `zk_watchlistops_test.mjs`, `zk_watchlist_analyst_chip_test.mjs` |
| UI-15 IPO Watch | `docs/js/ipo.js`, `docs/zk/ipo*.js` | `zk_ipo_test.mjs`, `ipo_layout_test.py`, `ipo_watch_browser_test.py`, `ipo_service_test.py` |
| UI-9, CH-40 drill-down | `docs/js/pie_drill.js`, `docs/zk/piehistory.js` | `zk_piehistory_test.mjs` |
| UI-17 settings, refresh | `docs/zk/zk.js`, `t212sync.js`, `notify.js` | `zk_autorefresh_test.mjs`, `zk_notify_test.mjs`, `zk_zkapp_page_test.mjs` |
| DB-1…DB-3, DB-17 | `db/tenant/01…11` | `rls_isolation_test()` (63 checks passed 20 Nov), `security_check.py` |
| DB-3 zero knowledge | `docs/zk/store.js`, `crypto` | `zk_crypto_test.mjs`, `zk_flow_test.mjs`, `zk_migrate_test.py` |
| DB-11/12 lossless sync, duplicates | `services/t212_sync_service.py`, `docs/zk/dedupe.js` | `zk_t212sync_test.mjs`, `zk_dedupe_test.mjs` |
| DB-13 JSON parse | `docs/zk/shim.js` | `zk_shim_test.mjs` |
| DB-6/7/8/10 retention, backup, schema | `db_maintenance.yml`, `db_backup.yml`, `db/r2_backup.sh` | workflow runs (no restore test, see gap) |
| DB-18, SEC-16, LOG-10 demo | `17_demo_access.sql`, `18_demo_refresh.sql`, `supabase/functions/demo-access`, `docs/demo/demo-session.js` | `demo_access_test.sql`, `zk_demo_session_test.mjs`, `demo_layout_test.py` |
| SEC-4…SEC-9, SEC-20 browser and worker | `scripts/build_zkapp.py`, `docs/js/api.js`, `worker.js` | `security_check.py`, `zk_handlers_test.mjs`, `zk_zkapp_page_test.mjs`, `zk_prod_pages_test.mjs` |
| SEC-13, LOG-1…3 audit | `13_audit_log.sql` | migration constraints; events visible on the ops page |
| SEC-14, DB-19, DB-20, LOG-7 ops | `16_ops_dashboard.sql`, `docs/ops/` | `zk_ops_test.mjs`, `ops_layout_test.py` |
| Documentation (rule 9) | `scripts/build_docs.py` | `standards_test.py` (every page registered, nothing stale) |

## B. Test scenarios (consolidated)

Format: scenario, starting condition, steps → expected. IDs match the per-page lists.

| ID | Scenario | Steps → expected | Automated |
|---|---|---|---|
| TS-UI1 | Phone fit | Open each dashboard at 360 and 390px → no sideways scroll, buttons ≥40px | ✅ layout tests |
| TS-UI2 | Collapse is remembered | Collapse two cards, sign out, sign in → same two stay collapsed | ⬜ (#45) |
| TS-UI3 | No login flash | Refresh with a saved session → splash, then dashboard, box never visible | ✅ |
| TS-UI4 | Stale warning | Snapshot 13 h old → warning beside "updated" | ✅ |
| TS-UI5 | Untagged shares | Hold a share outside any pie → it appears under Untagged | ⬜ (#45) |
| TS-UI6 | Alert triage | Mark read, archive, clear, restore, bulk → counts and views update; cleared item removed after 30 days | ✅ logic; 🟡 UI |
| TS-UI7 | IPO bookmark | Search "Nasdaq", ☆ a result → it appears under My IPO list; ✕ removes it | ✅ |
| TS-UI8 | No fake clear | Holding with no price data → alert report says it cannot be checked | ✅ |
| TS-CH1…5 | Charts | See [Chart requirements](chart-requirements.md) | ✅ partly |
| TS-DB1…6 | Data | See [Data requirements](data-requirements.md) | ✅ except TS-DB6 |
| TS-SEC1…7 | Security | See [Security requirements](security-requirements.md) | ✅ except TS-SEC7 |
| TS-LOG1…6 | Logging | See [Logging requirements](logging-requirements.md) | ✅ TS-LOG1…4; ⬜ TS-LOG6 |
| TS-DEMO1…12 | Demo | See [Demo requirements](../demo-requirements.md) | ✅ |

## C. Gap register

All open gaps, tracked under epic #47.

| Gap | Requirements | Issue |
|---|---|---|
| Accessibility standard, colour-blind and contrast validation, chart table views | UI-G15, CH-5, CH-12, CH-13 | #38 |
| Backup restore never recorded as rehearsed | DB-9 | #39 |
| Customer export, erasure, data location and processors, breach duty | DB-15, DB-16, SEC-24, LOG-8 | #40 |
| Leaked-password protection off; no customer second factor | SEC-12, SEC-15 | #41 |
| No incident response procedure | SEC-23 | #42 |
| Logging: retention, redaction test, client errors, alerting, scheduled ops snapshot | LOG-8, 9, 11, 13, 16 (LOG-4, 5, 12 partly) | #43 |
| Security hygiene: advisor on production, secret scanning, dependency scan | SEC-10, SEC-22, SEC-25 | #44 |
| Rules held only by review (no automated test) | UI-G2, G4, G12, UI-7, UI-8, UI-12, CH-6, CH-8, CH-9 | #45 |
| Database performance review | DB-21 | #46 |
| Demo: bot protection; empty features; market relay | SEC-17, demo parity | #36, #27, #28, #29 |
| Public and admin documentation split | — | #10 |

## D. Counts (20 Nov 2026)

109 requirements and stories carry a status in this pack, counted by their first mark: **67 ✅** built and checked, **19 🟡** built without a named test, **9 ⚠** partly built, **14 ⬜** not built. The gap register above lists every ⚠ and ⬜ and every 🟡 that needs a test; nothing is left out to look better. Statuses reflect the repository and the demo project on 20 Nov 2026; the production project, Cloudflare and R2 settings were not inspected.

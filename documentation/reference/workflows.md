# Workflow reference

> **Generated** by `scripts/build_docs.py` from `.github/workflows/*.yml`. Do not edit by hand.
> What each pipeline is for, and the order data moves, is in [Workflows & schedules](../workflows.md).

17 workflows. Times are UTC. Per the standing rule, the owner's own morning Refresh is what runs analysis for the private app; these workflows cover shared/public data, the legacy dashboard, tests and maintenance.

| Workflow | File | Runs when | Schedule (UTC) |
|---|---|---|---|
| Cleanup old workflow runs | `cleanup_runs.yml` | manual, after another workflow | `23 4 * * 0` Sundays 04:23 UTC |
| Daily Portfolio Services | `daily_services.yml` | manual | `20 8 * * 1-5` 08:20 UTC Mon–Fri — after the 08:00 monitor snapshot lands |
| Database Backup | `db_backup.yml` | manual | `17 3 * * 0` Sundays 03:17 UTC — schema snapshot<br>`41 3 * * *` daily 03:41 UTC — encrypted data backup → R2 |
| Database Maintenance | `db_maintenance.yml` | manual | `23 2 * * *` 02:23 UTC daily |
| Deploy Cloudflare Relay | `deploy_relay.yml` | push, manual | — |
| Deploy Cloudflare Worker | `deploy_worker.yml` | push, manual | — |
| IPO Calendar | `ipo_calendar.yml` | push, manual | `15 6 * * 1-5` weekdays 06:15 UTC |
| CapitalLens | `monitor.yml` | manual | `0,15,30 8 * * 1-5` NASDAQ open window: every 15 min 14:30–15:00 UTC<br>`30,45 14 * * 1-5`<br>`0 15 * * 1-5` LSE close window: every 15 min 16:00–16:30 UTC<br>`0,15,30 16 * * 1-5` NASDAQ close window: every 15 min 20:30–21:00 UTC<br>`30,45 20 * * 1-5`<br>`0 21 * * 1-5` Regular hours: every 45 min across full market day 07:00–21:00 UTC<br>`0,45 7 * * 1-5`<br>`0,45 9 * * 1-5`<br>`0,45 10 * * 1-5`<br>`0,45 11 * * 1-5`<br>`0,45 12 * * 1-5`<br>`0,45 13 * * 1-5`<br>`0,45 17 * * 1-5`<br>`0,45 18 * * 1-5`<br>`0,45 19 * * 1-5` 2hrs after NASDAQ close: 21:00–23:00 UTC (after-hours moves)<br>`0,45 22 * * 1-5`<br>`0 23 * * 1-5` |
| Public market cache (zero-knowledge design) | `public_market.yml` | manual | `30 5 * * 1-5` weekdays 05:30 UTC (after the daily jobs' data is available) |
| Security checks | `security.yml` | push, pull request, manual | `17 6 * * *` daily static + live checks<br>`0 3 * * 1` weekly full XSS re-scan (Monday 03:00 UTC) |
| Send Password Reset Email | `send_reset_email.yml` | repository_dispatch | — |
| T212 History Sync | `t212_sync.yml` | manual | — |
| UI tests (mobile layout) | `ui_tests.yml` | push, pull request, manual | `47 7 * * 1-5` after the morning data refresh |
| Vendor front-end libraries | `vendor_libs.yml` | manual | — |
| Watchlist Analysis | `watchlist.yml` | manual, repository_dispatch | `40 8 * * 1-5` 08:40 UTC Mon–Fri |
| Weekly Intelligence Report | `weekly_intelligence.yml` | manual | `0 6 * * 6` 06:00 UTC Saturday |
| Zero-knowledge tests | `zk_tests.yml` | push, pull request, manual | — |

## Daily Portfolio Services

`.github/workflows/daily_services.yml`

```
python -m services.t212_sync_service
python -m services.analyst_service
python -u -m services.pie_history_service
python -u -m services.returns_service
python -m services.value_buy_service
python -m services.strategy_service
python -m services.holding_decision_service
python -m services.profit_booking_service
```

## IPO Calendar

`.github/workflows/ipo_calendar.yml`

```
python tests/ipo_service_test.py
python -m services.ipo_service --check
python -m services.ipo_service
```

## CapitalLens

`.github/workflows/monitor.yml`

```
python monitor.py
```

## Public market cache (zero-knowledge design)

`.github/workflows/public_market.yml`

```
node scripts/public_market_job.mjs
python -m services.institutional_flow_service
```

## Security checks

`.github/workflows/security.yml`

```
python -u tests/security_check.py
python -u tests/security_scan.py --report
python -u tests/security_scan.py --fix --report
```

## Send Password Reset Email

`.github/workflows/send_reset_email.yml`

```
python3 - <<'PYEOF'
```

## T212 History Sync

`.github/workflows/t212_sync.yml`

```
python -u -m services.t212_sync_service
```

## UI tests (mobile layout)

`.github/workflows/ui_tests.yml`

```
python -m playwright install --with-deps chromium
python -u tests/ui_layout_test.py
python -u tests/ipo_layout_test.py
python -u tests/support_layout_test.py
python -u tests/dipplan_layout_test.py
python -u tests/profit_pies_layout_test.py
python -u tests/appearance_layout_test.py
python -u tests/watchlist_amount_layout_test.py
```

## Watchlist Analysis

`.github/workflows/watchlist.yml`

```
python -m services.watchlist_service $TICKER
```

## Weekly Intelligence Report

`.github/workflows/weekly_intelligence.yml`

```
python -m services.institutional_flow_service
python -m services.holding_decision_service
```

## Zero-knowledge tests

`.github/workflows/zk_tests.yml`

```
python3 scripts/build_zkapp.py
```

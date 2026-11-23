# 🔔 Alerts

**Question it answers:** is any holding outside its plan, and what should I review?

Tab id `alerts` · loader `loadAlerts()` · `docs/js/alerts.js`; text built by `services/alert_service.py` / `services/alert_format.py` and, in the private app, `docs/zk/alertreport.js` / `alertfmt.js`.

## Market signals: Live · Pre Market · Post Market

The Alerts tab opens on three market views, in a card style that groups the signals; the existing **📥 Inbox** (below) is one more tab, top right, with its unread badge.

| Card | What it lists |
|---|---|
| **Major Movement · SMA Crossover** | **100 SMA triggered** and **200 SMA triggered**: stocks whose close moved from one side of the 100- / 200-day average to the other since the session before (▲ up through it, ▼ down through it, with the average level it crossed) |
| **Major Movement · 52 Week Breakout** | **52 Week High**: the close is above every close of the previous year (with the new high) |

Covers **your holdings plus your watchlist** (a stock in both shows once, tagged *Holding*). Each row shows ▲/▼, the name, a *Holding* / *Watchlist* tag and the level in the stock's own currency. Three rows show, the rest sit behind **View more (N)**.

**The three views, using each stock's own exchange clock** (UK and US sessions differ):
- **☀️ Live**: today's session while it is running (price as of when you opened the tab; UK 08:00–16:30, US 14:30–21:00 UK time).
- **🌤️ Pre Market**: what was already true at today's open = the last completed daily close before today's session.
- **🌙 Post Market**: today's completed session, once that market has closed.

**Honest about data:** the signals are computed from Yahoo daily closes (one year) fetched **when you open the tab**, with up to 5 fetches in parallel, cached for 10 minutes, **Rescan** at the bottom. It is **not a real-time feed and nothing is pushed while the app is closed**. A 100-day cross needs 101+ sessions, a 200-day cross 201+, a 52-week high 200+ prior sessions; a stock with less history simply gets no such signal. A stock whose chart cannot be read is **listed as "could not be read"**, never shown as clear. Empty views say why (e.g. no market open right now). A screening aid, not advice.

Code: engine and cards `docs/js/signals.js` (`analyse`, `scan`, `group`, `html`); tabs, scan wiring and Inbox in `docs/js/alerts.js`; the scan starts only once the Alerts tab is open (`alertsShown()` from the router). The demo serves its stored mock 1-year charts through `demo-shim.js`. Guarded by `tests/zk_signals_test.mjs` and `tests/signals_layout_test.py` (320/360/390px, every theme).

## Alerts are review reports

One house style for every alert (dashboard, phone push, email). Each report contains:

1. **Holding weight vs strategic target**, with the difference.
2. **Threshold check:** latest GBP price, daily change, 20-day closing high, drawdown.
3. **A review flag.**
4. **A data-coverage note** saying what could and could not be checked.

**No alert and no "clear" status is produced for a holding whose data cannot be verified**; the report says so instead.

## Support-zone alerts (private app, issue #51)

Raised on the **morning Refresh** (nothing runs while the app is closed) for stocks you hold that have a level in `support_levels` (see [Strategy › Support Levels](strategy.md)). Type `support`, in the same review-report style: live price, the zone, distance, your average cost, the **source and capture date**, a review flag, and "an external view, not our calculation".

- **Transitions only:** 🛡️ *reached its support zone* (from above or approaching; default priority) and 🔻 *below its support zone* (high priority). The first time a stock is seen its status is only recorded, so stocks already in or below a zone do not flood the inbox. Back above or reclaiming the zone raises nothing. The same alert is not repeated within 24 hours.
- **Honest about data:** the Trading 212 quote currency must equal the zone's currency; if it is unknown or different, nothing is compared and no alert is raised.
- Code: `analyse()` in `docs/zk/monitor.js` (levels passed in by `docs/zkapp/zkapp-tools.js` / `docs/zk/zk.js`); status stored in the encrypted `monitor_state` (`support_status`). Test: `tests/zk_support_alert_test.mjs`.

## Inbox behaviour

Like email:

| View | Contents |
|---|---|
| **📥 Inbox** (with unread badge) | Active alerts |
| **🗄 Archived** | Kept and dated; retrievable |
| **🧹 Cleared** | Dismissed; deleted automatically after **30 days** |

Actions: **✓ mark read** (or tap to open), **🗄 archive**, **✕ clear** (swipe left on a phone, with an undo toast), **↩ restore** from Archived or Cleared back to the Inbox, checkboxes for bulk actions, **Clear all read**. The 🔔 menu button shows the unread count.

## Notifications

- In-app inbox (above).
- **Phone push** through ntfy: save your ntfy topic under ⚙ Settings. Push is sent when you press Refresh, because nothing runs while the app is closed.
- Email alerts for multiple users are deferred until a sending domain exists.

## Data

`alerts` (columns include `read_at`, `archived_at`, `dismissed_at`). Writes go through the authenticated `/alerts/action` route (worker or shim). Archived history follows the 45-day live / archive rule in [Database & data flows](../database.md).

## Tests

`tests/zk_alertreport_test.mjs`, `tests/zk_notify_test.mjs`, `tests/ui_layout_test.py`.

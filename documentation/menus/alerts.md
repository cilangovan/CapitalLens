# 🔔 Alerts

**Question it answers:** is any holding outside its plan, and what should I review?

Tab id `alerts` · loader `loadAlerts()` · `docs/js/alerts.js`; text built by `services/alert_service.py` / `services/alert_format.py` and, in the private app, `docs/zk/alertreport.js` / `alertfmt.js`.

## Alerts are review reports

One house style for every alert (dashboard, phone push, email). Each report contains:

1. **Holding weight vs strategic target**, with the difference.
2. **Threshold check:** latest GBP price, daily change, 20-day closing high, drawdown.
3. **A review flag.**
4. **A data-coverage note** saying what could and could not be checked.

**No alert and no "clear" status is produced for a holding whose data cannot be verified**; the report says so instead.

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

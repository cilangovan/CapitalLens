# 🫧 P&L Bubbles

**Question it answers:** which holdings moved the most today, this week, this month?

Tab id `heatmap` · loader `loadHeatmap()` · `docs/js/heatmap.js`

## What you see

A radial chart ("bubbles"): one bubble per holding, sized and coloured by its profit or loss over a chosen window — **daily, weekly, monthly**.

- **Tooltip / tap:** shows the holding's **full name and country flag** (standing rule). Names and flags come from `instrument_exposure` in the database; if it cannot be read, the tooltip still shows the ticker and P&L.
- **Honest look-back:** history may be shorter than the period name says (for example fewer than 30 days stored). The chart uses the actual look-back it has for each period and says so.
- The "updated" stamp beside the heading shows the snapshot it was built from.

## Data

- `portfolio_snapshots` (the 60 most recent, to find the snapshot nearest 1, 7 and 30 days before the latest) and the matching `positions`.
- `instrument_exposure` for display names and flags (shared reference data, read-only for signed-in users).

## Behaviour

- Guest mode: "🔒 Sign in to view radial P&L".
- No snapshots yet: "No snapshot data yet."
- Period P&L = latest P&L − P&L at the nearest earlier snapshot.

## HTML / style

`#heatmap.tab > .card > h3 + #heatmap-grid`. The chart is drawn into `#heatmap-grid` and scales to the card width, so it fits 360px with no sideways scroll. Tooltips are shared with the rest of the app (`tickertips.js`).

## Tests

`tests/ui_layout_test.py` (layout). Tooltip data rule is covered by the standards in `CLAUDE.md` (no holdings data in JS).

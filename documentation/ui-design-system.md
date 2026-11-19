# UI & style guide

The single reference for how CapitalLens looks and behaves. New UI **reuses these patterns** (CLAUDE.md rule 6): before adding a screen, look at the nearest existing feature and copy how it does it.

## Principles

1. **Mobile first.** The owner views on a phone. Every dashboard and section fits **360px and 390px with no sideways scroll** (also checked at 320px for IPO Watch). Tap targets are **at least 40px**.
2. **Dark, calm, data-first.** One dark theme, restrained colour, colour only where it means something (green gain, red loss, amber caution).
3. **Everything collapses** and remembers its state.
4. **Honest.** Missing data is labelled; sources are named; estimates say they are estimates.
5. **No inline scripts.** Strict CSP; handlers go through `docs/zk/handlers.js` and its whitelist (`handler-names.js`).

## Design tokens (CSS variables, `:root` in each page)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0f1117` | Page background |
| `--bg2` | `#1a1d27` | Cards, header, nav |
| `--bg3` | `#22263a` | Inputs, chips, table heads |
| `--text` | `#e2e8f0` | Body text |
| `--muted` | `#8892a4` | Labels, hints, card headings |
| `--border` | `#2d3353` | All borders |
| `--accent` | `#6366f1` | Primary buttons, active tab, links |
| `--green` / `--red` / `--yellow` | `#22c55e` / `#ef4444` / `#f59e0b` | Gain / loss / caution |
| `--blue` `--purple` `--cyan` | `#3b82f6` `#a78bfa` `#06b6d4` | Secondary data colours |

Typography: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`), base 14px. Card headings are 13px, uppercase, muted. Stat values 20px bold.

## Layout components

| Component | Class / id | Notes |
|---|---|---|
| Header | `header` (`h1`, `.pill`) | Wraps on narrow screens |
| Menu bar | `nav` + `button` | `overflow-x:auto` inside the bar only; active = accent underline; unread badge `.nav-badge` |
| Tab | `.tab` / `.tab.active` | One visible at a time (`showTab`) |
| Card | `.card` + `h3` | **Collapsible automatically** (see below) |
| Stats strip | `.stats-strip > .stat-card` (`.label .value .sub`) | `auto-fill, minmax(140px,1fr)` grid |
| Grids | `.grid2`, `.grid3` | One column under 640px |
| Loading | `.loading.busy` | Muted, centred, with a spinning ring (use `.busy` only for "still fetching"; empty states use plain `.loading`) |
| Boot splash | `#boot-splash` | Private app only; full-screen spinner until sign-in or dashboard shows; CSS only |
| Period / range buttons | `.period-btn`, `.dd-ranges button` | Active = accent fill |
| Sub-tabs | `.w-cats` (watchlist, IPO markets), `.a-tabs` / `.a-tab` (alerts), `.pd-tabs` | Pill chips, wrap on a phone |
| Chips and pills | `.ipo-pill`, `.pb-lvl`, `.w-chip` | Rating, status and action labels |
| Modal / pop-up | `.modal-overlay` + `.modal-box`, `.pd-panel`, `.pb-m-box`, `.dd-panel` | Full-screen on phones, centred panel above 1000px |
| Tooltip | `tickertips.js` | Hover on desktop, tap on phone; flag + full name + type |
| Footer | `footer.app-footer` | **📘 Documentation** link, min height 40px |

## Collapsible sections (standing rule)

- Any `.card` containing an `<h3>` becomes collapsible automatically (`docs/js/collapse.js`). Tapping the heading folds the card.
- **State is stored in the database per user** in `user_ui_prefs` (`user_id`, `prefs jsonb`, own row only, size-limited), so it follows the account across logout/login and devices. A browser copy is a cache and fallback.
- Sub-sections (for example each pie group, each IPO card, Entry Analysis sections) follow the same behaviour. Do not hand-roll a different toggle.

## Colour semantics

| Meaning | Colour |
|---|---|
| Gain / buy / strong | green |
| Loss / avoid / weak | red |
| Caution / reassess / accumulate | amber / blue (see each menu page) |
| Neutral / no data | muted grey |
| Score bands (profit booking) | ≥80 green · ≥65 blue · ≥50 amber · below red |

Charts follow the same palette and are validated against the dark surface (see the data-visualisation notes in `docs/js/drilldown.js`). Never use colour alone for meaning: pair it with a label, icon or sign.

## Money, dates and numbers

- Money in £ with `en-GB` formatting; pence-quoted London lines (GBX) are shown in pence (`p`); USD `$`, EUR `€`.
- Dates `en-GB` (`19 Nov 2026`). Times are the viewer's local time; schedules in docs are UTC.
- Gains `+`, losses `−` with colour; missing values `—`, never `0`.

## Security in markup

- Everything coming from the server passes `defuse()` (`docs/js/api.js`), which replaces `< > " ' \`` with look-alikes. **Parse JSON columns before `defuse`** (`parseJsonCols` in `docs/zk/shim.js`).
- Page code escapes anything it puts into HTML.
- No inline `<script>`; no `javascript:` URLs; no new inline handlers except through the whitelisted interpreter.

## Documentation pages (this portal)

Same tokens and rules, in `docs/help/help.css`: single column on a phone, sidebar from 860px, tables and code scroll inside their own box so the page never scrolls sideways. Tested at 360/390px by `tests/docs_layout_test.py`.

## Checklist for any new UI

- [ ] Reuses the patterns above (no new look).
- [ ] Fits 360px and 390px, no sideways scroll; tap targets ≥ 40px; added to the layout tests.
- [ ] Card is collapsible (has an `<h3>`); state persists.
- [ ] Names and flags come from the database, not from JS.
- [ ] Added to **every dashboard** (edit sources, then rebuild).
- [ ] Honest empty/missing-data states; source named.
- [ ] Menu page in `documentation/menus/` updated.

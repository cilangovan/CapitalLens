# App shell: sign-in, header, menu bar, footer

The shell is everything around the nine menus. It is the same in every variant except the sign-in module.

## Layout (top to bottom)

```
┌ #login-screen ─ shown only when there is no saved session ┐
┌ header ─ 🌐 CapitalLens · badge · last updated · [Password|Settings] · Sign out ┐
├ nav ─ 📊 📈 … nine menu buttons (scrolls sideways inside the bar on a phone) ─────┤
├ .tab (one visible) ─ cards (every card collapsible) ───────────────────────────────┤
└ footer.app-footer ─ 📘 Documentation · variant note ───────────────────────────────┘
```

## Sign-in (`#login-screen`)

| Variant | How you sign in |
|---|---|
| Private (`/zkapp-prod/`) | Email + password. The password unlocks your encryption key in the browser; nothing readable is sent to the server. Forgotten password: recovery key (see [Settings & account](settings-and-account.md)). |
| Multi-user (`/app/`) | Email + password (Supabase auth), or create an account. |
| Demo | Pre-filled demo user. |
| Legacy (`/`) | Username + password through the Cloudflare worker; master (full view) or guest (values masked). |

**No login flash on refresh.** The sign-in box is hidden by CSS (`#login-screen:not(.show){visibility:hidden}`) until the saved-session check finishes. If a session is restored the dashboard appears directly; only if not is the box shown. Guarded by `tests/login_flash_browser_test.py` and `tests/zk_login_flash_test.mjs`.

**Loading state.** While the saved-session check runs (the key unlock takes a moment) the private app shows a full-screen **boot splash**: 🔒 CapitalLens, a spinning ring and "Unlocking your private dashboard…" (after 12 seconds it adds "Taking longer than usual. Check your connection, then reload."). The splash disappears the moment the sign-in box or the dashboard shows, so the screen is never blank. It is pure CSS (`#boot-splash` in `scripts/build_zkapp.py`). Inside the dashboard every card that is still fetching shows a small spinner beside "Loading…" (`.loading.busy`).

## Header

- **Pill:** `LIVE` (legacy), `BETA` (multi-user), `DEMO`, `PRIVATE` (zero-knowledge).
- **Last updated:** age of the newest snapshot. A snapshot older than 12 hours shows a warning so stale numbers never look live.
- **Guest badge** (legacy): values are masked.
- **⚙ Settings** (private) or **🔑 Password** (legacy), and **Sign out**.

## Menu bar (`nav`)

Nine buttons call `showTab(id, button)` ([router](../reference/menu-map.md)). A tab loads its data the first time it is opened and is cached for the session. The 🔔 Alerts button shows an unread badge.

| Button | Tab id |
|---|---|
| 📊 Overview | `overview` |
| 🫧 P&L Bubbles | `heatmap` |
| 📋 Positions | `positions` |
| 🔬 Analyst | `analyst` |
| 🎯 Strategy | `strategy` |
| 💰 Profit Booking | `profit` |
| 📈 Returns | `returns` |
| ⭐ Watchlist | `watchlist` (also loads IPO Watch) |
| 🔔 Alerts | `alerts` |

## Footer

Every dashboard ends with a footer containing **📘 Documentation**, a link to this portal (`/help/`). It is a standing requirement: `tests/standards_test.py` fails if a dashboard page lacks the link. The link is at least 40px tall on a phone.

## Cards and collapsing

Any `.card` with an `<h3>` collapses when its heading is tapped. The open/closed state is stored per user in `user_ui_prefs` and restored on the next login (`docs/js/collapse.js`). See the [UI & style guide](../ui-design-system.md).

## Guest and demo behaviour

Legacy guest mode masks money values and replaces most cards with a "🔒 Sign in" message. The demo shows synthetic data only; nothing in it is a real holding.

## Source

`docs/index.html` (legacy shell), `docs/demo/index.html` (demo shell), `docs/js/auth.js` (legacy sign-in), `docs/zkapp/zkapp-auth.js` (private sign-in), `docs/js/router.js`, `docs/js/collapse.js`. The other variants are generated from these by `scripts/build_app.py` and `scripts/build_zkapp.py`.

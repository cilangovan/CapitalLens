# Epic: Personalisation (themes, fonts, language, region and currency)

| | |
|---|---|
| **Epic** | Each user picks their own theme, font, language, number/date format and display currency in ⚙ Settings |
| **Menu** | ⚙ Settings (new card **🎨 Appearance & region**), applies to every dashboard |
| **Requirement ID** | UI-21 and UI-G16 ([UI requirements](ui-requirements.md)) |
| **Owner** | HOOP (`cilangovan`) |
| **Raised** | 23 Nov 2026 |
| **Status** | **Proposed. Nothing is built yet.** This page is the options paper and the requirement; the choices in [section 9](#9-decisions-needed-from-the-owner) decide the first build |

## 1. Problem

CapitalLens has one dark theme, one system font, English text and `£`/UK number formats. Users differ: some read outdoors and need a light theme, some want larger or more readable type, some think in French, German, Spanish or Italian, and some hold the account in one currency but think in another. Today none of that can be changed, and the style guide says "one dark theme".

## 2. Goal

In ⚙ Settings every signed-in user can choose, **for themselves only**:

1. a **theme** (at least 4),
2. a **font** (at least 4),
3. a **language** (English, French, German, Spanish, Italian),
4. a **region** (number, date and time format),
5. a **display currency**,

see the change **instantly**, and get the same choices on every device and every dashboard after signing in again.

## 3. Scope

**In scope:** the five settings, a live preview, per-user storage, every dashboard (legacy, demo, app, zkapp, zkapp-prod), mobile first (320/360/390px, tap targets ≥ 40px), documentation in the same commit.

**Out of scope (for now):** right-to-left languages; user-made custom colours; per-card themes; translating third-party text (company profiles, news headlines, analyst names, Yahoo/Trading 212 wording) which stays as the source wrote it and is labelled so; translating the Documentation pages in phase 1 (see options in 5.3).

## 4. Options: themes and fonts

### 4.1 Themes (pick at least 4; recommended set of 6)

Each theme is a set of the existing CSS variables (`--bg --bg2 --bg3 --text --muted --border --accent`, plus gain/loss/caution colours). Gain/loss colours keep a **sign or label** as well as colour (UI-G15) in every theme.

| # | Theme | Look | Best for | Recommended |
|---|---|---|---|---|
| T1 | **Midnight** (today's look) | Navy-black, indigo accent | Default; evening use | ✅ default |
| T2 | **Daylight** | White cards on light grey, indigo accent | Bright rooms, outdoors | ✅ |
| T3 | **AMOLED black** | True black background, thin borders | OLED phones, battery | ✅ |
| T4 | **High contrast** | Black/white with yellow accent, thicker borders, AAA contrast | Low vision | ✅ |
| T5 | **Forest** | Deep green-grey, mint accent | Calm, less blue light | optional |
| T6 | **Sepia** | Warm paper tones, brown accent | Long reading sessions | optional |
| T7 | **Match my device** | Follows the phone's light/dark setting (Midnight or Daylight) | "Set and forget" | ✅ as a mode, not a 7th palette |

### 4.2 Fonts (pick at least 4; recommended set of 5)

Honest constraint: the app has a strict CSP and no third-party calls, so **web fonts must be self-hosted** in the repo (licence-checked, subset to Latin + the accents of the five languages, `font-display:swap`) or be fonts already on the device. Every font must show `£ $ € ¥ ₹` and tabular (equal-width) digits for tables.

| # | Font | Source | Character | Recommended |
|---|---|---|---|---|
| F1 | **System** (today) | Device | Native, fastest, zero download | ✅ default |
| F2 | **Inter** | Self-hosted (SIL OFL) | Neutral, very legible numbers, tabular figures | ✅ |
| F3 | **IBM Plex Sans** | Self-hosted (SIL OFL) | Slightly technical, wide, clear 1/l/I | ✅ |
| F4 | **Atkinson Hyperlegible** | Self-hosted (SIL OFL) | Designed for low vision; unmistakable characters | ✅ |
| F5 | **Source Serif 4 / Georgia stack** | Self-hosted / device | Serif for long text | optional |
| F6 | **Monospace numbers** (JetBrains Mono / system mono) | Self-hosted / device | Columns line up perfectly | optional |

Also offered in the same card: **Text size** (Small 13 · Normal 14 · Large 16 · Extra large 18px base), because font choice and size belong together.

## 5. Options: language, region and currency

### 5.1 Languages (5, required)

English (UK) · Français · Deutsch · Español · Italiano. The page `lang` attribute follows the choice (screen readers, hyphenation, browser translation).

### 5.2 How the text is translated (the main design decision)

| Option | What it is | Pros | Cons | Recommended |
|---|---|---|---|---|
| **A. Dictionary files in the repo** | `docs/i18n/en.json fr.json de.json es.json it.json`; code calls `t('key')`; English is the fallback for a missing key | Private (no third party sees the screen), fast, testable, no cost | Every string must be extracted and reviewed by a fluent speaker | ✅ |
| B. Browser auto-translate | Rely on the browser's translate | No work | Breaks layout and numbers, not controllable, not testable | ❌ |
| C. Machine translation API at runtime | Send text to a service | Cheap to start | Sends screen text outside the app (breaks the zero-knowledge promise), costs, unreliable finance terms | ❌ |

**Translation quality:** first drafts can be machine-assisted, but **finance terms get a reviewed glossary** (Value Buy, Accumulate, drawdown, RSI, overbought, "dip", "pie"). A key that is missing in a language falls back to English and is logged by a test, never shown as a raw key.

### 5.3 What gets translated, in phases

| Phase | Covered |
|---|---|
| 1 | Settings card, header, menu bar, buttons, labels, empty states, the Dip Planner and Watchlist amount box, error messages |
| 2 | Remaining cards, tooltips, alert titles and notes |
| 3 | Engine-written sentences saved in the data (decision reasons, strategy notes, why-lines). Engines would store **keys + values** (e.g. `{key:'rsi_oversold', rsi:27}`) instead of finished English, so any language can render them. Until done, these stay English and say so |
| 4 | Documentation pages (`documentation/` → `docs/help/`) per language |

### 5.4 Region (number, date, time)

Use the browser's `Intl` with the chosen locale, never hand-built strings. Choices: **Automatic (from language)**, UK (`1,234.50`, `23/11/2026`, 24h), US (`1,234.50`, `11/23/2026`, 12h), Europe-continental (`1.234,50`, `23.11.2026`, 24h), French (`1 234,50`, narrow no-break space), Swiss (`1’234.50`). First day of week follows the region (Monday for all but US).

### 5.5 Currency

Trading 212 reports in the **account currency**. Be explicit about what changing currency means:

| Option | Meaning | Honesty requirement | Recommended |
|---|---|---|---|
| **A. Account currency (default)** | Show exactly what the broker reports | None; this is the true figure | ✅ default |
| **B. Display currency** (GBP · EUR · USD · CHF at first; more later) | Same figures **converted at a daily FX rate** for display only | Every converted figure is marked as converted (`≈`, a "converted at 1 GBP = 1.1530 EUR, Yahoo Finance, 23 Nov 16:00" note); the rate and its date are shown; if the rate is missing or older than 4 days the app falls back to account currency and says so; P&L % never changes | ✅ as an option |
| C. Symbol-only change | Swap `£` for `€` without converting | **Not allowed:** it would be a wrong number | ❌ |

Rules: stock prices stay in their **listing currency** (a US stock is `$` unless converted, pence-quoted lines stay `p`); only totals, P&L amounts and the Dip Planner / Watchlist **amount you type** use the chosen currency. The amount you type for the Dip Planner is in the currency shown on screen; internally everything is held in account currency, so a typed `€200` is converted back at the same shown rate before sizing. FX source: the same Yahoo Finance FX lines the Watchlist already uses (`GBPUSD=X` style), cached in the existing market cache; no new provider.

## 6. Settings card (phone wireframe, 360px)

```
┌──────────────────────────────────┐
│ ⚙ Settings                  ?  – ×│
├──────────────────────────────────┤
│ 🎨 Appearance & region        ▾  │
│                                  │
│ Theme                            │
│ ┌────┐┌────┐┌────┐┌────┐         │
│ │Mid-││Day-││AMO-││High│  ← swatch│
│ │nght││ligh││LED ││con-│    tiles │
│ └────┘└────┘└────┘└────┘  ≥40px   │
│ ( ) Match my device              │
│                                  │
│ Font       [ Inter           ▾ ] │
│ Text size  [ A−  Normal  A+ ]    │
│                                  │
│ Language   [ Français        ▾ ] │
│ Region     [ Automatic       ▾ ] │
│ Currency   [ Account (GBP)   ▾ ] │
│                                  │
│ ┌ Preview ──────────────────────┐│
│ │ Portefeuille  1 234,50 €  ≈   ││
│ │ +2,4 %  ▲   23.11.2026        ││
│ └───────────────────────────────┘│
│ [ Reset to defaults ]            │
└──────────────────────────────────┘
```

Changes apply **immediately** (no Save button), are remembered per user, and the Preview row always shows a sample number, a gain/loss, a date and a sentence in the chosen settings. **Reset to defaults** restores Midnight · System · English (UK) · Automatic · Account currency.

## 7. User stories

| ID | Story | Acceptance criteria |
|---|---|---|
| UI-21a | As an investor I want to choose a theme so that the app is comfortable where I read it | AC1 at least 4 themes plus "Match my device"; AC2 applies instantly with no reload and no flash on the next load (saved choice is applied before first paint); AC3 gain/loss always carry a sign or label; AC4 every theme meets WCAG AA text contrast (High contrast meets AAA); AC5 charts, bubbles and heat colours are readable in every theme |
| UI-21b | As an investor I want to choose a font and text size so that numbers and text are easy to read | AC1 at least 4 fonts; AC2 fonts are self-hosted, no third-party request, CSP unchanged; AC3 digits are tabular in tables; AC4 four text sizes; AC5 nothing scrolls sideways at 320/360/390px at Extra large |
| UI-21c | As an investor I want the app in my language | AC1 English, French, German, Spanish, Italian; AC2 `<html lang>` follows; AC3 a missing translation falls back to English, never a raw key; AC4 finance terms follow the reviewed glossary; AC5 longer German/French labels never overflow (320px test per language); AC6 text from outside sources stays as written and is labelled |
| UI-21d | As an investor I want numbers and dates in my region's format | AC1 all amounts, percentages, dates and times use `Intl` with the chosen region; AC2 input boxes accept the region's decimal mark (`200,50` and `200.50` both read as 200.5 where unambiguous) |
| UI-21e | As an investor I want to see my totals in another currency without being misled | AC1 default is the account currency; AC2 a converted figure is marked as converted with rate, source and time; AC3 stale or missing rate falls back to account currency with a message; AC4 prices keep their listing currency; AC5 percentages never change |
| UI-21f | As an investor I want my choices to follow me | AC1 stored per user (see section 8) and restored on any device and dashboard; AC2 another user on the same device is unaffected; AC3 the sign-in screen uses the device language/theme (nothing is known about the user yet); AC4 Reset to defaults works |
| UI-21g | As the owner I want every dashboard to get the same personalisation | AC1 shared modules `docs/js/theme.js`, `docs/js/i18n.js`, `docs/i18n/*.json`; AC2 loaded by legacy, demo, app, zkapp and zkapp-prod from sources (generated files never edited); AC3 the demo lets a visitor try the choices, stored in memory only for that session |

## 8. Where each choice is stored (per user)

| Dashboard | Storage | Why |
|---|---|---|
| Private app (zkapp, zkapp-prod) | Inside the **encrypted** user store (`app_settings` row `appearance`) | The server never sees the user's choices (zero-knowledge) |
| Legacy and demo | `user_ui_prefs` (own row only; the same table collapse state already uses) | Already per user, protected by row-level security |
| Before sign-in | Device only (`localStorage` keys `cl_theme`, `cl_lang`) | The sign-in screen must look right before we know the user. A tiny **pre-paint script file** (not inline; CSP) reads it and sets `data-theme`, `lang` and font on `<html>` to avoid a flash |

No theme, font, language or currency choice is ever sent to analytics or logs.

## 9. Decisions needed from the owner

1. **Themes:** the recommended 6 (Midnight, Daylight, AMOLED black, High contrast, Forest, Sepia) + "Match my device", or only the required 4 (T1–T4)?
2. **Fonts:** System + Inter + IBM Plex Sans + Atkinson Hyperlegible (4), plus the optional serif and mono?
3. **Language approach:** option A (dictionary files, phased as in 5.3)? And who reviews French, German, Spanish and Italian wording?
4. **Currency:** option B (converted display, labelled) for GBP/EUR/USD/CHF in the first release, or account currency only until later?
5. **Documentation pages** translated (phase 4) or English only for now?

## 10. Build plan (once decided)

| Step | Work | Tests |
|---|---|---|
| 1 | `docs/js/theme.js` + CSS variable sets per theme; pre-paint file; Settings card; save/restore (private + legacy + demo) | `tests/theme_layout_test.py` (every theme × 320/360/390, contrast ratios computed), `tests/zk_appearance_store_test.mjs` |
| 2 | Self-hosted fonts and text sizes | Layout test at Extra large; CSP test proves no third-party font request |
| 3 | `docs/js/i18n.js`, dictionaries, language switch, `lang` attribute, phase-1 strings | `tests/i18n_test.mjs` (every key in every language, no raw keys, placeholders match, no string longer than 160% of English for buttons) |
| 4 | Region formatting through `Intl`, input parsing | `tests/region_format_test.mjs` |
| 5 | Display currency with labelled conversion, FX cache | `tests/zk_currency_test.mjs` (round trip, stale fallback, % unchanged) |
| 6 | Phase 2 strings; engine keys (phase 3); docs (phase 4) | parity tests Python ↔ JS for engine keys |

Every step: update `documentation/` and `ui-design-system.md` (replace the "one dark theme" principle with "one default theme, user-selectable"), bump `ZK_ANALYSIS_VERSION` only if analysis output changes (step 6), rebuild generated files, run all suites, push to `main`.

## 11. Risks

| Risk | Control |
|---|---|
| Light themes break charts/bubbles that assume dark | Theme tokens used by charts; layout test screenshots every theme |
| Converted currency read as the broker's figure | Always marked `≈` with rate and time; default is account currency |
| Wrong finance translations | Reviewed glossary; fallback to English; native review before release |
| Fonts slow the app or violate CSP | Self-hosted subsets, `font-display:swap`, System is the default |
| Flash of wrong theme on load | Pre-paint script file reads the device key before first paint |
| Settings leak what a user prefers | Encrypted in the private app; never logged |

## 12. Verification

Not applicable yet (proposed). The first build will list its tests and results here, as in [Epic: Support Levels](epic-support-levels.md#verification).

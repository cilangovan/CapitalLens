# Chart requirements

Every chart in the product, what question it answers, where its data comes from, and the rules each must meet. Charts are drawn with the vendored chart library or small inline SVG; nothing is loaded from a third party at run time.

## A. Rules for every chart

| ID | Requirement | Check | Status |
|---|---|---|---|
| CH-1 | **Standard spans.** A chart with a time-range selector offers 1D · 1W · 1M · 3M · 6M · 9M · 1Y, plus All or MAX where the data allows. Extra spans (YTD on Returns, 5Y on the watchlist detail) are additions, never replacements | `tests/standards_test.py` | ✅ |
| CH-2 | **Honest short history.** If stored history cannot cover a span, the chart says so and shows the real look-back; it never presents a short line as the full span, never draws a zero for "no data" | overview/return tests, `zk_piehistory_test.mjs` | ✅ |
| CH-3 | **Fallback is labelled.** When snapshots are too few, charts rebuild from `pie_history` and say that they did | `tests/zk_overview_stale_test.mjs` | ✅ |
| CH-4 | **Broker definitions.** Values use the broker's meaning (investments value = cost basis + unrealised result); estimates are labelled | UI-G10 | ✅ |
| CH-5 | **Colour meaning.** Gain green, loss red (`var(--green)`, `var(--red)`); a sign or label always accompanies the colour (⬜ not yet enforced, see CH-12) | style guide | 🟡 |
| CH-6 | **Names and flags.** Any tooltip or label for a holding shows its full name and country flag from `instrument_exposure`; if that cannot be read, the ticker still shows | UI-G4 | 🟡 |
| CH-7 | **Phone fit.** Charts scale to the card width, fit 360px and 390px with no sideways scroll, range buttons at least 40px | `tests/ui_layout_test.py` | ✅ |
| CH-8 | **Touch.** Tooltips work on tap as well as hover; tapping outside closes them | no dedicated test | 🟡 |
| CH-9 | **Empty, loading and error states.** Each chart has a spinner while loading and a plain sentence when there is no data; none stays blank | `tests/login_flash_browser_test.py` covers the loading rule | 🟡 |
| CH-10 | **No holdings in code.** Chart labels, sectors, countries and flags come from the database, never from a list in JavaScript | `tests/standards_test.py` | ✅ |
| CH-11 | **Safe rendering.** Series names and labels from the server are escaped; charts need no inline script | `tests/security_check.py` | ✅ |
| CH-12 | **Colour-blind and contrast check.** The palette used for series and gain/loss is validated for colour-blind separation and contrast on the dark surface, and legends are present for two or more series | no validation has been run | ⬜ |
| CH-13 | **Data table alternative.** Each chart has a table or numbers view for screen readers and for checking values | only some cards have one (Markets I hold has a Table view; Returns has tables) | ⚠ |

## B. Chart catalogue

| ID | Chart | Menu | Question | Data | Spans | Specific rules |
|---|---|---|---|---|---|---|
| CH-20 | **Investments value over time** (line) | Overview | How has my invested value moved? | `portfolio_snapshots` (investments = cost basis + unrealised), fallback `pie_history` | 1D 1W 1M 3M 6M 9M 1Y | One point per saved snapshot; 1D uses intraday snapshots; label the fallback; axis labelled and ≥ 2% of the value tall; gaps dashed; buys/sells marked; tap to read a point |
| CH-21 | **Gain % by position** (bars) | Overview | Which holdings gained or lost over a period? | `positions` of latest snapshot compared with earlier snapshots | 1D 1W 1M 3M 6M 9M 1Y All | A holding with no data for the period shows "No data yet for this period", not a zero bar; All uses the broker's own profit figure |
| CH-22 | **Portfolio by pie** (doughnut) | Overview | How is value split across pies? | `positions.pie` | none | Pie colours derived from the pie name, no names in code |
| CH-23 | **Market decline by country** (horizontal bars) | Overview | Where are my holdings falling? | Holdings' price change between snapshots, grouped by country from `instrument_country_weights` | 1D 1W 1M 3M 6M 9M 1Y | Worst first; red decline, green gain; non-countries (gold, silver, other, unclassified) are not shown as countries |
| CH-24 | **Markets I hold** (trend, weekly change, table) | Overview | How far are the markets behind my holdings below their highs? | `market_cache` (Nifty 50, Sensex, FTSE 100 and others) | 1D 1W 1M 3M 1Y; "from 1Y high" | 1D is intraday; weekly change and trend in histogram form for pattern analysis; gaps labelled |
| CH-25 | **How the numbers add up** (single bar + formulas) | Overview | Why does Total differ from Investments? | snapshot account figures | none | Total = Investments + Cash + Reserved (+ Other if unexplained) |
| CH-26 | **Sector map / Country exposure** (bars) | Overview | What is my look-through exposure? | `instrument_sector_weights`, `instrument_country_weights` | none | Looks through ETFs; row-level security limits to instruments held |
| CH-30 | **P&L bubbles** (radial) | P&L Bubbles | Which holdings moved most? | latest 60 snapshots + positions | daily, weekly, monthly | Size and colour by P&L; tooltip name + flag; actual look-back stated |
| CH-40 | **Account / pie / holding value chart** | Positions drill-down | How has this pie or holding done? | 1D intraday snapshots; longer spans `pie_history` (holdings rebuilt from trade history at daily closes) | 1D 1W 1M 3M 6M 9M 1Y MAX | Return = broker return ÷ invested; 24 h excludes deposits |
| CH-50 | **Profit / value over time** | Returns | What have I made after deposits? | `returns_summary`, `realised_pnl` | 1D 1W 1M 3M 6M 9M YTD 1Y All | Switch profit ↔ value |
| CH-51 | **Monthly profit, year by year, source split** | Returns | Where did the profit come from? | `returns_summary` (trading, dividends, interest) | monthly/annual | Incomplete history stated |
| CH-60 | **Watchlist detail chart** (price + 50/200-day MA) | Watchlist | What is this item's trend? | Yahoo/MSN through the relay (private) or worker chart route (legacy) | 1D 1W 1M 3M 6M 9M 1Y 5Y | 3M and 9M are the last 63 and 189 daily closes of the 1-year series; pence shown as `p`; the demo page has no relay so this chart is unavailable there (gap) |
| CH-70 | **Strategy market score cards, sector rotation** | Strategy | Where is institutional money moving? | `institutional_flow_reports` | weekly | Score ≥80 Strong Accumulation, ≥65 Positive, ≥45 Neutral, else Weak |
| CH-71 | **Profit Booking score and sector cap bars** | Profit Booking | Which holding or sector needs action? | `profit_booking`, `profit_booking_summary` | none | Six-factor score total 100; colour ≥80 green, ≥65 blue, ≥50 amber, else red; the colour is paired with the action name |
| CH-80 | **Ops growth and activity** | Ops (staff) | Is the platform healthy and growing? | `ops_overview()`, `ops_daily` | days | Needs at least two daily snapshots; says so otherwise; aggregates only |

## C. Test scenarios (summary; full list in Traceability)

- **TS-CH1** Open Overview with 3 days of snapshots, choose 1Y → the line shows what exists and a note that history is shorter; no flat or zero line.
- **TS-CH2** Choose each span on every chart in CH-20 to CH-24, CH-40, CH-50 → each offers the standard buttons; no button is missing.
- **TS-CH3** Hover or tap a bubble → full name and flag; block `instrument_exposure` → the ticker and P&L still show.
- **TS-CH4** View every chart at 360px → no sideways scroll; buttons ≥40px.
- **TS-CH5** Holding with no history for a span → "No data yet for this period".

## D. Known gaps
CH-12 (colour-blind and contrast validation) and CH-13 (a table view for every chart) are not done; the demo has no market relay so CH-24 and CH-60 are limited there. All are listed in the [gap register](traceability.md).

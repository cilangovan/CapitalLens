# 📈 Returns

**Question it answers:** how much have I really made, after counting every deposit and withdrawal?

Tab id `returns` · loader `loadReturns()` · `docs/js/returns.js`

## Definition

Built from your **real Trading 212 money flows** (every deposit, withdrawal, trade, dividend and interest payment): **profit = account value − money you have put in** (deposits − withdrawals). Rate of return and XIRR are computed from the same flows by `services/returns_service.py` (private app: `docs/zk/returns.js`).

## Cards

| Card | What it shows |
|---|---|
| **Profit by period** | Period buttons with profit for each |
| **Profit over time / value chart** | Switch between *profit* and *value*; ranges **1D · 1W · 1M · 3M · 6M · 9M · YTD · 1Y · All** |
| **Money in** | Deposits and withdrawals |
| **Monthly profit** | Month-by-month profit |
| **Year by year** | Annual summary |
| **Where the profit came from** | Split across trading, dividends and interest |
| **Recent closed trades** | Last 100 realised trades |
| **Recent dividends** | Last 100 dividends |

## Data

`returns_summary`, `realised_pnl`, `dividends` (from the raw `t212_orders`, `t212_dividends`, `t212_transactions` history kept lossless by `services/t212_sync_service.py`).

## Behaviour

If the history is incomplete the card says so; no extrapolated numbers are shown as fact.

## Tests

`tests/zk_returns_test.mjs`, `tests/zk_t212sync_test.mjs`.

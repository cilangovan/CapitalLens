# ⚙ Settings & account

Private app: the **⚙ Settings** button in the header opens a panel; account creation, recovery and upgrade live on the account page (`/zk-prod/`).

## Settings panel (private app)

The window has two header dots (red **Close**, yellow **Minimise**) and a **?** help button. Neither Close nor Minimise stops a refresh in progress.

| Section | What it does |
|---|---|
| **🔑 Check your recovery key** | Type the key to confirm it still works. Checked in this browser only; not sent or saved. Do it about once a week |
| **Lost your recovery key?** | **Create a new recovery key** while signed in. Nothing changes until you confirm you saved the new one; then the old key stops working |
| **🧪 Compare / duplicates** | Health checks for stored data. **Scan** only reads; use **Fix** only if Scan reports extra rows |
| **🔄 Refresh your data** | Pulls your latest Trading 212 data and updates every dashboard. Paste a **read-only** Trading 212 API key (and secret); it is used once and never saved. Leave empty to re-analyse what is stored. The window shrinks to a progress chip; keep the tab open until ✅ |
| **Phone alerts** | Save your ntfy topic |

**Automatic re-analysis:** on login, stored data is re-analysed if older than 6 hours or if the app was updated, so new features appear without pressing anything. Only the Trading 212 sync needs your key. Trading 212 allows 6 requests a minute, so a first full sync takes a while.

## Account page (`/zk-prod/`)

Create account · log in · password reset with the recovery key · upgrade an existing account · **Trading 212 sync** (snapshot, sync history, full re-sync; runs in your browser through a stateless relay) · change password · "what is stored" (decrypted counts per table). The page also shows what the database holds for you (ciphertext only).

## Connecting Trading 212 (step by step)

1. In Trading 212: **Settings → API**, create a key with **read-only** permissions (never one that can trade).
2. Open ⚙ Settings → **Refresh your data** (or the account page's sync box).
3. Paste the key and secret; press **Refresh now**.
4. Keep the tab open until it shows ✅. The first sync is slow because of Trading 212's rate limit.
5. The key needs at least these **read-only** permissions: **Account data**, **Portfolio**, **Orders history** (and **Dividends/Transactions history** for Returns). A key without *Portfolio* is refused by Trading 212 and no positions can be saved.

### What the refresh tells you (issue #53)

After every refresh a box under the button lists, in plain words:

- **What changed**: "Portfolio snapshot saved: 33 positions", "New positions: …", "Quantity changed: AAAl 10 → 12", "No longer held: …", "New orders from Trading 212: 2 (2 buys, 0 sells): …", or "No new orders since the previous refresh" / "No change in holdings". A pie purchase shows up as new orders plus new or larger positions.
- **Every problem and its fix**: a key Trading 212 refuses (HTTP 401/403: check live key and Portfolio / Account data permissions), a rate limit (wait a minute, refresh again), an unreadable balance or pie list. A failed call is **never silent**: the refresh is marked "Finished with problems", **nothing wrong is saved** (no zero-value snapshot; no snapshot without positions), and the box says the analyses (ratings, strategy, entry, holdings, alerts) used the previous snapshot from <date> so they do not include anything bought since.
- If only the pie list could not be read, positions are still saved and you are warned that pie grouping may be incomplete.

On the legacy page (server pipeline) the same failures make the GitHub Action fail and send a push "CapitalLens refresh failed" with the reason, instead of finishing green on old data. The demo has no live refresh.

## Legacy dashboard

Master users can **🔑 Password** (change), and reset by email through the `send_reset_email` workflow.

## Source

`docs/zkapp/zkapp-auth.js`, `docs/zk/zk.js`, `docs/zk/t212sync.js`, `docs/zk/migrate.js`, `docs/zk/dedupe.js`, `docs/zk/notify.js`, panel markup in `scripts/build_zkapp.py`.

## Tests

`tests/zk_zkapp_page_test.mjs`, `tests/zk_prod_pages_test.mjs`, `tests/zk_crypto_test.mjs`, `tests/zk_autorefresh_test.mjs`, `tests/zk_notify_test.mjs`, `tests/zk_purchase_e2e_test.mjs` (buy between two refreshes with the real modules: positions, orders, analyst, value-buy, holding decisions, strategy, "what changed", refused key / rate limit / balance / pies), `tests/legacy_interrupt_test.py` (legacy failure paths).

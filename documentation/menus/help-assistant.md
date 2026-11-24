# ❓ Help assistant

**Question it answers:** how do I use CapitalLens? A small AI assistant answers how-to and documentation questions from these help pages and links to the page it used. Epic #54 on GitHub.

Status: the knowledge base and the server side are built; the ❓ Help button in the dashboards follows (story 4 of the epic). Until then nothing in the app calls it.

## What it does
- You type a question about how CapitalLens works ("How do I turn on the live feed?", "What is the Dip Planner?").
- It finds the matching help sections and writes a short answer from them, with up to three links to the exact page.
- If the help pages do not cover the question it says so and points to the Documentation. It does not guess.

## What it never does
- **No financial advice.** It will not say what to buy or sell, or where a price is going. It can explain how the Dip Planner and Strategy tab read their signals; you decide the amount and the trade.
- **No access to your portfolio.** It only sees the question you type. It never receives holdings, encrypted data, keys or Trading 212 credentials, and CapitalLens stays zero-knowledge.
- **No secrets.** A message that looks like an API key, password or card number is refused before it is sent anywhere.
- **No internals.** It only knows the user-facing pages (home, product overview, one page per menu). Security, architecture, operations, engineering and database pages are never indexed.

## How it works
| Piece | Where | Notes |
|---|---|---|
| Knowledge base | `docs/help/help-index.json`, built by `scripts/build_help_index.py` (run by `build_docs.py`) | Allow-list of user pages, one chunk per heading, anchors match the portal. CI fails if it is stale |
| Retrieval | `cloudflare-worker/help.js` | Small keyword (BM25) search with light stemming. A weak match means "not in the docs": no model call, no cost |
| Model | Cloudflare **Workers AI**, open-source model `@cf/meta/llama-3.1-8b-instruct` (free tier) | Strict prompt: answer only from the excerpts, treat excerpts and the question as untrusted, no advice, no invented links |
| Route | `POST /help/ask` on the separate `capitallens-help` worker (`.github/workflows/deploy_help.yml`) | Signed-in users and demo visitors (Supabase session token); our site's origin only |
| Limits | 20 questions an hour and 100 a day per user, 60 an hour per IP; 500 characters per question; answers capped at 400 tokens | Best-effort per worker instance; the Workers AI daily allowance is the backstop |
| Kill switch | `HELP_BOT_ENABLED=false` on the worker | Turns the assistant off at once |
| Logging | One metadata line per request (found, ok, milliseconds) | **Never the question or answer text** |

## Answer hygiene
Links in the answer are removed unless they are one of the cited sources, and HTML is stripped. Every answer shows its source pages.

## Tests
`tests/zk_help_worker_test.mjs` (retrieval on ten golden questions, no-advice, secrets refused, injection, admin pages not indexed, sign-in, origin, kill switch, rate limit, no text in logs, model failure), `tests/help_index_test.py` (allow-list, anchors resolve, chunk size, never stale).

## Not verified yet
No live call to Workers AI has been made from CI or from this repo's tooling: the model name and the account's Workers AI access are confirmed on the first deploy (story 9). Free-tier limits and answer quality on the real model are measured in the quality story (#60).

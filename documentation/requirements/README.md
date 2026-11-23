# Requirements pack (business analysis)

The business-analysis record for CapitalLens: what the owner asked for, written as numbered, testable requirements and traced to the code, tests and documentation that deliver them. It was written on 20 Nov 2026 from the standing rules in `CLAUDE.md`, the menu pages, the database and architecture pages, and the tests in the repository. Method: lean PRD, user stories (3 C's, INVEST) with acceptance criteria and test scenarios (from the pm-skills set by Pawel Huryn, MIT).

| Page | Covers |
|---|---|
| [Product requirements](prd.md) | Why, for whom, value proposition, objectives, scope, release |
| [UI requirements](ui-requirements.md) | Global UI rules, a story and acceptance criteria per menu, wireframes |
| [Chart requirements](chart-requirements.md) | Every chart: question, data, ranges, tooltips, empty and short-history states |
| [Data and database requirements](data-requirements.md) | Tenancy, encryption, retention, backup, integrity, data flows |
| [Security requirements](security-requirements.md) | Threats, controls, checks, accepted risks and open gaps |
| [Logging and audit requirements](logging-requirements.md) | What is recorded, what must never be, retention, monitoring, gaps |
| [Traceability and test scenarios](traceability.md) | Requirement → code → test matrix, test scenarios, the gap register |
| [Epic: Support Levels](epic-support-levels.md) | Strategy › Entry Analysis › Support Levels for held stocks (UI-20) |
| [Epic: Personalisation](epic-personalisation.md) | ⚙ Settings › themes, fonts, language (EN/FR/DE/ES/IT), region, display currency (UI-21, proposed) |
| [Demo user](../demo-requirements.md) | Epic #32 requirements and wireframes (separate pack) |

## How to read an ID

`PRD-` product · `UI-` user interface · `CH-` charts · `DB-` data · `SEC-` security · `LOG-` logging and audit. IDs never change; a retired requirement is marked withdrawn, not renumbered.

## Status legend

| Mark | Meaning |
|---|---|
| ✅ | Built, and an automated test or CI check named in the row guards it |
| 🟡 | Built, but no automated check is named for it (the rule is held by review) |
| ⚠ | Partly built; the row says what is missing |
| ⬜ | Not built (a gap; tracked in the gap register) |

Status was set from the documentation and the test files in the repository. On 20 Nov 2026 every `tests/zk_*_test.mjs` suite and `tests/standards_test.py` passed, the browser layout tests passed (except `tests/ui_layout_test.py`, which needs a database key and ran only in CI), `rls_isolation_test()` passed 63 checks on the demo project, and the Supabase security advisor was read for the demo project. The production project and the live Cloudflare and R2 settings were not inspected; rows that depend on them say so.

## Keeping it current

A change to a menu, table, chart, workflow or rule updates the matching requirement in the same commit (`CLAUDE.md`, rule 9). A new standing rule from the owner is added to `CLAUDE.md` first, then given an ID here. Backlog items live in GitHub Issues; the gap register in [Traceability](traceability.md) names the issue for each open gap.

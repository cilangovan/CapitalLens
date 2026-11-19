# Internal operations dashboard (platform team only)

Status: **planned** (epic #23). Nothing here is built yet. This page is the design and will be kept in step with every panel and alert.

## Who and what

For the people who run CapitalLens, **not customers**. It answers: is anything failing, how fast is the database growing, how many API calls and how much egress are we using, who is active, what do the logs say, and are the Cloudflare R2 backups healthy.

## Rules (non-negotiable)

- **Platform staff only, enforced on the server side.** A hidden link or a client-side flag is not access control.
- **Aggregate and operational data only.** No portfolio data, ciphertext, API keys, Trading 212 keys or emails. The zero-knowledge model must still hold.
- **Read-only credentials** kept as secrets, never in git or in page JavaScript.
- **Every panel names its source**, and estimates are labelled.

## Planned panels

| Panel | Shows | Source (to verify) | Alert |
|---|---|---|---|
| Failed runs | GitHub Actions failures, last success time, failing step; Worker errors | GitHub API, Cloudflare Workers analytics | scheduled job missed or failed twice |
| Database | size, daily growth, size per table, connections, days to plan limit | Supabase metrics / management API | 80% of plan size |
| API calls | requests by endpoint, error rate, latency, per-provider counters (market data, Trading 212) | Supabase usage, Worker analytics | error-rate spike |
| Ingress / egress | bandwidth against plan allowance | Supabase usage | 80% of allowance |
| Active users | daily/weekly/monthly active, sign-ups, failed sign-ins (counts only) | Supabase auth aggregates | none |
| Logs | search across API, Postgres, Auth and Worker logs, with redaction | Supabase logs, Worker logs | none |
| R2 backups | bucket size and growth, last backup time and size, restore-test age | Cloudflare API | backup older than 26 h or much smaller |

## Delivery (proposed in #15, awaiting owner approval)

**Grafana Cloud free tier** (10,000 series, 50 GB logs, 14-day retention, 3 users per the vendor's pricing pages) with its own sign-in and MFA. Data comes through least-privilege read-only connections:

- **Database, active users, growth:** a dedicated `ops` schema of views (counts and sizes only) read by an `ops_reader` role. The Supabase Metrics API is **not** used for these because it needs the project's service-role key, which bypasses row-level security.
- **R2 and Workers:** Cloudflare GraphQL Analytics with a read-only token.
- **Failed runs:** GitHub Actions API with a read-only token.
- **History beyond 14 days:** a small `ops.daily_stats` table (one row a day), or the paid plan if needed.

Credentials live only in Grafana's data-source settings, never in git or page JavaScript.

## Backlog

Epic #23, with #15 tooling and access, #16 database, #17 API and egress, #18 active users, #19 failed runs, #20 R2, #21 logs and redaction, #22 documentation and runbook. The public/admin documentation split is tracked in #10; this page moves to the admin-only docs when that is done.

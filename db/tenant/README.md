# CapitalLens multi-tenant schema (phase 1)

Prototype of the SaaS data model from the CapitalLens SaaS Plan. It lives in a **separate Supabase
project** (`capitallens-demo`), not the live single-user database, and is not wired to the dashboard yet.

| File | What it does |
| --- | --- |
| `01_schema.sql` | Tenant tables (`user_id` on every row), shared market tables, `profiles`, `broker_connections`, `broker_secrets`, `sync_jobs`, row-level security, grants, sign-up trigger |
| `02_seed_demo.sql` | `seed_demo_portfolio()`: the mock broker, a year of seeded Trading 212-shaped data for one user |
| `03_rls_isolation_test.sql` | `rls_isolation_test()`: 63 checks that users see only their own rows |

## Rebuild the demo

1. Create an empty Supabase project and run the three files in order (SQL editor or `psql`).
2. Create two users (Authentication, Users, or the sign-up API): `demo@capitallens.test` and
   `demo-b@capitallens.test`. The trigger in `01_schema.sql` creates their profiles.
3. Seed them:
   ```sql
   select public.seed_demo_portfolio((select id from auth.users where email = 'demo@capitallens.test'), 0.42, 1, null);
   select public.seed_demo_portfolio((select id from auth.users where email = 'demo-b@capitallens.test'), 0.77, 0.3, array['VWCEd','VUSAa','SGLNl','AAPL']);
   ```
4. Check isolation: `select public.rls_isolation_test();` should return `"all_pass": true`.

## Design notes

- Users can only **read** their own rows. They may also mark their alerts read/dismissed/archived,
  manage their watchlist, and edit their profile. Everything else is written by the service role.
- `broker_secrets` (encrypted keys) and `sync_jobs` have RLS on and no policy: service role only.
- Not yet covered: archive tables, `app_settings`, `dashboard_auth` (replaced by Supabase Auth),
  realised P&L (the mock broker only places buys), and the Python sync services (still single-user).
- Mock data is synthetic. Pie names and tickers mirror the owner's structure; weights, prices and
  amounts are invented. The seeded random walk is reproducible for a given Postgres version.

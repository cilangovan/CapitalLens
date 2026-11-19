# Table reference

> **Generated** by `scripts/build_docs.py` from `db/schema.sql` and `db/tenant/*.sql`. Do not edit by hand; change the SQL and rebuild.
> Concepts, data flows and who writes each table are in [Database & data flows](../database.md).

36 tables in the `public` schema.

| Table | Columns | Defined in |
|---|---|---|
| [`alerts`](#alerts) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`analyst_ratings`](#analyst_ratings) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`app_settings`](#app_settings) | 3 | `db/schema.sql` |
| [`audit_log`](#audit_log) | 8 | `db/tenant/13_audit_log.sql` |
| [`broker_connections`](#broker_connections) | 9 | `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`broker_secrets`](#broker_secrets) | 4 | `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`dashboard_auth`](#dashboard_auth) | 10 | `db/schema.sql` |
| [`dividends`](#dividends) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`enc_rows`](#enc_rows) | 7 | `db/tenant/11_zk_enc_rows.sql` |
| [`holding_decisions`](#holding_decisions) | 26 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`institutional_flow_reports`](#institutional_flow_reports) | 10 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`instruments`](#instruments) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`ipo_calendar`](#ipo_calendar) | 22 | `db/tenant/15_ipo_calendar.sql` |
| [`market_cache`](#market_cache) | 3 | `db/tenant/12_market_cache.sql` |
| [`pie_history`](#pie_history) | 4 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`portfolio_snapshots`](#portfolio_snapshots) | 10 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`portfolio_snapshots_archive`](#portfolio_snapshots_archive) | 8 | `db/schema.sql` |
| [`positions`](#positions) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`positions_archive`](#positions_archive) | 13 | `db/schema.sql` |
| [`profiles`](#profiles) | 8 | `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`profit_booking`](#profit_booking) | 23 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`profit_booking_summary`](#profit_booking_summary) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`realised_pnl`](#realised_pnl) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`returns_summary`](#returns_summary) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`strategy_recommendations`](#strategy_recommendations) | 12 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`sync_jobs`](#sync_jobs) | 7 | `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`t212_dividends`](#t212_dividends) | 11 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_orders`](#t212_orders) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_sync_state`](#t212_sync_state) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_transactions`](#t212_transactions) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`user_keys`](#user_keys) | 8 | `db/tenant/10_zk_keys.sql` |
| [`user_ui_prefs`](#user_ui_prefs) | 3 | `db/tenant/09_user_ui_prefs.sql` |
| [`value_buy_scores`](#value_buy_scores) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`watchlist`](#watchlist) | 11 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`watchlist_analysis`](#watchlist_analysis) | 6 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`zk_probe`](#zk_probe) | 5 | `db/tenant/10_zk_keys.sql` |

## alerts

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('alerts_id_seq'::regclass) not null` |
| `created_at` | `timestamp with time zone default now()` |
| `type` | `text` |
| `ticker` | `text` |
| `title` | `text` |
| `body` | `text` |
| `alert_type` | `text` |
| `pie` | `text` |
| `dedup_key` | `text` |
| `read_at` | `timestamp with time zone` |
| `archived_at` | `timestamp with time zone` |
| `dismissed_at` | `timestamp with time zone` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## analyst_ratings

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('analyst_ratings_id_seq'::regclass) not null` |
| `ticker` | `text not null` |
| `yahoo_ticker` | `text` |
| `pie` | `text` |
| `recommendation` | `text` |
| `star_rating` | `integer` |
| `target_mean` | `numeric` |
| `buy_pct` | `numeric` |
| `hold_pct` | `numeric` |
| `sell_pct` | `numeric` |
| `analyst_count` | `integer` |
| `updated_at` | `timestamp with time zone default now()` |
| `source` | `text` |

## app_settings

| Column | Definition |
|---|---|
| `key` | `text not null` |
| `value` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |

## audit_log

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity primary key` |
| `at` | `timestamptz not null default now()` |
| `actor` | `text not null` |
| `subject_user` | `uuid` |
| `table_name` | `text not null` |
| `op` | `text not null` |
| `row_id` | `text` |
| `detail` | `jsonb not null default '{}'::jsonb` |

## broker_connections

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `broker` | `text not null check (broker in ('trading212','zerodha','mock'))` |
| `label` | `text not null` |
| `native_currency` | `text not null default 'GBP'` |
| `status` | `text not null default 'pending' check (status in ('pending','active','error','needs_login','disabled'))` |
| `last_ok_at` | `timestamptz` |
| `last_error` | `text` |
| `created_at` | `timestamptz not null default now()` |

## broker_secrets

| Column | Definition |
|---|---|
| `connection_id` | `uuid primary key references public.broker_connections(id) on delete cascade` |
| `ciphertext` | `bytea not null` |
| `key_hint` | `text` |
| `created_at` | `timestamptz not null default now()` |

## dashboard_auth

| Column | Definition |
|---|---|
| `id` | `integer default nextval('dashboard_auth_id_seq'::regclass) not null` |
| `username` | `text not null` |
| `password_hash` | `text not null` |
| `session_token` | `text` |
| `session_expiry` | `timestamp with time zone` |
| `reset_token` | `text` |
| `reset_expiry` | `timestamp with time zone` |
| `updated_at` | `timestamp with time zone default now()` |
| `failed_logins` | `integer default 0 not null` |
| `locked_until` | `timestamp with time zone` |

## dividends

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('dividends_id_seq'::regclass) not null` |
| `reference` | `text` |
| `ticker` | `text` |
| `display` | `text` |
| `paid_date` | `date` |
| `amount` | `numeric` |
| `created_at` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## enc_rows

| Column | Definition |
|---|---|
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `kind` | `text not null check (kind ~ '^[a-z0-9_]{1,40}$')` |
| `id` | `uuid not null` |
| `nonce` | `text not null` |
| `ct` | `text not null check (length(ct) < 200000)` |
| `key_version` | `int not null default 1` |
| `updated_at` | `timestamptz not null default now()` |

## holding_decisions

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('holding_decisions_id_seq'::regclass) not null` |
| `report_date` | `date not null` |
| `ticker` | `text not null` |
| `display` | `text` |
| `pie` | `text` |
| `exchange` | `text` |
| `score` | `integer` |
| `decision` | `text` |
| `sell_level` | `integer` |
| `sell_signal` | `text` |
| `buy_signal` | `text` |
| `inst_score` | `integer` |
| `price_score` | `integer` |
| `fin_score` | `integer` |
| `val_score` | `integer` |
| `sector_score` | `integer` |
| `risk_score` | `integer` |
| `rsi` | `numeric` |
| `mom_4w` | `numeric` |
| `mom_1w` | `numeric` |
| `pct_from_high` | `numeric` |
| `above_ma50` | `boolean` |
| `vol_ratio` | `numeric` |
| `notes` | `text` |
| `created_at` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## institutional_flow_reports

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('institutional_flow_reports_id_seq'::regclass) not null` |
| `report_date` | `date not null` |
| `markets` | `jsonb default '[]'::jsonb` |
| `sector_rotation` | `jsonb default '{}'::jsonb` |
| `opportunities` | `jsonb default '[]'::jsonb` |
| `cautions` | `jsonb default '[]'::jsonb` |
| `cash_strategy` | `text` |
| `portfolio_actions` | `jsonb default '[]'::jsonb` |
| `summary` | `text` |
| `created_at` | `timestamp with time zone default now()` |

## instruments

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `name` | `text` |
| `short_name` | `text` |
| `currency` | `text` |
| `type` | `text` |
| `isin` | `text` |
| `exchange` | `text` |
| `synced_at` | `timestamp with time zone default now()` |

## ipo_calendar

| Column | Definition |
|---|---|
| `id` | `text primary key` |
| `e.g.` | `US:ANT market text not null check (market in ('US','UK','IN','HK','EU','JP','CN','SG','AU','OTHER'))` |
| `exchange` | `text` |
| `LSE` | `` |
| `NSE` | `SME name text not null` |
| `ticker` | `text` |
| `sector` | `text` |
| `status` | `text not null default 'upcoming' check (status in ('rumoured','filed','upcoming','open','priced','listed','postponed','withdrawn'))` |
| `start_date` | `date` |
| `end_date` | `date` |
| `listing_date` | `date` |
| `currency` | `text` |
| `price_low` | `numeric` |
| `price_high` | `numeric` |
| `deal_size_usd` | `numeric` |
| `rating` | `text not null default 'Not rated' check (rating in ('Subscribe','Neutral','Avoid','Not rated'))` |
| `rating_source` | `text` |
| `note` | `text` |
| `source_name` | `text` |
| `source_url` | `text check (source_url is null or source_url ~ '^https?://')` |
| `as_of` | `date not null default current_date` |
| `updated_at` | `timestamptz not null default now()` |

## market_cache

| Column | Definition |
|---|---|
| `key` | `text primary key` |
| `payload` | `jsonb not null` |
| `fetched_at` | `timestamptz not null default now()` |

## pie_history

Per-pie daily series for the positions drill-down. Rebuilt daily by services/pie_history_service.py.

| Column | Definition |
|---|---|
| `pie` | `text not null` |
| `updated_at` | `timestamp with time zone default now()` |
| `series` | `jsonb not null` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## portfolio_snapshots

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('portfolio_snapshots_id_seq'::regclass) not null` |
| `created_at` | `timestamp with time zone default now()` |
| `total_value` | `numeric` |
| `cash` | `numeric` |
| `invested` | `numeric` |
| `total_ppl` | `numeric` |
| `run_count` | `integer` |
| `raw` | `jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `connection_id` | `uuid references public.broker_connections(id) on delete cascade` |

## portfolio_snapshots_archive

Snapshots older than 45 days, moved by archive_portfolio_history(). Same columns as portfolio_snapshots.

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('portfolio_snapshots_id_seq'::regclass) not null` |
| `created_at` | `timestamp with time zone default now()` |
| `total_value` | `numeric` |
| `cash` | `numeric` |
| `invested` | `numeric` |
| `total_ppl` | `numeric` |
| `run_count` | `integer` |
| `raw` | `jsonb` |

## positions

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('positions_id_seq'::regclass) not null` |
| `snapshot_id` | `bigint` |
| `created_at` | `timestamp with time zone default now()` |
| `ticker` | `text` |
| `display` | `text` |
| `pie` | `text` |
| `current_price` | `numeric` |
| `avg_price` | `numeric` |
| `gain_pct` | `numeric` |
| `dip_from_high` | `numeric` |
| `ppl` | `numeric` |
| `exchange` | `text default 'LSE'::text` |
| `quantity` | `numeric` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `broker` | `text not null default 'trading212'` |
| `native_currency` | `text not null default 'GBP'` |

## positions_archive

Positions of archived snapshots. Same columns as positions.

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('positions_id_seq'::regclass) not null` |
| `snapshot_id` | `bigint` |
| `created_at` | `timestamp with time zone default now()` |
| `ticker` | `text` |
| `display` | `text` |
| `pie` | `text` |
| `current_price` | `numeric` |
| `avg_price` | `numeric` |
| `gain_pct` | `numeric` |
| `dip_from_high` | `numeric` |
| `ppl` | `numeric` |
| `exchange` | `text default 'LSE'::text` |
| `quantity` | `numeric` |

## profiles

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key references auth.users(id) on delete cascade` |
| `display_name` | `text` |
| `base_currency` | `text not null default 'GBP'` |
| `timezone` | `text not null default 'Europe/London'` |
| `ntfy_topic` | `text` |
| `email_alerts` | `boolean not null default true` |
| `is_demo` | `boolean not null default false` |
| `created_at` | `timestamptz not null default now()` |

## profit_booking

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('profit_booking_id_seq'::regclass) not null` |
| `ticker` | `text not null` |
| `display` | `text` |
| `yahoo_ticker` | `text` |
| `pie` | `text` |
| `kind` | `text` |
| `sector` | `text` |
| `value_gbp` | `numeric` |
| `weight_pct` | `numeric` |
| `gain_pct` | `numeric` |
| `score` | `integer` |
| `breakdown` | `jsonb` |
| `action` | `text` |
| `action_level` | `text` |
| `trim_plan` | `jsonb` |
| `trailing_stop` | `numeric` |
| `stop_distance_pct` | `numeric` |
| `max_position_gbp` | `numeric` |
| `rel_volume` | `numeric` |
| `signals` | `jsonb` |
| `notes` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## profit_booking_summary

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('profit_booking_summary_id_seq'::regclass) not null` |
| `regime` | `jsonb` |
| `sectors` | `jsonb` |
| `pies` | `jsonb` |
| `limits` | `jsonb` |
| `totals` | `jsonb` |
| `notes` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## realised_pnl

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('realised_pnl_id_seq'::regclass) not null` |
| `order_id` | `text` |
| `ticker` | `text` |
| `display` | `text` |
| `filled_date` | `date` |
| `quantity` | `numeric` |
| `fill_price` | `numeric` |
| `avg_cost` | `numeric` |
| `realised_pnl` | `numeric` |
| `realised_pnl_pct` | `numeric` |
| `side` | `text` |
| `created_at` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## returns_summary

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('returns_summary_id_seq'::regclass) not null` |
| `xirr_pct` | `numeric` |
| `annualised_pct` | `numeric` |
| `total_return_pct` | `numeric` |
| `yearly_breakdown` | `jsonb` |
| `monthly_breakdown` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |
| `details` | `jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## strategy_recommendations

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('strategy_recommendations_id_seq'::regclass) not null` |
| `week_number` | `integer` |
| `total_suggested` | `numeric` |
| `on_track` | `boolean` |
| `annualised_return` | `numeric` |
| `recommendations` | `jsonb` |
| `notes` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |
| `weeks_in_month` | `integer` |
| `weekly_budget` | `numeric` |
| `market_mood` | `jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## sync_jobs

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity primary key` |
| `connection_id` | `uuid not null references public.broker_connections(id) on delete cascade` |
| `kind` | `text not null` |
| `next_run_at` | `timestamptz not null default now()` |
| `state` | `text not null default 'queued' check (state in ('queued','running','done','failed'))` |
| `attempts` | `integer not null default 0` |
| `last_error` | `text` |

## t212_dividends

Raw Trading 212 dividend history (append-only).

| Column | Definition |
|---|---|
| `reference` | `text not null` |
| `ticker` | `text` |
| `paid_on` | `timestamp with time zone` |
| `amount` | `numeric` |
| `quantity` | `numeric` |
| `type` | `text` |
| `raw` | `jsonb not null` |
| `first_seen` | `timestamp with time zone default now()` |
| `last_seen` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `connection_id` | `uuid references public.broker_connections(id) on delete cascade` |

## t212_orders

Raw Trading 212 order/fill history (append-only, never deleted). Source for rebuilt holdings history.

| Column | Definition |
|---|---|
| `id` | `text not null` |
| `order_id` | `text` |
| `ticker` | `text` |
| `side` | `text` |
| `status` | `text` |
| `filled_at` | `timestamp with time zone` |
| `quantity` | `numeric` |
| `price` | `numeric` |
| `net_value` | `numeric` |
| `realised_pnl` | `numeric` |
| `fx_rate` | `numeric` |
| `raw` | `jsonb not null` |
| `first_seen` | `timestamp with time zone default now()` |
| `last_seen` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `connection_id` | `uuid references public.broker_connections(id) on delete cascade` |

## t212_sync_state

| Column | Definition |
|---|---|
| `endpoint` | `text not null` |
| `last_run` | `timestamp with time zone` |
| `last_full` | `timestamp with time zone` |
| `items_total` | `integer` |
| `status` | `text` |
| `detail` | `text` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `connection_id` | `uuid references public.broker_connections(id) on delete cascade` |

## t212_transactions

Raw Trading 212 cash transactions — deposits, withdrawals, fees (append-only).

| Column | Definition |
|---|---|
| `reference` | `text not null` |
| `type` | `text` |
| `amount` | `numeric` |
| `date_time` | `timestamp with time zone` |
| `raw` | `jsonb not null` |
| `first_seen` | `timestamp with time zone default now()` |
| `last_seen` | `timestamp with time zone default now()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `connection_id` | `uuid references public.broker_connections(id) on delete cascade` |

## user_keys

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key default auth.uid() references auth.users(id) on delete cascade` |
| `kdf` | `jsonb not null` |
| `pw_salt` | `text not null` |
| `rec_salt` | `text not null` |
| `wrapped_dk_pw` | `jsonb not null` |
| `wrapped_dk_rec` | `jsonb not null` |
| `key_version` | `int not null default 1` |
| `updated_at` | `timestamptz not null default now()` |

## user_ui_prefs

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key default auth.uid() references auth.users(id) on delete cascade` |
| `prefs` | `jsonb not null default '{}'::jsonb` |
| `updated_at` | `timestamptz not null default now()` |

## value_buy_scores

| Column | Definition |
|---|---|
| `id` | `bigint default nextval('value_buy_scores_id_seq'::regclass) not null` |
| `ticker` | `text not null` |
| `display` | `text` |
| `pie` | `text` |
| `currency_symbol` | `text default '₹'::text` |
| `score` | `integer` |
| `score_max` | `integer default 100` |
| `verdict` | `text` |
| `entry_zones` | `jsonb default '[]'::jsonb` |
| `scorecard` | `jsonb default '[]'::jsonb` |
| `earnings` | `jsonb default '{}'::jsonb` |
| `warning` | `text` |
| `notes` | `text` |
| `updated_at` | `timestamp with time zone default now()` |
| `this_week` | `jsonb default '{}'::jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## watchlist

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity not null` |
| `ticker` | `text not null` |
| `name` | `text` |
| `currency` | `text` |
| `exchange` | `text` |
| `added_at` | `timestamp with time zone default now()` |
| `t212_ticker` | `text` |
| `type` | `text` |
| `category` | `text default 'stock'::text not null` |
| `alternatives` | `jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## watchlist_analysis

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `updated_at` | `timestamp with time zone default now()` |
| `status` | `text` |
| `verdict` | `text` |
| `data` | `jsonb` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |

## zk_probe

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `nonce` | `text not null` |
| `ct` | `text not null` |
| `created_at` | `timestamptz not null default now()` |

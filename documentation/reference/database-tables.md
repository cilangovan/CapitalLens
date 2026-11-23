# Table reference

> **Generated** by `scripts/build_docs.py` from `db/schema.sql` and `db/tenant/*.sql`. Do not edit by hand; change the SQL and rebuild.
> Concepts, data flows and who writes each table are in [Database & data flows](../database.md).

42 tables in the `public` schema.

| Table | Columns | Defined in |
|---|---|---|
| [`alerts`](#alerts) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`analyst_ratings`](#analyst_ratings) | 19 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`app_settings`](#app_settings) | 3 | `db/schema.sql` |
| [`audit_log`](#audit_log) | 8 | `db/schema.sql`, `db/tenant/13_audit_log.sql` |
| [`broker_connections`](#broker_connections) | 11 | `db/schema.sql`, `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`broker_secrets`](#broker_secrets) | 5 | `db/schema.sql`, `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`dashboard_auth`](#dashboard_auth) | 10 | `db/schema.sql` |
| [`dividends`](#dividends) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`enc_rows`](#enc_rows) | 7 | `db/schema.sql`, `db/tenant/11_zk_enc_rows.sql` |
| [`holding_decisions`](#holding_decisions) | 26 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`institutional_flow_reports`](#institutional_flow_reports) | 10 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`instrument_country_weights`](#instrument_country_weights) | 5 | `db/schema.sql` |
| [`instrument_exposure`](#instrument_exposure) | 6 | `db/schema.sql` |
| [`instrument_sector_weights`](#instrument_sector_weights) | 4 | `db/schema.sql` |
| [`instruments`](#instruments) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`ipo_calendar`](#ipo_calendar) | 24 | `db/schema.sql`, `db/tenant/15_ipo_calendar.sql` |
| [`market_cache`](#market_cache) | 3 | `db/schema.sql`, `db/tenant/12_market_cache.sql` |
| [`ops_daily`](#ops_daily) | 7 | `db/tenant/16_ops_dashboard.sql` |
| [`pie_history`](#pie_history) | 4 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`platform_admins`](#platform_admins) | 2 | `db/tenant/16_ops_dashboard.sql` |
| [`portfolio_snapshots`](#portfolio_snapshots) | 10 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`portfolio_snapshots_archive`](#portfolio_snapshots_archive) | 10 | `db/schema.sql` |
| [`positions`](#positions) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`positions_archive`](#positions_archive) | 16 | `db/schema.sql` |
| [`profiles`](#profiles) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`profit_booking`](#profit_booking) | 23 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`profit_booking_summary`](#profit_booking_summary) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`realised_pnl`](#realised_pnl) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`returns_summary`](#returns_summary) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`strategy_recommendations`](#strategy_recommendations) | 13 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`support_levels`](#support_levels) | 18 | `db/schema.sql`, `db/tenant/23_support_levels.sql` |
| [`sync_jobs`](#sync_jobs) | 8 | `db/schema.sql`, `db/tenant/01_schema.sql`, `db/tenant/06_convert_legacy.sql` |
| [`t212_dividends`](#t212_dividends) | 11 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_orders`](#t212_orders) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_sync_state`](#t212_sync_state) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`t212_transactions`](#t212_transactions) | 9 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`user_keys`](#user_keys) | 8 | `db/schema.sql`, `db/tenant/10_zk_keys.sql` |
| [`user_ui_prefs`](#user_ui_prefs) | 3 | `db/schema.sql`, `db/tenant/09_user_ui_prefs.sql` |
| [`value_buy_scores`](#value_buy_scores) | 16 | `db/schema.sql`, `db/tenant/01_schema.sql` |
| [`watchlist`](#watchlist) | 12 | `db/schema.sql`, `db/tenant/01_schema.sql` |
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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `lynch_bucket` | `integer` |
| `lynch_name` | `text` |
| `lynch_reason` | `text` |
| `lynch_growth` | `double precision` |
| `lynch_basis` | `text` |
| `lynch_confidence` | `text` |

## app_settings

| Column | Definition |
|---|---|
| `key` | `text not null` |
| `value` | `jsonb` |
| `updated_at` | `timestamp with time zone default now()` |

## audit_log

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity not null` |
| `at` | `timestamp with time zone default now() not null` |
| `actor` | `text not null` |
| `subject_user` | `uuid` |
| `table_name` | `text not null` |
| `op` | `text not null` |
| `row_id` | `text` |
| `detail` | `jsonb default '{}'::jsonb not null` |

## broker_connections

| Column | Definition |
|---|---|
| `id` | `uuid default gen_random_uuid() not null` |
| `user_id` | `uuid default auth.uid() not null` |
| `broker` | `text not null` |
| `label` | `text not null` |
| `native_currency` | `text default 'GBP'::text not null` |
| `status` | `text default 'pending'::text not null` |
| `last_ok_at` | `timestamp with time zone` |
| `last_error` | `text` |
| `created_at` | `timestamp with time zone default now() not null` |
| `environment` | `text default 'live'::text not null` |
| `sync_state` | `jsonb default '{}'::jsonb not null` |

## broker_secrets

| Column | Definition |
|---|---|
| `connection_id` | `uuid not null` |
| `ciphertext` | `bytea` |
| `key_hint` | `text` |
| `created_at` | `timestamp with time zone default now() not null` |
| `vault_secret_id` | `uuid` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

## enc_rows

| Column | Definition |
|---|---|
| `user_id` | `uuid default auth.uid() not null` |
| `kind` | `text not null` |
| `id` | `uuid not null` |
| `nonce` | `text not null` |
| `ct` | `text not null` |
| `key_version` | `integer default 1 not null` |
| `updated_at` | `timestamp with time zone default now() not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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

## instrument_country_weights

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `country` | `text not null` |
| `flag` | `text default ''::text not null` |
| `pct` | `numeric not null` |
| `note` | `text default ''::text not null` |

## instrument_exposure

Reference data: full name, country/market flag and one-line description per Trading 212 ticker. Read-only for users; maintained by migrations/service role.

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `display_name` | `text not null` |
| `flag` | `text default ''::text not null` |
| `exposure` | `text default ''::text not null` |
| `updated_at` | `timestamp with time zone default now() not null` |
| `sector` | `text default ''::text not null` |

## instrument_sector_weights

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `sector` | `text not null` |
| `pct` | `numeric` |
| `note` | `text default ''::text not null` |

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
| `id` | `text not null` |
| `market` | `text not null` |
| `exchange` | `text` |
| `name` | `text not null` |
| `ticker` | `text` |
| `sector` | `text` |
| `status` | `text default 'upcoming'::text not null` |
| `start_date` | `date` |
| `end_date` | `date` |
| `listing_date` | `date` |
| `currency` | `text` |
| `price_low` | `numeric` |
| `price_high` | `numeric` |
| `deal_size_usd` | `numeric` |
| `rating` | `text default 'Not rated'::text not null` |
| `rating_source` | `text` |
| `note` | `text` |
| `source_name` | `text` |
| `source_url` | `text` |
| `as_of` | `date default CURRENT_DATE not null` |
| `updated_at` | `timestamp with time zone default now() not null` |
| `e.g.` | `US:ANT market text not null check (market in ('US','UK','IN','HK','EU','JP','CN','SG','AU','OTHER'))` |
| `LSE` | `` |
| `NSE` | `SME name text not null` |

## market_cache

| Column | Definition |
|---|---|
| `key` | `text not null` |
| `payload` | `jsonb not null` |
| `fetched_at` | `timestamp with time zone default now() not null` |

## ops_daily

| Column | Definition |
|---|---|
| `day` | `date primary key` |
| `db_bytes` | `bigint not null` |
| `enc_rows` | `bigint not null` |
| `users` | `integer not null` |
| `active_7d` | `integer not null` |
| `signups` | `integer not null` |
| `recorded_at` | `timestamptz not null default now()` |

## pie_history

Per-pie daily series for the positions drill-down. Rebuilt daily by services/pie_history_service.py.

| Column | Definition |
|---|---|
| `pie` | `text not null` |
| `updated_at` | `timestamp with time zone default now()` |
| `series` | `jsonb not null` |
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

## platform_admins

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key` |
| `added_at` | `timestamptz not null default now()` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `connection_id` | `uuid` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `connection_id` | `uuid` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `broker` | `text default 'trading212'::text not null` |
| `native_currency` | `text default 'GBP'::text not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `broker` | `text default 'trading212'::text not null` |
| `native_currency` | `text default 'GBP'::text not null` |

## profiles

| Column | Definition |
|---|---|
| `user_id` | `uuid not null` |
| `display_name` | `text` |
| `base_currency` | `text default 'GBP'::text not null` |
| `timezone` | `text default 'Europe/London'::text not null` |
| `ntfy_topic` | `text` |
| `email_alerts` | `boolean default true not null` |
| `is_demo` | `boolean default false not null` |
| `created_at` | `timestamp with time zone default now() not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `invested` | `jsonb` |

## support_levels

| Column | Definition |
|---|---|
| `symbol` | `text not null` |
| `name` | `text not null` |
| `level_label` | `text default 'Support zone'::text not null` |
| `zone_low` | `numeric not null` |
| `zone_high` | `numeric not null` |
| `approx` | `boolean default false not null` |
| `currency` | `text default 'USD'::text not null` |
| `tags` | `jsonb default '[]'::jsonb not null` |
| `snap_price` | `numeric` |
| `snap_pct_from_high` | `numeric` |
| `note` | `text` |
| `source_name` | `text not null` |
| `source_url` | `text` |
| `as_of` | `date default CURRENT_DATE not null` |
| `updated_at` | `timestamp with time zone default now() not null` |
| `e.g.` | `META (T212 META_US_EQ / FB_US_EQ both map here) name text not null` |
| `tone":"neutral|good|warn|bad"}]
` | `snap_price numeric` |
| `as` | `shown by the source note text` |

## sync_jobs

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity not null` |
| `connection_id` | `uuid not null` |
| `kind` | `text not null` |
| `next_run_at` | `timestamp with time zone default now() not null` |
| `state` | `text default 'queued'::text not null` |
| `attempts` | `integer default 0 not null` |
| `last_error` | `text` |
| `started_at` | `timestamp with time zone` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `connection_id` | `uuid` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `connection_id` | `uuid` |

## t212_sync_state

| Column | Definition |
|---|---|
| `endpoint` | `text not null` |
| `last_run` | `timestamp with time zone` |
| `last_full` | `timestamp with time zone` |
| `items_total` | `integer` |
| `status` | `text` |
| `detail` | `text` |
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `resume` | `text` |
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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `connection_id` | `uuid` |

## user_keys

| Column | Definition |
|---|---|
| `user_id` | `uuid default auth.uid() not null` |
| `kdf` | `jsonb not null` |
| `pw_salt` | `text not null` |
| `rec_salt` | `text not null` |
| `wrapped_dk_pw` | `jsonb not null` |
| `wrapped_dk_rec` | `jsonb not null` |
| `key_version` | `integer default 1 not null` |
| `updated_at` | `timestamp with time zone default now() not null` |

## user_ui_prefs

| Column | Definition |
|---|---|
| `user_id` | `uuid default auth.uid() not null` |
| `prefs` | `jsonb default '{}'::jsonb not null` |
| `updated_at` | `timestamp with time zone default now() not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

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
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |
| `sort_order` | `integer` |

## watchlist_analysis

| Column | Definition |
|---|---|
| `ticker` | `text not null` |
| `updated_at` | `timestamp with time zone default now()` |
| `status` | `text` |
| `verdict` | `text` |
| `data` | `jsonb` |
| `user_id` | `uuid default COALESCE(auth.uid(), 'b7b84a90-00ce-4eb7-a7f9-8a26bb213d97'::uuid) not null` |

## zk_probe

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
| `nonce` | `text not null` |
| `ct` | `text not null` |
| `created_at` | `timestamptz not null default now()` |

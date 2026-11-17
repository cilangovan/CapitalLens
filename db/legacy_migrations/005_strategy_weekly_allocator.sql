alter table strategy_recommendations add column if not exists weeks_in_month int, add column if not exists weekly_budget numeric, add column if not exists market_mood jsonb;

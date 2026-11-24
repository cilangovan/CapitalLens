-- Demo "Global Institutional Capital" card (and demo IPO calendar, support levels, market cache) failed: the demo_* tables have a read policy for
-- `authenticated` but no SELECT privilege (lost when privileges were locked down), so PostgREST answered "permission denied". RLS stays on; read-only.
grant select on public.demo_institutional_flow_reports, public.demo_ipo_calendar, public.demo_support_levels, public.demo_market_cache to authenticated;

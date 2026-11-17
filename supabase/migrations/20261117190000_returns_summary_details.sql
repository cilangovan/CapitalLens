-- Full returns breakdown rebuilt from real Trading 212 money flows (deposits, withdrawals, trades, dividends, interest).
alter table public.returns_summary add column if not exists details jsonb;
comment on column public.returns_summary.details is 'Returns rebuilt from Trading 212 cash flows: profit breakdown, money in, XIRR, time-weighted return, periods, yearly/monthly, value-vs-deposits series. Built by services/returns_service.py.';

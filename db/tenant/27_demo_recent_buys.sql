-- Demo: two mock BUY orders inside the last 7 days so the "Recent purchases" card has something to show (current dates, refreshed daily).
-- Prices are a little below the latest mock price, so the card shows a plausible small move. Mock only; never real holdings.
create or replace function public.seed_demo_recent_buys(p_user uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; r record; i integer := 0; amt numeric[] := array[40, 30]; ago interval[] := array[interval '1 day', interval '3 days']; fil timestamptz; px numeric;
begin
  delete from public.t212_orders where user_id = p_user and id like 'MOCK-RECENT-%';
  for r in select p.ticker, p.current_price from public.positions p
            where p.user_id = p_user and p.snapshot_id = (select id from public.portfolio_snapshots where user_id = p_user order by created_at desc, id desc limit 1)
              and p.current_price > 0 order by p.ticker limit 2 loop
    i := i + 1; fil := date_trunc('day', now()) - ago[i] + interval '9 hours 30 minutes'; px := round(r.current_price * (case i when 1 then 0.985 else 1.012 end), 4);
    insert into public.t212_orders (user_id, id, order_id, ticker, side, status, filled_at, quantity, price, net_value, fx_rate, raw)
      values (p_user, 'MOCK-RECENT-' || r.ticker, 'MOCK-RECENT-' || r.ticker, r.ticker, 'BUY', 'FILLED', fil, round(amt[i] / px, 4), px, amt[i], 1, jsonb_build_object('mock', true, 'ticker', r.ticker));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.seed_demo_recent_buys(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_recent_buys(uuid) to service_role;

-- hook into the daily demo refresh right after the portfolio is seeded (so the strategy row sees these buys too); idempotent
do $f$ declare d text; begin
  if to_regprocedure('public.demo_refresh()') is null then return; end if;
  d := pg_get_functiondef('public.demo_refresh()'::regprocedure);
  if position('seed_demo_recent_buys' in d) = 0 then
    d := replace(d, 'res := public.seed_demo_portfolio(t, 0.42, 1, null);', 'res := public.seed_demo_portfolio(t, 0.42, 1, null);' || chr(10) || '  perform public.seed_demo_recent_buys(t);');
    execute d;
  end if;
end $f$;

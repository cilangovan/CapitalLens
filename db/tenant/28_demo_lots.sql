-- Demo: mock BUY history for a few stocks held outside pies, so the "Purchases outside pies" card shows separate buys at different prices.
-- Each stock's buys add up to the shares held, prices sit around the latest mock price (some above, some below). Mock only; never real holdings.
create or replace function public.seed_demo_lots(p_user uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; r record; k integer; snap bigint; q numeric[] := array[0.5, 0.3, 0.2]; mult numeric[] := array[0.72, 0.91, 1.08]; ago integer[] := array[210, 120, 35]; px numeric; qty numeric; left_q numeric;
begin
  delete from public.t212_orders where user_id = p_user and id like 'MOCK-LOT-%';
  select id into snap from public.portfolio_snapshots where user_id = p_user order by created_at desc, id desc limit 1;
  for r in select p.ticker, p.quantity, p.current_price from public.positions p
            where p.user_id = p_user and p.snapshot_id = snap and p.current_price > 0 and p.quantity > 0
              and p.ticker in ('NVDA_US_EQ', 'MSFT_US_EQ', 'AAPL_US_EQ') order by p.ticker loop
    left_q := r.quantity;
    for k in 1..3 loop
      qty := case when k = 3 then left_q else round(r.quantity * q[k], 4) end; left_q := left_q - qty;
      px := round(r.current_price * mult[k], 4);
      insert into public.t212_orders (user_id, id, order_id, ticker, side, status, filled_at, quantity, price, net_value, fx_rate, raw)
        values (p_user, 'MOCK-LOT-' || r.ticker || '-' || k, 'MOCK-LOT-' || r.ticker || '-' || k, r.ticker, 'BUY', 'FILLED',
                date_trunc('day', now()) - (ago[k] || ' days')::interval + interval '10 hours', qty, px, round(qty * px * 0.79, 2), 1, jsonb_build_object('mock', true, 'ticker', r.ticker));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.seed_demo_lots(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_lots(uuid) to service_role;

-- hook into the daily demo refresh right after the recent-buys seed; idempotent
do $f$ declare d text; begin
  if to_regprocedure('public.demo_refresh()') is null then return; end if;
  d := pg_get_functiondef('public.demo_refresh()'::regprocedure);
  if position('seed_demo_lots' in d) = 0 and position('seed_demo_recent_buys(t);' in d) > 0 then
    d := replace(d, 'perform public.seed_demo_recent_buys(t);', 'perform public.seed_demo_recent_buys(t);' || chr(10) || '  perform public.seed_demo_lots(t);');
    execute d;
  end if;
end $f$;

-- Weekly budget vs what was actually bought (filled Trading 212 BUY orders). NULL = orders could not be read.
alter table public.strategy_recommendations add column if not exists invested jsonb;

-- Demo accounts: fill it from the demo user's own mock orders so the card behaves like the real dashboard.
create or replace function public.strategy_fill_invested() returns trigger language plpgsql as $$
declare ws date := date_trunc('week', current_date)::date; ms date := date_trunc('month', current_date)::date; w numeric; m numeric; ow int; om int;
begin
  if new.invested is not null or not exists (select 1 from public.profiles where user_id = new.user_id and is_demo) then return new; end if;
  select coalesce(sum(abs(net_value)) filter (where filled_at::date >= ws), 0), coalesce(sum(abs(net_value)), 0),
         count(*) filter (where filled_at::date >= ws), count(*)
    into w, m, ow, om
    from public.t212_orders where user_id = new.user_id and side = 'BUY' and status in ('FILLED','PARTIALLY_FILLED')
      and filled_at::date >= ms and filled_at::date <= current_date and net_value is not null;
  new.invested := jsonb_build_object('week', round(w, 2), 'month', round(m, 2), 'orders_week', ow, 'orders_month', om, 'unpriced', 0,
    'week_start', ws, 'month_start', ms, 'by_pie_week', '{}'::jsonb, 'outside_pies_week', round(w, 2), 'source', 'Trading 212 filled buy orders (demo data)');
  return new;
end $$;
drop trigger if exists strategy_fill_invested on public.strategy_recommendations;
create trigger strategy_fill_invested before insert on public.strategy_recommendations for each row execute function public.strategy_fill_invested();

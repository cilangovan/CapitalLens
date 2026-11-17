-- Impersonates each demo user via the same role and JWT claim the API uses, and checks nothing leaks.
-- Run:  select public.rls_isolation_test();   -- expect {"all_pass": true, "failures": [], ...}
-- Needs the two demo users (demo@ and demo-b@capitallens.test) seeded with data (02_seed_demo.sql).
create or replace function public.rls_isolation_test() returns jsonb language plpgsql set search_path = public as $f$
declare
  a uuid; b uuid; n bigint; own bigint; tbl text; res jsonb := '[]'; rc bigint;
  tables text[] := array['alerts','portfolio_snapshots','positions','holding_decisions','profit_booking',
    'profit_booking_summary','strategy_recommendations','returns_summary','realised_pnl','dividends','t212_orders',
    't212_dividends','t212_transactions','t212_sync_state','value_buy_scores','watchlist','watchlist_analysis',
    'pie_history','broker_connections'];
begin
  select id into a from auth.users where email = 'demo@capitallens.test';
  select id into b from auth.users where email = 'demo-b@capitallens.test';

  foreach tbl in array tables loop
    execute format('select count(*) from public.%I where user_id = %L', tbl, a) into own;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    execute format('select count(*) from public.%I where user_id = %L', tbl, b) into n;
    res := res || jsonb_build_object('check', 'A cannot read B rows in ' || tbl, 'pass', n = 0, 'detail', n);
    execute format('select count(*) from public.%I', tbl) into n;
    res := res || jsonb_build_object('check', 'A sees exactly own rows in ' || tbl, 'pass', n = own, 'detail', n || ' of ' || own);
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
    execute format('select count(*) from public.%I where user_id = %L', tbl, a) into n;
    res := res || jsonb_build_object('check', 'B cannot read A rows in ' || tbl, 'pass', n = 0, 'detail', n);
    execute 'reset role';
  end loop;

  -- Writes across users and into locked tables must fail.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update alerts set read_at = now() where user_id = b;
  get diagnostics rc = row_count;
  res := res || jsonb_build_object('check', 'A cannot update B alerts', 'pass', rc = 0, 'detail', rc);

  begin
    insert into watchlist (user_id, ticker) values (b, 'HACK');
    res := res || jsonb_build_object('check', 'A cannot insert watchlist row for B', 'pass', false, 'detail', 'insert succeeded');
  exception when others then
    res := res || jsonb_build_object('check', 'A cannot insert watchlist row for B', 'pass', true, 'detail', sqlerrm);
  end;
  begin
    update alerts set title = 'tampered' where user_id = a;
    res := res || jsonb_build_object('check', 'A cannot edit alert text (only read/dismiss/archive)', 'pass', false, 'detail', 'update succeeded');
  exception when others then
    res := res || jsonb_build_object('check', 'A cannot edit alert text (only read/dismiss/archive)', 'pass', true, 'detail', sqlerrm);
  end;
  begin
    perform 1 from broker_secrets limit 1;
    res := res || jsonb_build_object('check', 'Users cannot read broker_secrets', 'pass', false, 'detail', 'select succeeded');
  exception when others then
    res := res || jsonb_build_object('check', 'Users cannot read broker_secrets', 'pass', true, 'detail', sqlerrm);
  end;
  begin
    perform 1 from sync_jobs limit 1;
    res := res || jsonb_build_object('check', 'Users cannot read sync_jobs', 'pass', false, 'detail', 'select succeeded');
  exception when others then
    res := res || jsonb_build_object('check', 'Users cannot read sync_jobs', 'pass', true, 'detail', sqlerrm);
  end;
  execute 'reset role';

  -- Signed-out (anon) visitors get nothing.
  execute 'set local role anon';
  begin
    perform 1 from positions limit 1;
    res := res || jsonb_build_object('check', 'Anon cannot read positions', 'pass', false, 'detail', 'select succeeded');
  exception when others then
    res := res || jsonb_build_object('check', 'Anon cannot read positions', 'pass', true, 'detail', sqlerrm);
  end;
  execute 'reset role';

  return jsonb_build_object(
    'all_pass', (select bool_and((e ->> 'pass')::boolean) from jsonb_array_elements(res) e),
    'checks_run', jsonb_array_length(res),
    'failures', (select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(res) e where not (e ->> 'pass')::boolean));
end $f$;
revoke all on function public.rls_isolation_test() from public, anon, authenticated;
grant execute on function public.rls_isolation_test() to service_role;

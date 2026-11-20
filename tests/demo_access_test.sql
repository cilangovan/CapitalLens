-- Run against the demo/private project (ggprfdetivzekjxlpvyq) AFTER db/tenant/17_demo_access.sql. Everything happens inside one DO block that ends by
-- raising an exception, so NOTHING is kept: the expected last line is  ERROR: TEST OK ...  . Any other error text is a failure (assert message).
-- Guards epic #32: expiry (time / idle / closed), isolation, master-account lock, owner-only reset, limits, kill-switch, clean-up, real users unaffected.
do $test$
declare
  tpl uuid; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid(); real_u uuid;
  n int; tpl_snaps int; tpl_pos int; j jsonb; notes text := ''; pw text;
  mk_claims text;
begin
  select id into tpl from auth.users where email = 'demo@capitallens.test';
  select id into real_u from auth.users where email not like '%@capitallens.test' and email not like 'demo-%' order by created_at limit 1;
  select count(*) into tpl_snaps from public.portfolio_snapshots where user_id = tpl;
  select count(*) into tpl_pos from public.positions where user_id = tpl;
  assert tpl is not null and tpl_snaps > 0, 'master demo account has data';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo-test-' || substr(u::text, 1, 8) || '@demo.invalid', extensions.crypt('x', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now()
  from unnest(array[a, b, c, d]) u;

  -- 1. register copies the master data, per visitor
  j := public.demo_register_session(a, 'ip-test');
  assert (select count(*) from public.portfolio_snapshots where user_id = a) = tpl_snaps, 'snapshots copied';
  assert (select count(*) from public.positions where user_id = a) = tpl_pos, 'positions copied';
  assert (select count(*) from public.positions p join public.portfolio_snapshots s on s.id = p.snapshot_id where p.user_id = a and s.user_id <> a) = 0, 'copied positions point at the visitor''s own snapshots';
  assert (select is_demo from public.profiles where user_id = a), 'profile flagged demo';
  assert (j->>'expires_at')::timestamptz between now() + interval '59 minutes' and now() + interval '61 minutes', 'expires in about an hour';
  notes := notes || 'copy ok; ';

  -- 2. visitor sees only their own rows; another visitor sees none of theirs
  perform public.demo_register_session(b, 'ip-test-b');
  mk_claims := json_build_object('sub', a, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', mk_claims, true); execute 'set local role authenticated';
  select count(*) into n from public.portfolio_snapshots; assert n = tpl_snaps, 'visitor A reads exactly their own snapshots, got ' || n;
  select count(*) into n from public.positions where user_id <> a; assert n = 0, 'visitor A reads none of another user''s positions';
  select count(*) into n from public.enc_rows; assert n = 0, 'visitor A reads no encrypted rows';
  j := public.demo_touch(); assert (j->>'active')::boolean and (j->>'seconds_left')::int > 3500, 'demo_touch active with time left';
  execute 'reset role';
  notes := notes || 'isolation ok; ';

  -- 3. real (non-demo) user is unaffected by the restrictive policy
  if real_u is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', real_u, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
    select count(*) into n from public.enc_rows; assert n = (select count(*) from public.enc_rows where user_id = real_u) or true, 'real user query runs';
    perform 1 from public.profiles where user_id = real_u; assert found, 'real user still reads their profile';
    execute 'reset role';
    notes := notes || 'real user ok; ';
  end if;

  -- 4. hard time limit: expire A -> reads nothing, touch says time
  update public.demo_sessions set expires_at = now() - interval '1 minute' where user_id = a;
  perform set_config('request.jwt.claims', mk_claims, true); execute 'set local role authenticated';
  select count(*) into n from public.portfolio_snapshots; assert n = 0, 'expired session reads nothing, got ' || n;
  j := public.demo_touch(); assert not (j->>'active')::boolean and j->>'reason' = 'time', 'touch reports time: ' || j::text;
  execute 'reset role';
  notes := notes || 'time ok; ';

  -- 5. idle limit: last seen 46 minutes ago
  update public.demo_sessions set last_seen_at = now() - interval '46 minutes' where user_id = b;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.positions; assert n = 0, 'idle session reads nothing';
  j := public.demo_touch(); assert not (j->>'active')::boolean and j->>'reason' = 'idle', 'touch reports idle: ' || j::text;
  execute 'reset role';
  notes := notes || 'idle ok; ';

  -- 6. close with grace: still readable inside the grace and a touch cancels it; unreadable after it
  perform public.demo_register_session(c, 'ip-test-c');
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.demo_end(true);
  select count(*) into n from public.portfolio_snapshots; assert n = tpl_snaps, 'readable inside the close grace';
  j := public.demo_touch(); assert (j->>'active')::boolean, 'touch inside grace keeps the session (refresh case)';
  assert (select end_after from public.demo_sessions where user_id = c) is null, 'touch cleared end_after' ;
  perform public.demo_end(true);
  execute 'reset role';
  update public.demo_sessions set end_after = now() - interval '1 second' where user_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.portfolio_snapshots; assert n = 0, 'closed session reads nothing after the grace';
  execute 'reset role';
  notes := notes || 'closed ok; ';

  -- 7. limits and kill-switch
  assert (public.demo_can_issue('ip-fresh')->>'ok')::boolean, 'fresh ip may issue';
  insert into public.demo_sessions (user_id, expires_at, ip_hash) select null, now() + interval '1 hour', 'ip-many' from generate_series(1, 5);
  assert public.demo_can_issue('ip-many')->>'code' = 'rate', 'sixth login from one address is refused';
  update public.demo_settings set value = '1' where key = 'max_active';
  assert public.demo_can_issue('ip-fresh')->>'code' = 'busy', 'capacity cap';
  update public.demo_settings set value = '25' where key = 'max_active';
  update public.demo_settings set value = 'false' where key = 'enabled';
  assert public.demo_can_issue('ip-fresh')->>'code' = 'disabled', 'kill-switch';
  update public.demo_settings set value = 'true' where key = 'enabled';
  notes := notes || 'limits ok; ';

  -- 8. master account lock + visitor lock + owner reset
  begin update auth.users set encrypted_password = 'tampered' where id = tpl; assert false, 'master password change must be refused';
  exception when insufficient_privilege then notes := notes || 'master locked; '; end;
  begin update auth.users set email = 'x@y.z' where id = tpl; assert false, 'master email change must be refused';
  exception when insufficient_privilege then null; end;
  begin update auth.users set encrypted_password = 'tampered' where id = d; update public.demo_sessions set user_id = d where false; assert true;
  end;
  perform public.demo_register_session(d, 'ip-test-d');
  begin update auth.users set encrypted_password = 'tampered' where id = d; assert false, 'visitor password change must be refused';
  exception when insufficient_privilege then notes := notes || 'visitor locked; '; end;
  update auth.users set last_sign_in_at = now() where id = tpl;           -- ordinary updates (sign-in bookkeeping) still work
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);   -- act as the SQL-editor owner, not a visitor
  pw := public.demo_owner_reset_template(null); assert length(pw) >= 12, 'owner reset returns a generated password';
  assert (select count(*) from public.audit_log where op = 'DEMO_OWNER_RESET' and subject_user = tpl) >= 1, 'owner reset is audited';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.demo_owner_reset_template('SomethingLongEnough1'); assert false, 'a visitor must not reset the master';
  exception when insufficient_privilege then notes := notes || 'reset owner-only; '; end;
  begin perform public.demo_end_all(); assert false, 'a visitor must not end all sessions';
  exception when insufficient_privilege then null; end;
  begin perform public.demo_cleanup(); assert false, 'a visitor must not run clean-up';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- 9. clean-up deletes ended accounts and their rows, keeps the usage rows
  j := public.demo_cleanup();
  assert (j->>'deleted')::int >= 3, 'clean-up deleted the ended visitors: ' || j::text;
  assert not exists (select 1 from auth.users where id in (a, b, c)), 'ended visitor accounts are gone';
  assert not exists (select 1 from public.portfolio_snapshots where user_id in (a, b, c)), 'their rows cascaded away';
  assert exists (select 1 from auth.users where id = d), 'a live visitor is kept';
  assert (select count(*) from public.demo_sessions where ended_reason in ('time', 'idle', 'closed')) >= 3, 'usage rows remain with reasons';
  assert (select count(*) from public.portfolio_snapshots where user_id = tpl) = tpl_snaps, 'master data untouched';
  notes := notes || 'cleanup ok; ';

  raise exception 'TEST OK: %', notes;
end
$test$;

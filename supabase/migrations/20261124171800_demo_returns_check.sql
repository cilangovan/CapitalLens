-- #65: the demo's returns_summary.details had no `check` (cash reconciliation) like the real pipeline writes, so the Returns footer crashed.
-- Patch seed_demo_returns in place (idempotent): the demo's mock cash and account value are its own "Trading 212" figures, so the check mirrors them.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'seed_demo_returns';
  if def is null or position('''check''' in def) > 0 then return; end if;
  def := replace(def, '''note'', ''Illustrative demo figures'');',
    '''check'', jsonb_build_object(''cash_rebuilt'', round(coalesce(cash_now, 0), 2), ''cash_t212'', round(coalesce(cash_now, 0), 2), ''account_rebuilt'', round(val[n], 2), ''account_t212'', round(val[n], 2)), ''note'', ''Illustrative demo figures'');');
  execute def;
end $$;

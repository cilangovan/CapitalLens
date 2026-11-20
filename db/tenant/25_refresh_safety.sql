-- 25: a refresh that is cut off part-way must not leave half-saved data (legacy page / GitHub Actions pipeline).
--  1. save_snapshot(): snapshot + positions + alerts in ONE transaction. The dashboards read positions by the latest snapshot id, so a snapshot
--     without its positions (what two separate REST inserts can leave if the run is killed between them) must never be visible.
--     SECURITY INVOKER: row-level security and the user_id defaults apply exactly as for the REST inserts it replaces.
--  2. t212_sync_state.resume: where a history catch-up was cut off, so the next run carries on instead of stopping at "already stored".
alter table public.t212_sync_state add column if not exists resume text;

create or replace function public.save_snapshot(p_snapshot jsonb, p_positions jsonb default '[]'::jsonb, p_alerts jsonb default '[]'::jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare sid bigint;
begin
  insert into portfolio_snapshots (total_value, cash, invested, total_ppl, run_count, raw)
  values ((p_snapshot->>'total_value')::numeric, (p_snapshot->>'cash')::numeric, (p_snapshot->>'invested')::numeric,
          (p_snapshot->>'total_ppl')::numeric, (p_snapshot->>'run_count')::int, p_snapshot->'raw')
  returning id into sid;
  insert into positions (snapshot_id, ticker, display, pie, exchange, current_price, avg_price, gain_pct, dip_from_high, ppl, quantity)
  select sid, x->>'ticker', x->>'display', x->>'pie', coalesce(x->>'exchange', 'LSE'), (x->>'current_price')::numeric, (x->>'avg_price')::numeric,
         (x->>'gain_pct')::numeric, (x->>'dip_from_high')::numeric, (x->>'ppl')::numeric, (x->>'quantity')::numeric
  from jsonb_array_elements(coalesce(p_positions, '[]'::jsonb)) x;
  insert into alerts (type, alert_type, ticker, title, body)
  select x->>'type', coalesce(x->>'alert_type', x->>'type'), coalesce(x->>'ticker', ''), x->>'title', x->>'body'
  from jsonb_array_elements(coalesce(p_alerts, '[]'::jsonb)) x;
  return sid;
end $$;
revoke execute on function public.save_snapshot(jsonb, jsonb, jsonb) from anon;

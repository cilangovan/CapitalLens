-- Epic #32: mock Analyst, Profit Booking and Strategy data for the demo, built from the demo holdings and refreshed every day by demo_refresh().
-- The numbers are invented for illustration (the demo banner says so); shapes match what docs/js/analyst.js, profit.js and strategy.js render.
-- Applied to the demo project (ggprfdetivzekjxlpvyq) after 18_demo_refresh.sql. Additive: the Lynch columns are nullable.
alter table public.analyst_ratings
  add column if not exists lynch_bucket int, add column if not exists lynch_name text, add column if not exists lynch_reason text,
  add column if not exists lynch_growth double precision, add column if not exists lynch_basis text, add column if not exists lynch_confidence text;

create or replace function public.seed_demo_insights(p_user uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sid bigint; total numeric; invested numeric; risk numeric; wk date := date_trunc('week', current_date)::date;
  h record; r1 numeric; r2 numeric; kind text; sc int; wt numeric; lvl text; act text; sdp numeric; stop_px numeric; maxpos numeric; sect text; yt text;
  bd jsonb; tp jsonb; sig jsonb; nts jsonb; trims numeric := 0; c_re int := 0; c_tr int := 0; c_rb int := 0; c_run int := 0; c_hold int := 0;
  vs int; zones jsonb; card jsonb; earn jsonb; tw jsonb; twact text; warn text; entry_px numeric; w int; dsc int; sl int; bsig text; ssig text; dtxt text;
  reg jsonb; secs jsonb; pies jsonb; lim jsonb; tot jsonb; rec jsonb := '[]'::jsonb; pr record; remaining numeric := 100; wsum numeric; amt numeric; i int := 0; npies int;
  etf_val numeric; tech_val numeric; gold_val numeric; cons_val numeric; tech_pct numeric; notes_pb jsonb; n_hd int := 0; n_vb int := 0; n_ar int := 0;
  mk jsonb; pa jsonb; lb int; lname text; lg numeric; stars int; recm text;
begin
  select s.id into sid from public.portfolio_snapshots s where s.user_id = p_user order by s.created_at desc limit 1;
  if sid is null then return jsonb_build_object('skipped', 'no snapshot'); end if;
  select sum(current_price::numeric * quantity::numeric), sum(avg_price::numeric * quantity::numeric) into total, invested
    from public.positions where user_id = p_user and snapshot_id = sid;
  if total is null or total <= 0 then return jsonb_build_object('skipped', 'no positions'); end if;
  risk := round(total * 0.01, 0);

  delete from public.profit_booking where user_id = p_user;
  delete from public.profit_booking_summary where user_id = p_user;
  delete from public.holding_decisions where user_id = p_user;
  delete from public.value_buy_scores where user_id = p_user;
  delete from public.strategy_recommendations where user_id = p_user;

  for h in select ticker, display, pie, exchange, current_price::numeric px, avg_price::numeric avg, quantity::numeric qty,
                  (current_price::numeric * quantity::numeric) val, coalesce(gain_pct::numeric, 0) gain
           from public.positions where user_id = p_user and snapshot_id = sid order by ticker loop
    r1 := (abs(hashtext(h.ticker || wk::text)) % 1000) / 1000.0;
    r2 := (abs(hashtext(wk::text || h.ticker || 'b')) % 1000) / 1000.0;
    kind := case when h.ticker like '%_US_EQ' then 'stock' else 'etf' end;
    sc := least(95, greatest(28, round(55 + h.gain * 0.6 + (r1 - 0.5) * 30)))::int;
    wt := h.val / total * 100;
    sect := case when h.ticker in ('SGLNl_EQ', 'SSLNl_EQ') then 'Gold & Precious Metals' when h.ticker = 'AMZN_US_EQ' then 'Consumer Cyclical'
                 when kind = 'stock' then 'Technology' else 'Diversified ETF' end;
    yt := case kind when 'stock' then h.display
                    else substr(h.display, 1, length(h.display) - 1) || case right(h.display, 1) when 'l' then '.L' when 'd' then '.DE' when 'a' then '.AS' else '' end end;
    lvl := case when h.gain <= -15 then 'reassess' when kind = 'stock' and h.gain >= 30 then 'trim' when wt >= 8 then 'rebalance' when sc >= 75 then 'run' else 'hold' end;
    act := case lvl when 'reassess' then 'Down more than 15%: re-check why you own it' when 'trim' then 'Up enough to book part of the gain'
                    when 'rebalance' then 'Large share of the account: consider moving some to a smaller pie' when 'run' then 'Strong trend: let it run, keep the exit rule'
                    else 'Nothing to do: hold' end;
    c_re := c_re + (lvl = 'reassess')::int; c_tr := c_tr + (lvl = 'trim')::int; c_rb := c_rb + (lvl = 'rebalance')::int; c_run := c_run + (lvl = 'run')::int; c_hold := c_hold + (lvl = 'hold')::int;
    if kind = 'stock' then
      sdp := round(9 + r1 * 8, 1); stop_px := round(h.px * (1 - sdp / 100), 2); maxpos := round(risk / (sdp / 100), 0);
      tp := jsonb_build_array(
        jsonb_build_object('gain', 25, 'price', round(h.avg * 1.25, 2), 'unit', '£', 'label', 'Lock in first gains', 'sell_pct', 15, 'sell_qty', round(h.qty * 0.15, 2), 'sell_gbp', round(h.qty * 0.15 * h.px, 0), 'hit', h.gain >= 25),
        jsonb_build_object('gain', 50, 'price', round(h.avg * 1.5, 2), 'unit', '£', 'label', 'Recover the initial capital', 'sell_pct', 20, 'sell_qty', round(h.qty * 0.20, 2), 'sell_gbp', round(h.qty * 0.20 * h.px, 0), 'hit', h.gain >= 50),
        jsonb_build_object('gain', 100, 'price', round(h.avg * 2, 2), 'unit', '£', 'label', 'Let the rest run free', 'sell_pct', 25, 'sell_qty', round(h.qty * 0.25, 2), 'sell_gbp', round(h.qty * 0.25 * h.px, 0), 'hit', h.gain >= 100));
      trims := trims + case when h.gain >= 25 then h.qty * 0.15 * h.px else 0 end + case when h.gain >= 50 then h.qty * 0.20 * h.px else 0 end + case when h.gain >= 100 then h.qty * 0.25 * h.px else 0 end;
    else sdp := null; stop_px := null; maxpos := null; tp := '[]'::jsonb; end if;
    sig := jsonb_build_object('rule', case lvl when 'reassess' then 'Trend or fundamentals weakened: review the reason for holding' when 'trim' then 'Profit ladder step reached: consider trimming'
                                              when 'rebalance' then 'Position is a large share of the account' when 'run' then 'Trend intact: hold and trail the exit' else 'No rule triggered' end,
      'volume', case when r2 > 0.66 then 'Above average' when r2 > 0.33 then 'Normal' else 'Light' end, 'sector_rel_3m', round((r1 - 0.4) * 12, 1),
      'above50', h.gain > -5, 'above200', h.gain > 0, 'upside_pct', case when kind = 'stock' then round(5 + r1 * 18, 1) end,
      'drawdown_pct', case when kind = 'etf' then round(abs(least(h.gain, 0)) + r1 * 6, 1) end, 'trail_breached', false);
    bd := jsonb_build_object('market', greatest(0, least(20, round(sc * 0.2 + (r2 - 0.5) * 4)))::int, 'sector', greatest(0, least(20, round(sc * 0.2 + (r1 - 0.5) * 5)))::int,
      'momentum', greatest(0, least(15, round(sc * 0.15 + (r2 - 0.5) * 3)))::int, 'volume', greatest(0, least(15, round(sc * 0.15 + (r1 - 0.5) * 3)))::int,
      'fundamentals', greatest(0, least(20, round(sc * 0.2 + (r2 - 0.5) * 3)))::int, 'concentration', greatest(0, least(10, round(10 - (wt - 4) * 0.8)))::int);
    nts := to_jsonb(array_remove(array[
      case when kind = 'stock' and h.val > maxpos then 'Position is larger than the 1% risk rule allows' end,
      case when lvl = 'trim' then 'Profit ladder step reached: consider booking part of the gain' end,
      case when lvl = 'reassess' then 'Down more than 15%: re-check why you own it' end], null));
    insert into public.profit_booking (user_id, ticker, display, yahoo_ticker, pie, kind, sector, value_gbp, weight_pct, gain_pct, score, breakdown, action, action_level, trim_plan,
        trailing_stop, stop_distance_pct, max_position_gbp, rel_volume, signals, notes, updated_at)
      values (p_user, h.ticker, h.display, yt, h.pie, kind, sect, round(h.val, 2), round(wt, 2), round(h.gain, 2), sc, bd, act, lvl, tp,
        stop_px, sdp, maxpos, round(0.7 + r1 * 1.1, 2), sig, nts, now());

    -- holding decisions: three weekly reports so the history looks lived-in
    for w in 0..2 loop
      dsc := greatest(20, least(96, sc + w * ((abs(hashtext(h.ticker || 'w' || w)) % 9) - 4)));
      sl := case when dsc >= 65 then 0 when dsc >= 55 then 1 when dsc >= 45 then 2 else 3 end;
      bsig := case when dsc >= 78 and h.gain < 25 then 'BUY: accumulate' when dsc >= 60 and h.gain >= 25 then 'WAIT: extended, let the price settle' when dsc < 40 then 'AVOID: weak trend' else 'HOLD' end;
      ssig := case when sl >= 2 then 'Distribution risk: weakening trend, review the position' end;
      dtxt := case when dsc >= 80 then 'STRONG HOLD' when dsc >= 65 then 'HOLD' when dsc >= 50 then 'HOLD: MONITOR' when dsc >= 35 then 'REVIEW' else 'REDUCE' end;
      insert into public.holding_decisions (user_id, report_date, ticker, display, pie, exchange, score, decision, sell_level, sell_signal, buy_signal, inst_score, price_score, fin_score,
          val_score, sector_score, risk_score, rsi, mom_4w, mom_1w, pct_from_high, above_ma50, vol_ratio, notes, created_at)
        values (p_user, wk - 7 * w, h.ticker, h.display, h.pie, h.exchange, dsc, dtxt, sl, ssig, bsig,
          greatest(0, least(20, round(dsc * 0.20 + (r1 - 0.5) * 3)))::int, greatest(0, least(20, round(dsc * 0.20 + (r2 - 0.5) * 3)))::int, greatest(0, least(25, round(dsc * 0.25 + (r1 - 0.5) * 3)))::int,
          greatest(0, least(15, round(dsc * 0.15 + (r2 - 0.5) * 2)))::int, greatest(0, least(10, round(dsc * 0.10 + (r1 - 0.5) * 2)))::int, greatest(0, least(10, round(dsc * 0.10)))::int,
          round(35 + r1 * 35, 1), round(h.gain / 8 + (r2 - 0.5) * 6, 1), round((r2 - 0.5) * 5, 1), -round(abs(least(h.gain, 0)) + 3 + r1 * 8, 1), h.gain > -5, round(0.7 + r1 * 1.1, 2),
          'Illustrative demo score built from flows, trend, financials, valuation, sector and risk.', (wk - 7 * w)::timestamptz + interval '6 hours');
      n_hd := n_hd + 1;
    end loop;

    -- entry analysis
    vs := least(92, greatest(35, round(sc * 0.9 + (r2 - 0.5) * 14)))::int;
    twact := case when vs >= 75 and h.gain < 20 then 'BUY NOW' when vs >= 65 and h.gain < 35 then 'DCA — ADD' when h.gain >= 30 then 'WAIT FOR DIP' when vs >= 55 then 'ACCUMULATE' else 'HOLD / AVOID' end;
    entry_px := round(h.px * case twact when 'BUY NOW' then 1.0 when 'WAIT FOR DIP' then 0.93 else 0.97 end, 2);
    zones := jsonb_build_array(
      jsonb_build_object('label', 'Entry 1 · £' || round(h.px * 0.98, 2), 'rating', case when vs >= 70 then 'high' else 'medium' end, 'note', 'About 2% below the current price'),
      jsonb_build_object('label', 'Entry 2 · £' || round(h.px * 0.94, 2), 'rating', 'medium', 'note', 'Near the 20-day average'),
      jsonb_build_object('label', 'Entry 3 · £' || round(h.px * 0.88, 2), 'rating', 'low', 'note', 'Deeper pullback zone'));
    card := jsonb_build_array(
      jsonb_build_object('category', 'Trend & momentum', 'score', round(vs * 0.20)::int, 'max', 20), jsonb_build_object('category', 'Valuation', 'score', round(vs * 0.20 + (r1 - 0.5) * 3)::int, 'max', 20),
      jsonb_build_object('category', 'Quality', 'score', round(vs * 0.25)::int, 'max', 25), jsonb_build_object('category', 'Institutional flow', 'score', round(vs * 0.15)::int, 'max', 15),
      jsonb_build_object('category', 'Risk', 'score', round(vs * 0.20 + (r2 - 0.5) * 3)::int, 'max', 20));
    earn := case when kind = 'stock' then jsonb_build_object('period', 'Q3 2026', 'revenue_growth_pct', round(3 + r1 * 22, 1), 'op_profit_growth_pct', round(2 + r2 * 25, 1), 'net_profit_growth_pct', round(1 + r1 * 28, 1)) else '{}'::jsonb end;
    warn := case when h.gain >= 35 then 'Up sharply since purchase: avoid chasing, wait for a pullback' when h.gain <= -15 then 'Down more than 15%: check the reason you own it' end;
    tw := jsonb_build_object('action', twact, 'price', entry_px, 'current', round(h.px, 2), 'avg_cost', round(h.avg, 2), 'rsi', round(32 + r1 * 38, 1), 'ma20', round(h.px * (1 + (r2 - 0.5) * 0.04), 2),
      'ma50', round(h.px * (1 - (r1 - 0.4) * 0.05), 2), 'low_52w', round(h.px * 0.72, 2), 'high_52w', round(h.px * 1.12, 2), 'vol_pct', round(14 + r1 * 40, 0),
      'pe', case when kind = 'stock' then round(12 + r1 * 28, 1) end, 'fwd_pe', case when kind = 'stock' then round(10 + r1 * 24, 1) end, 'vol_ratio', round(0.7 + r2 * 1.0, 2),
      'mom_4w', round((r1 - 0.55) * 24, 1), 'mom_1w', round((r2 - 0.45) * 6, 1), 't212', h.ticker,
      'rationale', jsonb_build_array('Score ' || vs || '/100 from trend, valuation, quality, flows and risk', case when h.gain >= 30 then 'Well above your average cost: prefer a pullback' else 'Close to your average cost: adding is reasonable' end));
    insert into public.value_buy_scores (user_id, ticker, display, pie, currency_symbol, score, score_max, verdict, entry_zones, scorecard, earnings, warning, notes, updated_at, this_week)
      values (p_user, h.ticker, h.display, h.pie, '£', vs, 100, case when vs >= 75 then 'Strong Buy' when vs >= 55 then 'Accumulate' else 'Hold/Wait' end, zones, card, earn, warn,
        'Illustrative demo analysis: invented scores for pre-sales use.', now(), tw);
    n_vb := n_vb + 1;

    -- analyst ratings (shared table; the demo project only)
    stars := least(5, greatest(1, round(sc / 20.0)))::int; recm := case when sc >= 70 then 'strong_buy' when sc >= 50 then 'buy' else 'hold' end;
    lb := case h.ticker when 'AAPL_US_EQ' then 2 when 'MSFT_US_EQ' then 2 when 'GOOGL_US_EQ' then 2 when 'AMZN_US_EQ' then 1 when 'NVDA_US_EQ' then 1 else 0 end;
    lname := case lb when 1 then 'Fast Grower' when 2 then 'Stalwart' else 'Fund / ETF' end;
    lg := case lb when 1 then round(18 + r1 * 14, 1) when 2 then round(8 + r1 * 6, 1) else null end;
    update public.analyst_ratings set yahoo_ticker = yt, pie = h.pie, recommendation = recm, star_rating = stars,
        target_mean = case when kind = 'stock' then round(h.px * (1.05 + r1 * 0.2), 2) end, buy_pct = case when kind = 'stock' then round(55 + sc * 0.3) end,
        hold_pct = case when kind = 'stock' then round(25 - sc * 0.1) end, sell_pct = case when kind = 'stock' then round(100 - round(55 + sc * 0.3) - round(25 - sc * 0.1)) end,
        analyst_count = case when kind = 'stock' then round(18 + r2 * 25)::int end, updated_at = now(), source = case when kind = 'stock' then 'yahoo' else 'trend' end,
        lynch_bucket = lb, lynch_name = lname, lynch_reason = 'Illustrative classification for the demo', lynch_growth = lg, lynch_basis = 'demo', lynch_confidence = 'medium'
      where ticker = h.ticker;
    if not found then
      insert into public.analyst_ratings (ticker, yahoo_ticker, pie, recommendation, star_rating, target_mean, buy_pct, hold_pct, sell_pct, analyst_count, updated_at, source,
          lynch_bucket, lynch_name, lynch_reason, lynch_growth, lynch_basis, lynch_confidence)
        values (h.ticker, yt, h.pie, recm, stars, case when kind = 'stock' then round(h.px * (1.05 + r1 * 0.2), 2) end, case when kind = 'stock' then round(55 + sc * 0.3) end,
          case when kind = 'stock' then round(25 - sc * 0.1) end, case when kind = 'stock' then round(100 - round(55 + sc * 0.3) - round(25 - sc * 0.1)) end,
          case when kind = 'stock' then round(18 + r2 * 25)::int end, now(), case when kind = 'stock' then 'yahoo' else 'trend' end,
          lb, lname, 'Illustrative classification for the demo', lg, 'demo', 'medium');
    end if;
    n_ar := n_ar + 1;
  end loop;

  -- profit booking summary
  select coalesce(sum(value_gbp), 0) into etf_val from public.profit_booking where user_id = p_user and sector = 'Diversified ETF';
  select coalesce(sum(value_gbp), 0) into tech_val from public.profit_booking where user_id = p_user and sector = 'Technology';
  select coalesce(sum(value_gbp), 0) into gold_val from public.profit_booking where user_id = p_user and sector = 'Gold & Precious Metals';
  select coalesce(sum(value_gbp), 0) into cons_val from public.profit_booking where user_id = p_user and sector = 'Consumer Cyclical';
  tech_pct := round((tech_val + 0.25 * etf_val) / total * 100, 1);
  secs := jsonb_build_array(
    jsonb_build_object('sector', 'Technology', 'pct', tech_pct, 'over', tech_pct > 25),
    jsonb_build_object('sector', 'Gold & Precious Metals', 'pct', round(gold_val / total * 100, 1), 'over', gold_val / total * 100 > 25),
    jsonb_build_object('sector', 'Financials', 'pct', round(0.14 * etf_val / total * 100, 1), 'over', false),
    jsonb_build_object('sector', 'Consumer Cyclical', 'pct', round((cons_val + 0.12 * etf_val) / total * 100, 1), 'over', false),
    jsonb_build_object('sector', 'Healthcare', 'pct', round(0.10 * etf_val / total * 100, 1), 'over', false),
    jsonb_build_object('sector', 'Industrials', 'pct', round(0.10 * etf_val / total * 100, 1), 'over', false));
  select jsonb_agg(to_jsonb(q) order by q.gbp desc) into pies from (
    select p.pie, round(sum(p.current_price::numeric * p.quantity::numeric), 0) as gbp, round(sum(p.current_price::numeric * p.quantity::numeric) / total * 100, 1) as pct,
           round((sum(p.current_price::numeric * p.quantity::numeric) - sum(p.avg_price::numeric * p.quantity::numeric)) / nullif(sum(p.avg_price::numeric * p.quantity::numeric), 0) * 100, 1) as gain_pct,
           (select round(avg(b.score)) from public.profit_booking b where b.user_id = p_user and b.pie = p.pie) as avg_score,
           (select coalesce(jsonb_agg(distinct case b.action_level when 'trim' then 'book profit due' when 'rebalance' then 'oversized' when 'reassess' then 'reassess' end)
                    filter (where b.action_level in ('trim', 'rebalance', 'reassess')), '[]'::jsonb) from public.profit_booking b where b.user_id = p_user and b.pie = p.pie) as flags
    from public.positions p where p.user_id = p_user and p.snapshot_id = sid group by p.pie) q;
  reg := jsonb_build_object('mode', 'Neutral', 'points', 3, 'vix', 17.8, 'breadth_pct', 68,
    'spx', jsonb_build_object('above50', true, 'above200', true, 'ret3m', 5.4), 'acwi', jsonb_build_object('above50', true, 'above200', true, 'ret3m', 4.1));
  lim := jsonb_build_object('risk_per_trade_pct', 1, 'risk_per_trade_gbp', risk, 'atr_mult', 3, 'max_sector_pct', 25);
  tot := jsonb_build_object('holdings_gbp', round(total, 0), 'invested_gbp', round(invested, 0), 'suggested_trims_gbp', round(trims, 0),
    'counts', jsonb_build_object('reassess', c_re, 'trim', c_tr, 'rebalance', c_rb, 'run', c_run, 'hold', c_hold));
  notes_pb := to_jsonb(array_remove(array[
    case when tech_pct > 25 then 'Technology is above the 25% sector cap once ETF look-through is counted (' || tech_pct || '%)' end,
    case when c_re > 0 then c_re || ' holding(s) need a re-check of why you own them' end,
    'Demo figures are illustrative and not a recommendation'], null));
  insert into public.profit_booking_summary (user_id, regime, sectors, pies, limits, totals, notes, updated_at) values (p_user, reg, secs, coalesce(pies, '[]'::jsonb), lim, tot, notes_pb, now());

  -- pie priorities: split 100% (of whatever the user decides to invest; no fixed budget) across pies by their average entry score
  select count(*), sum(power(a, 2)) into npies, wsum from (select avg(score) a from public.value_buy_scores where user_id = p_user group by pie) z;
  for pr in select pie, avg(score) a from public.value_buy_scores where user_id = p_user group by pie order by avg(score) desc loop
    i := i + 1;
    amt := case when i = npies then remaining else round(100 * power(pr.a, 2) / wsum / 5) * 5 end;
    remaining := remaining - amt;
    rec := rec || jsonb_build_object('pie', pr.pie, 'share', amt, 'priority', case when i <= 2 then 'HIGH' when i <= 4 then 'MEDIUM' else 'LOW' end,
      'reason', 'Average entry score ' || round(pr.a) || '/100' || case when i <= 2 then ': strongest setups this week' else '' end);
  end loop;
  insert into public.strategy_recommendations (user_id, on_track, annualised_return, recommendations, notes, updated_at, market_mood)
    values (p_user, true, 11.8, rec,
      jsonb_build_array('Pie priorities: each pie''s share (%) of whatever you decide to invest; there is no fixed budget', 'Demo figures are illustrative and not advice'),
      now(), jsonb_build_object('level', 1, 'label', 'Calm', 'vix', 17.8));

  -- institutional flow report (shared table; one per week)
  if not exists (select 1 from public.institutional_flow_reports where report_date = wk) then
    mk := jsonb_build_array(
      jsonb_build_object('region', 'USA', 'label', 'United States', 'score', 68, 'action', 'ADD gradually',
        'breakdown', jsonb_build_object('etf_flows', jsonb_build_object('score', 15, 'max', 20, 'note', 'Steady inflows to broad US funds'), 'net_buying', jsonb_build_object('score', 17, 'max', 25, 'note', 'Institutions net buyers'),
          'trend', jsonb_build_object('score', 18, 'max', 25, 'note', 'Index above its 50 and 200-day averages'), 'breadth', jsonb_build_object('score', 18, 'max', 30, 'note', 'Most sectors participating')),
        'market_data', jsonb_build_object('rsi', 58.4, 'mom_4w', 2.6, 'pct_from_high', -2.1, 'above_ma50', true)),
      jsonb_build_object('region', 'UK', 'label', 'United Kingdom', 'score', 54, 'action', 'HOLD',
        'breakdown', jsonb_build_object('etf_flows', jsonb_build_object('score', 11, 'max', 20, 'note', 'Flows flat'), 'net_buying', jsonb_build_object('score', 13, 'max', 25, 'note', 'Mixed'),
          'trend', jsonb_build_object('score', 14, 'max', 25, 'note', 'Sideways'), 'breadth', jsonb_build_object('score', 16, 'max', 30, 'note', 'Defensives leading')),
        'market_data', jsonb_build_object('rsi', 51.2, 'mom_4w', 0.8, 'pct_from_high', -4.6, 'above_ma50', true)),
      jsonb_build_object('region', 'Europe', 'label', 'Europe', 'score', 61, 'action', 'ADD gradually',
        'breakdown', jsonb_build_object('etf_flows', jsonb_build_object('score', 13, 'max', 20, 'note', 'Modest inflows'), 'net_buying', jsonb_build_object('score', 15, 'max', 25, 'note', 'Slight net buying'),
          'trend', jsonb_build_object('score', 16, 'max', 25, 'note', 'Recovering'), 'breadth', jsonb_build_object('score', 17, 'max', 30, 'note', 'Improving')),
        'market_data', jsonb_build_object('rsi', 55.0, 'mom_4w', 1.7, 'pct_from_high', -3.3, 'above_ma50', true)));
    select jsonb_agg(jsonb_build_object('pie', x.pie, 'region', x.region, 'market_score', x.ms,
             'action', case when x.ms >= 65 then 'ADD gradually: ' || x.region || ' showing positive institutional flows (' || x.ms || '/100)'
                            when x.ms >= 45 then 'HOLD: ' || x.region || ' neutral, wait for a stronger signal (' || x.ms || '/100)'
                            else 'REDUCE or AVOID: ' || x.region || ' weak institutional environment (' || x.ms || '/100)' end) order by x.pie) into pa
      from (select distinct p.pie, case when p.exchange = 'LSE' then 'UK' when p.exchange like 'NASDAQ%' or p.exchange = 'NYSE' then 'USA' else 'Europe' end as region,
                   case when p.exchange = 'LSE' then 54 when p.exchange like 'NASDAQ%' or p.exchange = 'NYSE' then 68 else 61 end as ms
            from public.positions p where p.user_id = p_user and p.snapshot_id = sid) x;
    insert into public.institutional_flow_reports (report_date, markets, sector_rotation, opportunities, cautions, cash_strategy, portfolio_actions, summary, created_at)
      values (wk, mk, jsonb_build_object('all', jsonb_build_array(
          jsonb_build_object('sector', 'Technology', 'ticker', 'XLK', 'signal', 'Inflow', 'mom_4w', 3.1, 'rsi', 61, 'score', 14),
          jsonb_build_object('sector', 'Financials', 'ticker', 'XLF', 'signal', 'Inflow', 'mom_4w', 1.9, 'rsi', 56, 'score', 8),
          jsonb_build_object('sector', 'Healthcare', 'ticker', 'XLV', 'signal', 'Neutral', 'mom_4w', 0.4, 'rsi', 50, 'score', 1),
          jsonb_build_object('sector', 'Energy', 'ticker', 'XLE', 'signal', 'Outflow', 'mom_4w', -2.2, 'rsi', 42, 'score', -9),
          jsonb_build_object('sector', 'Utilities', 'ticker', 'XLU', 'signal', 'Neutral', 'mom_4w', 0.1, 'rsi', 49, 'score', -1))),
        jsonb_build_array(jsonb_build_object('type', 'Sector', 'name', 'Technology', 'score', 78, 'reason', 'Inflows and rising relative strength', 'action', 'Add gradually through the weekly plan'),
                          jsonb_build_object('type', 'Region', 'name', 'Europe', 'score', 61, 'reason', 'Flows improving from a low base', 'action', 'Keep adding in small steps')),
        jsonb_build_array(jsonb_build_object('type', 'Sector', 'name', 'Energy', 'score', 34, 'reason', 'Outflows and weakening trend', 'action', 'Avoid adding; review existing exposure')),
        'Keep about 10% of what you invest in cash while the UK signal is neutral.', coalesce(pa, '[]'::jsonb),
        'Illustrative weekly report for the demo: flows lean positive in the US and Europe, neutral in the UK.', now());
  end if;
  return jsonb_build_object('holdings', n_vb, 'profit_booking', n_vb, 'holding_decisions', n_hd, 'value_buy_scores', n_vb, 'analyst_ratings', n_ar, 'strategy', 1);
end $$;
revoke all on function public.seed_demo_insights(uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_insights(uuid) to service_role;

-- demo_refresh: re-seed the portfolio, then rebuild the analysis on top of it
create or replace function public.demo_refresh() returns jsonb language plpgsql security definer set search_path = '' as $$
declare t uuid; res jsonb; ins jsonb;
begin
  select id into t from auth.users where email = (select value #>> '{}' from public.demo_settings where key = 'template_email');
  if t is null then raise exception 'demo template account is missing'; end if;
  res := public.seed_demo_portfolio(t, 0.42, 1, null);
  ins := public.seed_demo_insights(t);
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', true, 'seeded', res, 'insights', ins))
    on conflict (key) do update set value = excluded.value;
  return res || jsonb_build_object('insights', ins);
exception when others then
  insert into public.demo_settings (key, value) values ('last_refresh', jsonb_build_object('at', now(), 'ok', false, 'error', sqlerrm))
    on conflict (key) do update set value = excluded.value;
  raise;
end $$;

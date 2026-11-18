// Institutional-flow report, zero-knowledge split: the market-wide report is public (shared table, central job in FLOW_PUBLIC_MODE);
// the per-pie portfolio actions are built here from the customer's own encrypted positions. Port of build_portfolio_actions.
(function (root) {
  'use strict';
  const regionOf = ex => { ex = (ex || '').toUpperCase(); return ['NASDAQ/NYSE', 'NYSE', 'NASDAQ'].includes(ex) ? 'USA' : ex === 'LSE' ? 'UK' : ['XETRA', 'AMS', 'EURONEXT'].includes(ex) ? 'Europe' : null; };
  const asJson = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return []; } } return v || []; };
  function portfolioActions(markets, positions) {
    const byTicker = new Map(); for (const p of positions) byTicker.set(p.ticker, p);
    const pieRegions = new Map();
    for (const p of byTicker.values()) {
      const pie = p.pie || 'Individual', region = regionOf(p.exchange === undefined ? '' : p.exchange);
      if (region) { if (!pieRegions.has(pie)) pieRegions.set(pie, new Set()); pieRegions.get(pie).add(region); }
    }
    const actions = [];
    for (const pie of [...pieRegions.keys()].sort()) for (const region of [...pieRegions.get(pie)].sort()) {
      const m = markets.find(x => x.region === region); if (!m) continue;
      const score = m.score, act = score >= 65 ? `ADD gradually — ${region} showing positive institutional flows (${score}/100)` : score >= 45 ? `HOLD — ${region} neutral, wait for stronger signal (${score}/100)` : `REDUCE or AVOID — ${region} weak institutional environment (${score}/100)`;
      actions.push({ pie, region, market_score: score, action: act });
    }
    return actions;
  }
  // call: the app's Supabase fetch helper (signed-in users may read the shared table). Returns the report with jsonb fields parsed, plus this customer's own actions.
  async function latest(call, token, positions) {
    const r = await call('/rest/v1/institutional_flow_reports?select=*&order=report_date.desc&limit=1', {}, token);
    if (!r.ok) throw new Error('read institutional_flow_reports: ' + r.status);
    const row = ((r.d !== undefined ? r.d : await r.json()) || [])[0] || null;
    if (!row) return null;
    const markets = asJson(row.markets);
    return Object.assign({}, row, { markets, sector_rotation: Array.isArray(row.sector_rotation) ? row.sector_rotation : (typeof row.sector_rotation === 'string' ? asJson(row.sector_rotation) : row.sector_rotation),
      opportunities: asJson(row.opportunities), cautions: asJson(row.cautions), portfolio_actions: portfolioActions(markets, positions || []) });
  }
  root.ZKFlow = { portfolioActions, latest, regionOf };
  if (typeof module !== 'undefined') module.exports = root.ZKFlow;
})(typeof window !== 'undefined' ? window : globalThis);

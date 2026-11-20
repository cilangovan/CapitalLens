// Run: node tests/zk_support_levels_test.mjs
// Support Levels card (Strategy, under Entry Analysis): held stocks only, live status vs zone, honest when live data is missing, commentary, summary table, no data becomes HTML.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const SL = require('../docs/js/support.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const L = (symbol, lo, hi, o = {}) => Object.assign({ symbol, name: symbol + ' Inc', level_label: 'Support zone', zone_low: lo, zone_high: hi, approx: false, currency: 'USD', tags: [], snap_price: null, snap_pct_from_high: null, source_name: 'KwickScan.com', as_of: '2026-11-20' }, o);
const levels = [L('META', 550, 560, { tags: [{ t: 'Crucial support zone', tone: 'warn' }], snap_price: 596.22, snap_pct_from_high: -25 }), L('NVDA', 138, 140), L('INTC', 51, 52), L('CRM', 150, 150, { level_label: 'Wait for', tags: [{ t: 'In free fall', tone: 'bad' }] }),
  L('QCOM', 150, 160), L('AMZN', 225, 225, { approx: true }), L('XSS', 10, 11, { name: '<script>alert(1)</script>', source_name: '"><img src=x onerror=1>', tags: [{ t: '<b>x</b>', tone: 'good' }] })];

ok('ticker mapping: T212 US tickers, the old FB ticker, and non-US listings', SL.symOf('NVDA_US_EQ') === 'NVDA' && SL.symOf('FB_US_EQ') === 'META' && SL.symOf('BARCl_EQ') === 'BARCl' && SL.symOf(null) === '');
const st = (lv, p) => SL.status(lv, p).key;
ok('status: below / in / approaching (≤3% above) / above', st(levels[0], 540) === 'below' && st(levels[0], 555) === 'in' && st(levels[0], 570) === 'near' && st(levels[0], 596.22) === 'above');
ok('status: zone edges count as in the zone', st(levels[0], 550) === 'in' && st(levels[0], 560) === 'in');
ok('status: a single-number level uses a 1.5% band (CRM $150)', st(levels[3], 150) === 'in' && st(levels[3], 152) === 'in' && st(levels[3], 183.31) === 'above' && st(levels[3], 140) === 'below');
ok('status: no live price is "nolive", never a guess', st(levels[0], null) === 'nolive' && st(levels[0], undefined) === 'nolive' && st(levels[0], 'x') === 'nolive');
ok('distance is measured from the zone edge', Math.abs(SL.status(levels[0], 596.22).pct - (596.22 / 560 - 1) * 100) < 1e-9 && Math.abs(SL.status(levels[0], 539).pct - (539 / 550 - 1) * 100) < 1e-9);

const held = new Set(['META', 'NVDA', 'CRM', 'XSS', 'INTC']);
const live = { META: { price: 596.22, high52: 796, avgCost: 500, sym: '$' }, NVDA: { price: 139, high52: 200, avgCost: 150, sym: '$' }, CRM: { price: 183.31, high52: 360, sym: '$' }, INTC: { price: 48, sym: '$' } };
const rows = SL.build(levels, held, live);
ok('ONLY held stocks appear (QCOM and AMZN levels exist but are not held)', rows.map(r => r.lv.symbol).sort().join() === 'CRM,INTC,META,NVDA,XSS');
ok('sorted most urgent first: below → in → approaching → above → no live price', rows.map(r => r.lv.symbol).join() === 'INTC,NVDA,CRM,META,XSS');
ok('held stock with no live data is shown as "Live price unavailable"', rows.find(r => r.lv.symbol === 'XSS').st.key === 'nolive');
const mism = SL.build([L('META', 550, 560)], new Set(['META']), { META: { price: 450, sym: '£' } })[0];
ok('currency mismatch: live price is not compared (honest, no fake status)', mism.st.key === 'nolive' && mism.mismatch === true && /different currency/.test(SL.html([mism], 0)));
ok('live drawdown comes from the 52-week high, not the captured figure', Math.abs(rows.find(r => r.lv.symbol === 'META').fromHigh - (596.22 / 796 - 1) * 100) < 1e-9);

const meta = rows.find(r => r.lv.symbol === 'META');
ok('commentary: above-zone text gives the distance and the zone', /above the zone/.test(meta.text[0]) && /\$550–560/.test(meta.text[0]));
ok('commentary: average cost below the zone is called out; tags are quoted as source notes', /average cost.*below the zone/.test(meta.text.join(' ')) && /Source notes: Crucial support zone/.test(meta.text.join(' ')));
ok('commentary: "Wait for" level says it is only a marker until reached', /wait for/.test(rows.find(r => r.lv.symbol === 'CRM').text[0]));
ok('commentary: below the zone names the level to reclaim', /reclaiming the top of the zone/i.test(rows[0].text[0]) && /\$52/.test(rows[0].text[0]));
ok('commentary never uses advice words (buy now / sell now / you should)', !rows.some(r => /buy now|sell now|you should/i.test(r.text.join(' '))));

const h = SL.html(rows, 2);
ok('section has cards, the source with its capture date and a summary table', /Support Levels/.test(h) && /KwickScan\.com/.test(h) && /20 Nov 2026/.test(h) && /<table class="sl-table">/.test(h) && (h.match(/<tr>/g) || []).length === 1 + rows.length);
ok('range formatting: zone, single value, approximate', SL.range(levels[0]) === '$550–560' && SL.range(levels[3]) === '$150' && SL.range(levels[5]) === '~$225');
ok('nothing held with a level on file: says so and does not list the others', /None of the stocks you hold/.test(SL.html([], 3)) && !/QCOM/.test(SL.html([], 3)));
ok('nothing from the data can become HTML (name, source, tags escaped)', !/<script>|<img |<b>x/.test(h) && /&lt;script&gt;/.test(h));

// ── #52 stale levels ──
ok('age in days, and the stale warning appears after 14 days (card pill + sentence), not before', SL.ageDays('2026-11-20', '2026-12-04') === 14 && SL.ageDays('2026-11-20', '2026-12-05') === 15 && SL.ageDays('junk', '2026-12-05') === null);
const fresh = SL.html(rows, 0, '2026-12-04'), stale = SL.html(rows, 0, '2026-12-05');
ok('stale: "Captured 15 days ago" pill and "may have moved" note; fresh at 14 days shows neither', /Captured 15 days ago/.test(stale) && /may have moved/.test(stale) && !/days ago/.test(fresh));
// ── #50 in-house 200-week EMA ──
const week = 7 * 86400, t0 = Date.UTC(2021, 0, 4) / 1000;                                   // a Monday
const series = (n, f, perWeek = 5) => { const out = []; for (let w = 0; w < n; w++) for (let d = 0; d < perWeek; d++) out.push([t0 + w * week + d * 86400, f(w)]); return out; };
const flat = SL.ema200w(series(260, () => 100));
ok('200-week EMA of a flat series is that price, from 260 weekly closes', flat && Math.abs(flat.value - 100) < 1e-9 && flat.weeks === 260);
const rise = SL.ema200w(series(260, w => 100 + w));
ok('on a steadily rising series the EMA lags below the latest close and above the first-200-week average', rise.value < 359 && rise.value > 199.5 + 1);
ok('weekly close = LAST close of the week (daily noise inside a week does not change the EMA)', Math.abs(SL.ema200w(series(210, w => 50).map((p, i) => i % 5 === 4 ? p : [p[0], 999])).value - 50) < 1e-9);
ok('fewer than 200 weekly closes → null (never a guess); junk points ignored', SL.ema200w(series(150, () => 100)) === null && SL.ema200w([[1, 'x'], null, [2, -5]]) === null && SL.ema200w(null) === null);
const cl = SL.computedLevel('NVDA', 'NVIDIA', flat, 'USD', '2026-11-20');
ok('computed level is labelled as computed, with the method, and never reads as an analyst source', cl.source_name === 'CapitalLens (computed)' && cl.computed && /computed/.test(cl.tags[0].t) && /260 weekly closes/.test(cl.note) && cl.zone_low === 100);
const crow = SL.build([cl], new Set(['NVDA']), { NVDA: { price: 101, sym: '$' } })[0], chtml = SL.html([crow], 0, '2030-01-01');
ok('computed card says it is computed, is never marked stale, and the header names no capture date for it', /Computed by CapitalLens, not an analyst view/.test(chtml) && !/days ago/.test(chtml) && !/captured \d/.test(chtml.replace(/Captured \$/, '')) );

// ── type filter: Stocks (default) · ETFs · Commodities · All ──
ok('instrument type from the profit_booking row: no row/stock → stock; ETF → etf; metals/commodity ETF → commodity (by sector or name)',
  SL.typeOf(null) === 'stock' && SL.typeOf({ kind: 'stock', sector: 'Technology' }) === 'stock' && SL.typeOf({ kind: 'etf', sector: 'Diversified ETF' }, 'Vanguard FTSE All-World') === 'etf'
  && SL.typeOf({ kind: 'etf', sector: 'Gold & Precious Metals' }) === 'commodity' && SL.typeOf({ kind: 'etf', sector: 'Precious metals' }) === 'commodity' && SL.typeOf({ kind: 'etf', sector: 'Other' }, 'WisdomTree Copper') === 'commodity');
ok('Trading 212 → Yahoo symbol and quote currency: US USD, LSE pence (GBp), Xetra/Amsterdam EUR, unknown → null',
  JSON.stringify(SL.yahooOf('NVDA_US_EQ')) === '["NVDA","USD"]' && JSON.stringify(SL.yahooOf('FB_US_EQ')) === '["META","USD"]' && JSON.stringify(SL.yahooOf('SGLNl_EQ')) === '["SGLN.L","GBp"]'
  && JSON.stringify(SL.yahooOf('VWCEd_EQ')) === '["VWCE.DE","EUR"]' && JSON.stringify(SL.yahooOf('VUSAa_EQ')) === '["VUSA.AS","EUR"]' && SL.yahooOf('weird') === null && SL.yahooOf(null) === null);
ok('pence listings are shown as 245p, never as a pound figure', SL.money({ currency: 'GBp' }, 245.5) === '245.5p' && SL.range(L('SGLN.L', 54.25, 55.88, { currency: 'GBp' })) === '54.25–55.88p' && SL.money({ currency: 'USD' }, 12) === '$12');
const mix = [L('NVDA', 138, 140), L('SGLN.L', 54, 56, { currency: 'GBp' }), L('VWCE.DE', 109, 112, { currency: 'EUR' })];
const types = { NVDA: 'stock', 'SGLN.L': 'commodity', 'VWCE.DE': 'etf' }, lv2 = { NVDA: { price: 139, sym: '$' }, 'SGLN.L': { price: 55, sym: '' }, 'VWCE.DE': { price: 120, sym: '€' } };
const mrows = SL.build(mix, new Set(Object.keys(types)), lv2, types);
ok('rows carry their type, and the filter keeps only that type (ALL keeps everything)', mrows.find(r => r.lv.symbol === 'SGLN.L').type === 'commodity' && SL.filterRows(mrows, 'etf').map(r => r.lv.symbol).join() === 'VWCE.DE'
  && SL.filterRows(mrows, 'stock').length === 1 && SL.filterRows(mrows, 'ALL').length === 3);
const ui = f => ({ filter: f, counts: { ALL: 3, stock: 1, etf: 1, commodity: 1 } });
const fh = SL.html(mrows, 0, '2026-11-20', ui('commodity'));
ok('filter chips: All · Stocks · ETFs · Commodities with held counts, active one marked, via data attributes (no inline handlers)',
  /data-sl-type="ALL"/.test(fh) && /data-sl-type="stock"/.test(fh) && /data-sl-type="etf"/.test(fh) && /data-sl-type="commodity"/.test(fh) && /sl-chip active" data-sl-type="commodity"/.test(fh) && !/onclick=/.test(fh));
ok('commodity view lists only the commodity fund, in pence; the other types are not shown', /SGLN\.L/.test(fh) && /54–56p/.test(fh) && !/NVDA/.test(fh) && !/VWCE/.test(fh));
ok('empty type says so in words and keeps the chips; busy shows the loading spinner and the chips', /None of the etfs you hold has a support level yet/.test(SL.html([], 0, '2026-11-20', { ...ui('etf'), failed: 2 })) && /2 had no level/.test(SL.html([], 0, '2026-11-20', { ...ui('etf'), failed: 2 }))
  && /loading busy/.test(SL.html([], 0, '2026-11-20', { ...ui('etf'), busy: true })) && /data-sl-type="etf"/.test(SL.html([], 0, '2026-11-20', { ...ui('etf'), busy: true })));
ok('without a filter state the section renders exactly as before (no chips)', !/data-sl-type/.test(SL.html(mrows, 0, '2026-11-20')));

// ── end to end: default Stocks only, ETFs/Commodities fetched lazily when picked ──
const calls = []; let box = { html: '' };
const wk = (n, f) => { const out = []; for (let w = 0; w < n; w++) for (let d = 0; d < 5; d++) out.push([t0 + w * week + d * 86400, f(w)]); return out; };
Object.assign(globalThis, { IS_GUEST: false, PROXY: 'https://x.test', SESSION_TOKEN: 't', document: { getElementById: id => id === 'support-levels-content' ? { set innerHTML(v) { box.html = v; }, get innerHTML() { return box.html; } } : null, addEventListener() {} },
  api: async (route) => ({ portfolio_snapshots: [{ id: 1 }], positions: [{ ticker: 'NVDA_US_EQ', display: 'NVIDIA' }, { ticker: 'SGLNl_EQ', display: 'Gold ETC' }, { ticker: 'VWCEd_EQ', display: 'FTSE All-World' }, { ticker: 'SHORTl_EQ', display: 'New fund' }],
    support_levels: [lvl0()], profit_booking: [{ ticker: 'SGLNl_EQ', kind: 'etf', sector: 'Precious metals' }, { ticker: 'VWCEd_EQ', kind: 'etf', sector: 'Diversified ETF' }, { ticker: 'NVDA_US_EQ', kind: 'stock', sector: 'Technology' }, { ticker: 'SHORTl_EQ', kind: 'etf', sector: 'Diversified ETF' }] }[route.split('?')[0]] || [] ),
  fetch: async (url, init) => { const b = JSON.parse(init.body); calls.push(b.symbol); const meta = { currency: b.symbol === 'SGLN.L' ? 'GBp' : 'EUR' };
    return { ok: true, json: async () => ({ points: b.symbol === 'SHORT.L' ? wk(50, () => 100) : wk(260, () => b.symbol === 'SGLN.L' ? 2500 : 120), meta }) }; } });
function lvl0() { return L('NVDA', 138, 140); }
await globalThis.loadSupportLevels([{ ticker: 'NVDA_US_EQ', display: 'NVIDIA', currency_symbol: '$', this_week: { current: 139, high_52w: 200, avg_cost: 120 } }]);
ok('default view is Stocks only: NVDA shown from its table level, and NO price history is fetched for ETFs or commodities', /NVDA/.test(box.html) && !/SGLN/.test(box.html) && calls.length === 0 && /sl-chip active" data-sl-type="stock"/.test(box.html));
ok('chips show how many of each type you hold (1 stock, 2 ETFs, 1 commodity)', /data-sl-type="etf">ETFs <span>2<\/span>/.test(box.html) && /data-sl-type="commodity">Commodities <span>1<\/span>/.test(box.html) && /data-sl-type="stock">Stocks <span>1<\/span>/.test(box.html));
await SL._pick('commodity');
ok('picking Commodities fetches only the commodity fund and shows a computed 200-week EMA in pence, labelled computed', calls.join() === 'SGLN.L' && /SGLN\.L/.test(box.html) && /2,?500p/.test(box.html) && /CapitalLens \(computed\)/.test(box.html) && !/NVDA/.test(box.html));
await SL._pick('etf'); if (process.env.DBG) console.log(calls, box.html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' '));
ok('picking ETFs fetches the ETFs once; a fund with under 200 weeks of history says so instead of showing a level', calls.sort().join() === 'SGLN.L,SHORT.L,VWCE.DE' && /VWCE\.DE/.test(box.html) && !/SHORT\.L/.test(box.html.replace(/had no level/, '')) && /1 had no computable level/.test(box.html) && /€120/.test(box.html));
const before = calls.length; await SL._pick('commodity'); await SL._pick('etf'); await SL._pick('ALL');
ok('switching back is instant: nothing is fetched twice; All shows every type together', calls.length === before && /NVDA/.test(box.html) && /SGLN\.L/.test(box.html) && /VWCE\.DE/.test(box.html));
ok('an unknown filter value is ignored', (await SL._pick('<img>'), SL._state.filter === 'ALL'));

const strat = readFileSync(new URL('../docs/js/strategy.js', import.meta.url), 'utf8');
ok('regression guard: the section is placed directly under Entry Analysis and before the weekly allocation', strat.indexOf("vbHtml + '<div id=\"support-levels-content\">") > 0 && /support-levels-content[^;]*\+ stratHtml/.test(strat) && /loadSupportLevels\(vbRows\)/.test(strat));
for (const f of ['docs/index.html', 'docs/demo/index.html']) { const t = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); ok(`${f} loads support.js after strategy.js`, t.indexOf('support.js') > t.indexOf('strategy.js') && t.indexOf('strategy.js') > 0); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

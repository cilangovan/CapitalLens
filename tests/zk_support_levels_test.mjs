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

const strat = readFileSync(new URL('../docs/js/strategy.js', import.meta.url), 'utf8');
ok('regression guard: the section is placed directly under Entry Analysis and before the weekly allocation', strat.indexOf("vbHtml + '<div id=\"support-levels-content\">") > 0 && /support-levels-content[^;]*\+ stratHtml/.test(strat) && /loadSupportLevels\(vbRows\)/.test(strat));
for (const f of ['docs/index.html', 'docs/demo/index.html']) { const t = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); ok(`${f} loads support.js after strategy.js`, t.indexOf('support.js') > t.indexOf('strategy.js') && t.indexOf('strategy.js') > 0); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

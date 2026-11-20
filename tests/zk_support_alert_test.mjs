// Run: node tests/zk_support_alert_test.mjs
// Support-zone alerts (issue #51): raised on TRANSITIONS only (reached the zone, broke below it), evaluated on Refresh; honest about currency; no change when no levels are supplied.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../docs/zk/alertfmt.js'); require('../docs/js/support.js'); const M = require('../docs/zk/monitor.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const lvl = { symbol: 'NVDA', name: 'NVIDIA', level_label: 'Support zone', zone_low: 138, zone_high: 140, currency: 'USD', source_name: 'KwickScan.com', as_of: '2026-11-20', tags: [] };
const meta = { NVDA_US_EQ: { ccy: 'USD', name: 'NVIDIA' } };
const day = n => new Date(Date.UTC(2026, 10, 20 + n, 9, 0));
const state = () => ({ highs: { NVDA_US_EQ: 200 }, last_alerts: {}, held_meta: meta });
const pos = px => [{ ticker: 'NVDA_US_EQ', averagePrice: 120, currentPrice: px, ppl: 1, quantity: 2 }];
const run = (st, px, n, levels = [lvl]) => M.analyse(pos(px), {}, st, day(n), { levels }).alerts.filter(a => a.type === 'support');

let st = state();
ok('first sight of a stock only records its status (no flood of alerts for stocks already below/in the zone)', run(st, 120, 0).length === 0 && st.support_status.NVDA === 'below');
st = state(); run(st, 160, 0);
ok('above → above: nothing', run(st, 158, 1).length === 0);
const r = run(st, 139, 2);
ok('above → in the zone: one "reached its support zone" alert, default priority', r.length === 1 && /in its support zone \$138–140/.test(r[0].title) && r[0].priority === 'default' && r[0].ticker === 'NVDA');
ok('alert is a review report: live price, zone, average cost, source + capture date, review flag, "not our calculation"', /Live USD price/.test(r[0].body) && /\$138–140/.test(r[0].body) && /Your average cost/.test(r[0].body) && /KwickScan\.com/.test(r[0].body) && /20 Nov 2026/.test(r[0].body) && /Review flag/.test(r[0].body) && /not our calculation/.test(r[0].body));
ok('in → in: no repeat', run(st, 139.5, 3).length === 0);
const b = run(st, 130, 4);
ok('in → below: "below its support zone" alert, HIGH priority, distance shown', b.length === 1 && /below its support zone/.test(b[0].title) && b[0].priority === 'high' && /Below the zone by/.test(b[0].body));
ok('below → below: no repeat; below → in (reclaim): no alert, status recorded', run(st, 129, 5).length === 0 && run(st, 139, 6).length === 0 && st.support_status.NVDA === 'in');
st = state(); run(st, 160, 0); const g = run(st, 100, 1);
ok('above → below in one step raises exactly one break alert', g.length === 1 && /below its support zone/.test(g[0].title));
st = state(); run(st, 141.5, 0); // near
ok('near → in counts as reaching the zone', run(st, 139, 1).length === 1);
st = state(); run(st, 160, 0);
ok('cooldown: the same alert is not repeated within 24h even if the status flips back and forth', (run(st, 139, 1).length === 1) && (run(st, 160, 1).length === 0) && (run(st, 139, 1).length === 0));
const st2 = { highs: { NVDA_US_EQ: 200 }, last_alerts: {}, held_meta: { NVDA_US_EQ: { ccy: 'GBP' } } };
ok('currency mismatch (GBP quote vs USD zone): no comparison, no alert, no status recorded', run(st2, 100, 0).length === 0 && run(st2, 139, 1).length === 0 && !(st2.support_status || {}).NVDA);
const st3 = { highs: { NVDA_US_EQ: 200 }, last_alerts: {}, held_meta: {} };
ok('quote currency unknown: no comparison (no fake alert)', run(st3, 139, 0).length === 0);
const st4 = state(), st5 = state();
const plain = M.analyse(pos(139), {}, st4, day(0)), withNone = M.analyse(pos(139), {}, st5, day(0), { levels: [] });
ok('no levels supplied: output identical to before (Python parity untouched), no support_status written', JSON.stringify(plain.alerts) === JSON.stringify(withNone.alerts) && !st4.support_status && !st5.support_status);
ok('a stock with no level on file is ignored', run(state(), 139, 0, [{ ...lvl, symbol: 'META' }]).length === 0);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

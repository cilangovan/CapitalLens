// Run: node tests/zk_invest_line_test.mjs — the "Investments value over time" line must not turn a ~1% wobble into a cliff.
// Regression (20 Nov 2026 screenshot): the axis was min..max of the data (a £45 range on £4,800 filled the whole chart),
// overnight gaps were drawn as one steep solid slope, and a £38 buy looked like market performance.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const src = readFileSync(new URL('../docs/js/overview.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// ── INVESTMENTS VALUE LINE'), src.indexOf('// ── LONGER SPANS FROM REBUILT HISTORY'));
const ctx = { esc: s => String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])) };
vm.createContext(ctx); vm.runInContext(body + ';this.ovLinePoints=ovLinePoints;this.ovLineLayout=ovLineLayout;this.ovLineSvg=ovLineSvg;this.OV_LN=OV_LN;', ctx);
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const snap = (iso, inv, ppl) => ({ created_at: iso, raw: { account: { invested: inv, ppl } } });
// real snapshots (Trading 212 account figures) around the drop in the screenshot: an overnight gap, a US-open fall, then a £38.16 buy
const S = [snap('2026-11-19T02:55:35Z', 4758.67, 9.71), snap('2026-11-19T04:03:00Z', 4758.67, 11.74), snap('2026-11-19T16:15:37Z', 4758.67, -12.8), snap('2026-11-19T17:14:12Z', 4758.67, -22.13),
  snap('2026-11-19T18:46:59Z', 4758.67, -21.98), snap('2026-11-19T19:44:43Z', 4758.67, -22.9), snap('2026-11-19T21:06:16Z', 4796.83, -30.37), snap('2026-11-20T01:05:34Z', 4796.83, -33.51), snap('2026-11-20T03:55:29Z', 4796.83, -33.42)];
const now = Date.parse('2026-11-20T04:00:00Z'), L = ctx.ovLinePoints(S, 7, now), lay = ctx.ovLineLayout(L.points);
ok('points carry the cost basis so buys can be marked', L.points.every(p => Number.isFinite(p.inv)) && L.points[0].inv === 4758.67);
ok('change splits into cost basis (+£38.16 buy) and unrealised result', Math.abs(L.flow - 38.16) < 1e-9 && Math.abs((L.change - L.flow) - (-33.42 - 9.71)) < 1e-9);
const amp = (Math.max(...L.points.map(p => p.v)) - Math.min(...L.points.map(p => p.v)));
ok('axis is never tighter than 2% of the value (a ~£' + amp.toFixed(0) + ' move stays under 60% of the chart height)', (lay.hi - lay.lo) >= 0.02 * 4770 && amp / (lay.hi - lay.lo) < 0.6);
ok('the 12-hour overnight gap is a gap, not a solid segment', lay.gaps.length === 1 && lay.gaps[0][0] === 1 && lay.segs.length === 2);
ok('no solid polyline spans the gap (dashed connector instead)', (() => { const svg = ctx.ovLineSvg(L.points, lay); return /stroke-dasharray="3 4"/.test(svg) && (svg.match(/<polyline/g) || []).length === 2; })());
ok('the £38.16 buy is marked once, as a buy (cost basis up)', lay.marks.length === 1 && lay.marks[0].i === 6 && Math.abs(lay.marks[0].d - 38.16) < 1e-9);
ok('a sell is marked too (cost basis down)', ctx.ovLineLayout([{ t: 0, v: 100, inv: 100 }, { t: 6e4, v: 80, inv: 80 }]).marks[0].d === -20);
ok('FX-sized cost basis noise (under £5) is not a buy', ctx.ovLineLayout([{ t: 0, v: 100, inv: 100 }, { t: 6e4, v: 101, inv: 102 }]).marks.length === 0);
ok('axis shows labelled min / mid / max in pounds and the start and end time', (() => { const svg = ctx.ovLineSvg(L.points, lay); return (svg.match(/>£[\d,]+</g) || []).length === 3 && /<text[^>]*>\d\d:\d\d<\/text>|<text[^>]*>\d+ \w{3}<\/text>/.test(svg); })());
ok('markers and dots are drawn for each snapshot, latest point larger', (() => { const svg = ctx.ovLineSvg(L.points, lay); return (svg.match(/<circle cx/g) || []).length === L.points.length && /<polygon/.test(svg) && /r="3.5"/.test(svg); })());
ok('crosshair and pick dot exist for the tap read-out', /id="ov-ln-cross"/.test(ctx.ovLineSvg(L.points, lay)) && /id="ov-ln-pick"/.test(ctx.ovLineSvg(L.points, lay)));
ok('every plotted coordinate stays inside the viewBox (no line outside the card)', (() => { const nums = [...ctx.ovLineSvg(L.points, lay).matchAll(/<polyline[^>]*points="([^"]+)"/g)].flatMap(m => m[1].split(' ').map(s => s.split(',').map(Number))); return nums.length > 0 && nums.every(([x, y]) => x >= 0 && x <= 340 && y >= 0 && y <= 150); })());
ok('a flat line (all equal) still draws without NaN', !/NaN/.test(ctx.ovLineSvg([{ t: 0, v: 100 }, { t: 1e6, v: 100 }, { t: 2e6, v: 100 }])));
ok('long spans (rebuilt daily points, no cost basis) have no markers and no false gaps over weekends', (() => { const D = 864e5, pts = Array.from({ length: 120 }, (_, i) => ({ t: i * D + (Math.floor(i / 5) * 2 * D), v: 4000 + i })); const l = ctx.ovLineLayout(pts); return l.marks.length === 0 && l.gaps.length === 0; })());
ok('fewer than two points: nothing is drawn', ctx.ovLineSvg([{ t: 1, v: 1 }]) === '' && ctx.ovLineLayout([]) === null);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

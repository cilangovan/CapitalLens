// Run: node tests/zk_overview_stale_test.mjs — the Overview must never present an old snapshot as live.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const src = readFileSync(new URL('../docs/js/overview.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// "5 min ago"'), src.indexOf('async function loadOverview'));
let banner = null; const parent = { insertBefore: (el) => { banner = el; el.remove = () => { banner = null; }; } };
const strip = { parentNode: parent };
const doc = { getElementById: id => id === 'stats-strip' ? strip : id === 'stale-banner' ? banner : null, createElement: () => ({ style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } }) };
const ctx = { document: doc, zkToolsOpen: undefined }; vm.createContext(ctx); vm.runInContext(body + ';this.ovAgo=ovAgo;this.ovHeadline=ovHeadline;this.ovStaleBanner=ovStaleBanner;', ctx);
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
ok('relative age wording', ctx.ovAgo(20e3) === 'just now' && ctx.ovAgo(300e3) === '5 min ago' && ctx.ovAgo(3 * 3600e3) === '3 h ago' && ctx.ovAgo(60 * 3600e3) === '3 days ago');
ctx.ovStaleBanner(5 * 60e3, 't'); ok('fresh snapshot: no banner', banner === null);
ctx.ovStaleBanner(11 * 3600e3, 't'); ok('11h old: no banner', banner === null);
ctx.ovStaleBanner(null, 't'); ok('no snapshot time: no banner', banner === null);
ctx.ovStaleBanner(18 * 3600e3, '04:05'); ok('18h old: warning banner naming the time', banner && /not live/.test(banner.innerHTML) && /04:05/.test(banner.innerHTML));
ok('old app (no zkToolsOpen): no Refresh button', !/<button/.test(banner.innerHTML));
ctx.zkToolsOpen = () => {}; ctx.ovStaleBanner(18 * 3600e3, '04:05'); ok('private app: Refresh button opens Settings', /<button onclick="zkToolsOpen\(\)"/.test(banner.innerHTML));
ctx.ovStaleBanner(2 * 60e3, 't'); ok('banner disappears after a fresh load', banner === null);
// headline numbers follow Trading 212's own definitions (regression: Overview showed total − free cash as "Invested" and a P&L % on the wrong base)
const H = ctx.ovHeadline({ total_value: 9214.07, cash: 4343.84, invested: 4870.23, total_ppl: -10.82, raw: { account: { invested: 4758.85, ppl: -21.95, total: 9214.07, free: 4343.84 } } });
ok('Investments = cost basis + unrealised result (T212: £4,736.90)', Math.abs(H.investments - 4736.90) < 0.005 && H.exact);
ok('Cost basis and unrealised result come from the account figures (T212: £4,758.85, −£21.95)', H.cost === 4758.85 && H.result === -21.95);
ok('Unrealised % is on cost basis (T212: −0.46%), not on total − free cash', Math.abs(H.pct - (-0.46)) < 0.005);
ok('Total and free cash are kept separate from Investments', H.total === 9214.07 && H.cash === 4343.84);
const O = ctx.ovHeadline({ total_value: 100, cash: 20, invested: 80, total_ppl: 5 });
ok('old snapshot without account figures: falls back, flagged as not exact', !O.exact && O.cost === null && O.investments === 80 && O.result === 5 && Math.abs(O.pct - 6.25) < 1e-9);
ok('empty snapshot does not throw', ctx.ovHeadline(undefined).total === 0);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

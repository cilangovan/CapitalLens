// Run: node tests/zk_overview_stale_test.mjs — the Overview must never present an old snapshot as live.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const src = readFileSync(new URL('../docs/js/overview.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// "5 min ago"'), src.indexOf('async function loadOverview'));
let banner = null; const parent = { insertBefore: (el) => { banner = el; el.remove = () => { banner = null; }; } };
const strip = { parentNode: parent };
const doc = { getElementById: id => id === 'stats-strip' ? strip : id === 'stale-banner' ? banner : null, createElement: () => ({ style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } }) };
const ctx = { document: doc, zkToolsOpen: undefined }; vm.createContext(ctx); vm.runInContext(body + ';this.ovAgo=ovAgo;this.ovStaleBanner=ovStaleBanner;', ctx);
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
ok('relative age wording', ctx.ovAgo(20e3) === 'just now' && ctx.ovAgo(300e3) === '5 min ago' && ctx.ovAgo(3 * 3600e3) === '3 h ago' && ctx.ovAgo(60 * 3600e3) === '3 days ago');
ctx.ovStaleBanner(5 * 60e3, 't'); ok('fresh snapshot: no banner', banner === null);
ctx.ovStaleBanner(11 * 3600e3, 't'); ok('11h old: no banner', banner === null);
ctx.ovStaleBanner(null, 't'); ok('no snapshot time: no banner', banner === null);
ctx.ovStaleBanner(18 * 3600e3, '04:05'); ok('18h old: warning banner naming the time', banner && /not live/.test(banner.innerHTML) && /04:05/.test(banner.innerHTML));
ok('old app (no zkToolsOpen): no Refresh button', !/<button/.test(banner.innerHTML));
ctx.zkToolsOpen = () => {}; ctx.ovStaleBanner(18 * 3600e3, '04:05'); ok('private app: Refresh button opens Settings', /<button onclick="zkToolsOpen\(\)"/.test(banner.innerHTML));
ctx.ovStaleBanner(2 * 60e3, 't'); ok('banner disappears after a fresh load', banner === null);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// Run: node tests/zk_ipo_test.mjs
// IPO Watch card: markets, phases from dates, sorting, rating + source, date/price formatting, and that no data can become HTML.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const IPO = require('../docs/js/ipo.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const T = '2026-11-19';
const rows = [
  { id: 'US:A', market: 'US', exchange: 'Nasdaq', name: 'Alpha', ticker: 'ALP', status: 'upcoming', start_date: '2026-11-17', end_date: '2026-11-21', listing_date: '2026-11-24', currency: 'USD', price_low: 10, price_high: 12, deal_size_usd: 250e6, rating: 'Subscribe', rating_source: 'Broker X' },
  { id: 'US:B', market: 'US', exchange: 'NYSE', name: 'Beta', status: 'upcoming', start_date: '2026-12-01', end_date: '2026-12-04', currency: 'USD', price_low: 28, price_high: 32, deal_size_usd: 61.05e9, rating: 'Not rated' },
  { id: 'US:C', market: 'US', exchange: 'Nasdaq', name: 'Gamma', status: 'upcoming', start_date: '2026-11-10', end_date: '2026-11-18', listing_date: '2026-11-19' },
  { id: 'UK:D', market: 'UK', exchange: 'LSE', name: 'Delta', status: 'listed', end_date: '2026-10-13', listing_date: '2026-10-14', currency: 'GBP', price_low: 1.96, price_high: 1.96, rating: 'Avoid', rating_source: 'Analyst Y' },
  { id: 'IN:E', market: 'IN', exchange: 'NSE SME', name: 'Epsilon', status: 'listed', listing_date: '2026-11-09', currency: 'INR', price_low: 94, price_high: 94 },
  { id: 'HK:F', market: 'HK', exchange: 'HKEX', name: 'Phi', status: 'rumoured' },
  { id: 'JP:G', market: 'JP', exchange: 'TSE', name: 'Gee', status: 'postponed', start_date: '2027-01-05' },
  { id: 'US:X', market: 'US', exchange: '<img src=x onerror=alert(1)>', name: '<script>alert(1)</script>', status: 'filed', rating: 'Neutral', rating_source: '"><b>x</b>', note: '<b>n</b>', source_url: 'javascript:alert(1)', source_name: 'Src' },
];
ok('phase: inside the window is open', IPO.phaseOf(rows[0], T) === 'open');
ok('phase: window over, not yet listed → closed (awaiting listing)', IPO.phaseOf(rows[2], T) === 'closed');
ok('phase: future window stays upcoming; stored listed/postponed kept', IPO.phaseOf(rows[1], T) === 'upcoming' && IPO.phaseOf(rows[3], T) === 'listed' && IPO.phaseOf(rows[6], T) === 'postponed');
const all = IPO.select(rows, 'ALL', T).map(r => r.id);
ok('sorted: open, closed, upcoming, filed, rumoured, listed (newest first), postponed', all.join() === 'US:A,US:C,US:B,US:X,HK:F,IN:E,UK:D,JP:G');
ok('market filter: US / UK / India / HK; everything else under Other', IPO.select(rows, 'US', T).length === 4 && IPO.select(rows, 'UK', T).length === 1 && IPO.select(rows, 'IN', T).length === 1 && IPO.select(rows, 'HK', T).length === 1 && IPO.select(rows, 'OTHER', T).map(r => r.id).join() === 'JP:G');
ok('dates: day + month, year only when not this year, TBC when missing', IPO.fmtDate('2026-11-05', T) === '5 Nov' && IPO.fmtDate('2027-01-05', T) === '5 Jan 2027' && IPO.fmtDate(null, T) === 'TBC');
ok('price: range, fixed, TBC, currency symbols', IPO.fmtPrice(70, 78, 'USD') === '$70–78' && IPO.fmtPrice(1.96, 1.96, 'GBP') === '£1.96 fixed' && IPO.fmtPrice(null, null, 'USD') === 'Price TBC' && IPO.fmtPrice(94, 94, 'INR') === '₹94 fixed');
ok('size: bn / m / none', IPO.fmtSize(61.05e9) === '$61bn' && IPO.fmtSize(64.4e9) === '$64.4bn' && IPO.fmtSize(703e6) === '$703m' && IPO.fmtSize(null) === null);
const h = IPO.html(rows, 'ALL', T);
ok('shows opens / closes / lists, exchange, rating with its source', /Opens/.test(h) && /Closes/.test(h) && /Lists/.test(h) && /Nasdaq/.test(h) && /★ Subscribe/.test(h) && /Rating source: Broker X/.test(h) && /No rating source yet/.test(h) && /★ Avoid/.test(h));
ok('market tabs with counts, All active', /data-ipo-mkt="ALL"/.test(h) && /w-cat active[^>]*data-ipo-mkt="ALL"/.test(h) && /data-ipo-mkt="HK"/.test(h));
ok('active tab follows the market', /w-cat active[^>]*data-ipo-mkt="UK"/.test(IPO.html(rows, 'UK', T)));
ok('empty market shows a message', /No IPOs tracked/.test(IPO.html([], 'HK', T)));
ok('XSS: injected tags, attributes and javascript: link stay inert text', !/<script|<img|<b>n<\/b>|"><b>x/.test(h) && !/href="javascript:/.test(h) && /&lt;script&gt;/.test(h) && /&lt;b&gt;n&lt;\/b&gt;/.test(h));
ok('no inline event handlers (strict CSP)', !/\son(click|change|input)=/.test(h));
// watch / remove
const watched = new Set(['US:A']);
const hw = IPO.html(rows, 'ALL', T, watched);
ok('watch: ⭐ Watching tab appears only when watching is available, with its count', /data-ipo-mkt="WATCH"[^>]*>⭐ Watching <span class="a-count">1<\/span>/.test(hw) && !/data-ipo-mkt="WATCH"/.test(IPO.html(rows, 'ALL', T)));
ok('watch: watched IPO shows a remove button, others a Watch button; none when unavailable', /data-ipo-watch="US:A"[^>]*aria-pressed="true">★ Watching · tap to remove/.test(hw) && /data-ipo-watch="US:B"[^>]*aria-pressed="false">☆ Watch/.test(hw) && !/data-ipo-watch/.test(IPO.html(rows, 'ALL', T)));
ok('watch: the Watching tab lists only watched IPOs; empty state explains how', IPO.select(rows, 'WATCH', T, watched).map(r => r.id).join() === 'US:A' && /Nothing watched yet/.test(IPO.html(rows, 'WATCH', T, new Set())));
ok('watch: a watched IPO has a ✕ remove button, an unwatched one does not, and none appear when watching is unavailable', /class="w-x ipo-x" data-ipo-watch="US:A"/.test(hw) && !/ipo-x" data-ipo-watch="US:B"/.test(hw) && !/ipo-x/.test(IPO.html(rows, 'ALL', T)));
ok('watch: an id that is not a calendar id never gets a button (XSS-safe attribute)', !/data-ipo-watch="[^"]*(<|>|\s)/.test(IPO.html([{ id: 'x" onclick="1', market: 'US', name: 'Bad', status: 'upcoming' }], 'ALL', T, new Set())));
const sent = []; globalThis.PROXY = 'https://p/rest/v1'; let nextOk = true;
globalThis.fetch = async (u, o) => { sent.push([u, JSON.parse(o.body)]); return { ok: nextOk, status: nextOk ? 200 : 500 }; };
const St = IPO._state; St.watched = new Set(['US:A']);
await IPO.toggleWatch('US:B');
ok('toggle: watching saves via POST ipo/watch and shows at once', St.watched.has('US:B') && sent[0][0].endsWith('/ipo/watch') && sent[0][1].id === 'US:B');
await IPO.toggleWatch('US:A');
ok('toggle: removing posts ipo/unwatch and drops it from the list', !St.watched.has('US:A') && sent[1][0].endsWith('/ipo/unwatch') && sent[1][1].id === 'US:A');
nextOk = false; await IPO.toggleWatch('US:A');
ok('toggle: a failed save is undone and says so', !St.watched.has('US:A') && /Could not save/.test(St.msg));
await IPO.toggleWatch('US:B');
ok('toggle: a failed remove is undone too', St.watched.has('US:B') && /Could not remove/.test(St.msg));
const n = sent.length; await IPO.toggleWatch('not an id'); St.watched = null; await IPO.toggleWatch('US:A');
ok('toggle: bad ids and "watch not available" send nothing', sent.length === n);
const cfg = JSON.parse(readFileSync(new URL('../config/ipo_calendar.json', import.meta.url)));
ok('seed file: unique ids, valid markets/ratings, ratings named by source', new Set(cfg.ipos.map(r => r.id)).size === cfg.ipos.length && cfg.ipos.every(r => ['US', 'UK', 'IN', 'HK', 'EU', 'JP', 'CN', 'SG', 'AU', 'OTHER'].includes(r.market) && (r.rating === 'Not rated' || r.rating_source)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

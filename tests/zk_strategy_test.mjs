// Run: node tests/zk_strategy_test.mjs
// Browser allocator must equal services/strategy_service.py across market moods, dates and pace situations.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); const ST = require('../docs/zk/strategy.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const walk = (n, p0, p1, noise = 0.01) => Array.from({ length: n }, (_, i) => +(p0 + (p1 - p0) * i / (n - 1) + (rnd() - 0.5) * noise * p0).toFixed(4));
const PIES = ['Magnificent 7', 'Wider ETF', 'Global ETF', 'Semiconductor', 'Defence', 'Weak Pie', 'Brand New'];
const rows = [
  ...['AAPL', 'MSFT', 'NVDA'].map(t => ({ ticker: t + '_US_EQ', yahoo_ticker: t, pie: 'Magnificent 7', star_rating: 4, buy_pct: 80 })),
  { ticker: 'VUSAa_EQ', yahoo_ticker: 'VUSA.AS', pie: 'Wider ETF', star_rating: 5, buy_pct: 90 }, { ticker: 'VWCEd_EQ', yahoo_ticker: 'VWCE.DE', pie: 'Wider ETF', star_rating: 4, buy_pct: 85 },
  { ticker: 'ACWIl_EQ', yahoo_ticker: 'ACWI.L', pie: 'Global ETF', star_rating: 3, buy_pct: 60 },
  { ticker: 'AMD_US_EQ', yahoo_ticker: 'AMD', pie: 'Semiconductor', star_rating: 4, buy_pct: 70 }, { ticker: 'TSM_US_EQ', yahoo_ticker: 'TSM', pie: 'Semiconductor', star_rating: 5, buy_pct: 88 },
  { ticker: 'BAE_US_EQ', yahoo_ticker: 'BAES', pie: 'Defence', star_rating: 3, buy_pct: 55 },
  { ticker: 'BAD_US_EQ', yahoo_ticker: 'BAD', pie: 'Weak Pie', star_rating: 2, buy_pct: 20 }, { ticker: 'WORSE_US_EQ', yahoo_ticker: 'WORSE', pie: 'Weak Pie', star_rating: 1, buy_pct: 10 }];
const closes = { AAPL: walk(252, 200, 170, 0.02), MSFT: walk(252, 300, 330), NVDA: walk(252, 90, 120), 'VUSA.AS': walk(252, 80, 100), 'VWCE.DE': walk(252, 100, 108), 'ACWI.L': walk(252, 90, 92), AMD: walk(252, 160, 110, 0.03), TSM: walk(252, 100, 240),
  BAES: walk(252, 20, 18), BAD: walk(252, 50, 30), WORSE: walk(252, 10, 5), '^GSPC': null };
const scen = [
  { name: 'calm market, behind pace', today: '2026-11-18', vix: 12, spx: [5000, 5200], titles: ['Stocks hit record high as rally continues', 'Tech gains on strong earnings', 'Markets jump, bull run'], ann: '8.5', live: PIES },
  { name: 'normal, on track', today: '2026-06-03', vix: 17, spx: [5000, 5100], titles: ['Quiet day on Wall Street'], ann: '12.2', live: PIES },
  { name: 'fear, 5-Monday month', today: '2026-03-31', vix: 24, spx: [5800, 5000], titles: ['Selloff deepens as recession fears grow', 'Tariff war panic', 'Stocks tumble on crisis'], ann: '16.7', live: PIES },
  { name: 'extreme fear', today: '2026-08-04', vix: 36, spx: [5800, 4900], titles: ['Market crash: stocks plunge', 'Rout continues, volatility spikes', 'Layoffs and inflation surge'], ann: '3.1', live: PIES },
  { name: 'no annualised history yet', today: '2026-11-02', vix: 19, spx: [5000, 5050], titles: [], ann: null, live: PIES },
  { name: 'live pies subset + new pie, no vix data', today: '2026-02-27', vix: null, spx: [5000, 5100], titles: ['Mixed day'], ann: '0', live: ['Magnificent 7', 'Wider ETF', 'Brand New', 'Semiconductor'] },
  { name: 'bought this week: more than suggested, a pie, outside pies, an unpriced order, last week and a SELL ignored', today: '2026-11-20', vix: 31, spx: [5800, 5200], titles: ['Selloff deepens'], ann: '5.7', live: PIES,
    members: { 'Semiconductor': ['AMD_US_EQ', 'TSM_US_EQ'], 'Global ETF': ['ACWIl_EQ'], 'Magnificent 7': ['AAPL_US_EQ'] },
    orders: [
      { ticker: 'AMD_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-17T09:30:00Z', net_value: -40.5 },
      { ticker: 'TSM_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-19T14:02:11Z', net_value: -35.25 },
      { ticker: 'ACWIl_EQ', side: 'BUY', status: 'PARTIALLY_FILLED', filled_at: '2026-11-20T08:00:00Z', net_value: -12.1 },
      { ticker: 'SOLO_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-18T10:00:00Z', net_value: -9.99 },
      { ticker: 'AAPL_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-18T10:00:00Z', net_value: null },
      { ticker: 'AMD_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-12T10:00:00Z', net_value: -50 },
      { ticker: 'AMD_US_EQ', side: 'SELL', status: 'FILLED', filled_at: '2026-11-19T10:00:00Z', net_value: 80 },
      { ticker: 'AMD_US_EQ', side: 'BUY', status: 'CANCELLED', filled_at: '2026-11-19T10:00:00Z', net_value: -999 },
      { ticker: 'AMD_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-10-30T10:00:00Z', net_value: -70 }] },
  { name: 'bought less than suggested this week (some left), week starts Monday', today: '2026-11-16', vix: 18, spx: [5000, 5100], titles: [], ann: '12.2', live: PIES,
    members: { 'Defence': ['BAE_US_EQ'] }, orders: [{ ticker: 'BAE_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-16T07:00:00Z', net_value: -8 }, { ticker: 'BAE_US_EQ', side: 'BUY', status: 'FILLED', filled_at: '2026-11-15T23:59:00Z', net_value: -100 }] },
  { name: 'only ratings pies (no snapshot pies)', today: '2026-09-15', vix: 21, spx: [5000, 5100], titles: ['Gains and rebound', 'Fear returns'], ann: '15.4', live: [] },
];
function diff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${p}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return `${p}: length js ${a.length} vs py ${b.length}`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (k === 'updated_at') continue; const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return null; }
  return `${p}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
}
console.log('(each scenario below runs Python and the browser on the same inputs)');
seed = 777;
for (const sc of scen) {
  const cl = { ...closes, '^GSPC': walk(252, sc.spx[0], sc.spx[1], 0.01) }, vix1m = sc.vix === null ? [] : walk(22, sc.vix - 1, sc.vix, 0.02);
  const payload = { ...sc, closes: cl, ratings: rows, vix1m, titles: sc.titles };
  const py = JSON.parse(execFileSync('python3', ['-I', '-c', `
import os, sys, json, types, datetime as dt
import pandas as pd
os.environ["SUPABASE_URL"] = "x"; os.environ["SUPABASE_KEY"] = "x"
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s
    @property
    def news(self): return [{"title": t} for t in F["titles"]]
    def history(self, period=None, interval=None):
        c = F["vix1m"] if self.s == "^VIX" else F["closes"].get(self.s)
        if not c: raise Exception("no data")
        return pd.DataFrame({"Close": c}, index=pd.date_range("2025-01-01", periods=len(c), freq="B"))
yf.Ticker = Ticker; sys.modules["yfinance"] = yf
import services.strategy_service as ss
class D(dt.date):
    @classmethod
    def today(cls): return cls.fromisoformat(F["today"])
ss.date = D
cap = {}
def req(method, path, data=None):
    if method == "GET" and path.startswith("analyst_ratings"): return F["ratings"]
    if method == "GET" and path.startswith("portfolio_snapshots"): return [{"raw": {"pies": [{"name": n + " ", "instruments": [{"ticker": t} for t in F.get("members", {}).get(n, [])]} for n in F["live"]]}}] if F["live"] else []
    if method == "GET" and path.startswith("t212_orders"): return F.get("orders", [])
    if method == "GET" and path.startswith("returns_summary"): return [{"annualised_pct": F["ann"]}]
    if method == "POST": cap["row"] = data
    return []
ss.supabase_request = req
ss.run()
print("@@" + json.dumps(cap["row"]))
`], { input: JSON.stringify(payload), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
  const by = new Map(); for (const r of rows) { const k = r.pie.trim(); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const pieOf = {}; for (const [pie, ts] of Object.entries(sc.members || {})) for (const t of ts) pieOf[t] = pie;
  const js = ST.compute({ today: sc.today, invested: ST.contributions(sc.orders || [], pieOf, sc.today), ratings: by, livePies: sc.live, annRaw: sc.ann, closes: cl, vix1m, titles: sc.titles, nowIso: 'X' }).row;
  const d = diff(js, py); ok(`${sc.name}: £${js.total_suggested} across ${js.recommendations.length} pies, mood "${js.market_mood.label}" identical to Python (amounts, reasons, priorities, notes)`, d === null); if (d) console.log('    first difference:', d);
}
ok('calendar helpers: Mondays in Mar 2026 = 5, Nov 2026 = 5; week of month for 2026-11-18 = 3', ST.mondaysInMonth(2026, 3) === 5 && ST.mondaysInMonth(2026, 11) === 5 && ST.weekOfMonth(2026, 11, 18) === 3);
// run(): ratings regrouped by the customer's OWN pies, prices/news via the market client, result saved encrypted
const tables = { portfolio_snapshots: [{ created_at: '2026-11-18T08:00:00Z', raw: { pies: [{ name: 'Magnificent 7 ', instruments: [{ ticker: 'AAPL_US_EQ' }, { ticker: 'MSFT_US_EQ' }, { ticker: 'NVDA_US_EQ' }] }, { name: 'Wider ETF', instruments: [{ ticker: 'VUSAa_EQ' }, { ticker: 'VWCEd_EQ' }] }] } }], returns_summary: [{ annualised_pct: 9.5 }] };
const saved = {}; const store = { load: async k => tables[k] || [], put: async (k, r) => { saved[k] = r; } };
const market = { chart: async (s) => ({ close: s === '^VIX' ? [15, 16, 25] : walk(252, 100, 120) }), headlines: async () => ['Stocks rally', 'Market selloff fears'] };
const wrong = rows.map(r => ({ ...r, pie: 'SOMEONE ELSE\'S PIE' }));       // the shared table's pie names must be ignored
const res = await ST.run({ store, market, ratings: wrong }, new Date('2026-11-18T12:00:00Z'));
ok('run(): uses the customer\'s own pie membership (not the shared table\'s pie names), saves one encrypted row', res.row.recommendations.every(r => ['Magnificent 7', 'Wider ETF', 'Solo'].includes(r.pie)) && saved.strategy_recommendations.length === 1 && res.row.annualised_return === 9.5);

// Issue #53 follow-up: "I bought more than this" - the weekly card must count what was actually bought
const sc = scen.find(x => x.name.startsWith('bought this week')), pieOf2 = {}; for (const [pie, ts] of Object.entries(sc.members)) for (const t of ts) pieOf2[t] = pie;
const inv = ST.contributions(sc.orders, pieOf2, sc.today);
ok('bought this week = filled buys Mon-today only (£97.84 incl. £9.99 outside pies); last week, SELL, cancelled, other month ignored', inv.week === 97.84 && inv.orders_week === 4 && inv.week_start === '2026-11-16' && inv.outside_pies_week === 9.99);
ok('bought this month = £147.84 in 5 orders; the order with no value is counted as unpriced, not as zero', inv.month === 147.84 && inv.orders_month === 5 && inv.unpriced === 1);
ok('per pie: Semiconductor £75.75, Global ETF £12.1', inv.by_pie_week['Semiconductor'] === 75.75 && inv.by_pie_week['Global ETF'] === 12.1);
const cr = ST.compute({ today: sc.today, invested: inv, ratings: new Map([['Semiconductor', rows.filter(r => r.pie === 'Semiconductor')]]), livePies: ['Semiconductor'], annRaw: '5.7', closes: { ...closes, '^GSPC': walk(252, 5800, 5200) }, vix1m: [31], titles: [], nowIso: 'X' }).row;
ok('the card says it plainly: over the suggestion by £38, and the recommendation shows bought / left', cr.notes.some(n => /Bought so far this week: £97\.84 in 4 orders \(suggested £60\): £38 above this week's suggestion\./.test(n)) && cr.recommendations.every(r => r.bought !== undefined && r.left >= 0));
const nothing = ST.compute({ today: '2026-11-17', invested: ST.contributions([], {}, '2026-11-17'), ratings: new Map([['Semiconductor', rows.filter(r => r.pie === 'Semiconductor')]]), livePies: ['Semiconductor'], annRaw: '5.7', closes: { ...closes, '^GSPC': walk(252, 5800, 5200) }, vix1m: [20], titles: [], nowIso: 'X' }).row;
ok('nothing bought yet: says so', nothing.notes.some(n => /Nothing bought yet this week \(suggested £60\)\./.test(n)));
const unread = { load: async k => { if (k === 't212_orders') throw new Error('x'); return k === 'portfolio_snapshots' ? [{ id: 's', created_at: '2026-11-20', raw: { pies: [] } }] : []; }, put: async () => 1 };
ok('orders unreadable: no claim is made (invested stays empty, no "nothing bought")', (await ST.run({ store: unread, market, ratings: new Map() }, new Date('2026-11-18T12:00:00Z'))).row.invested === null);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

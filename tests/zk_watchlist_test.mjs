// Run: node tests/zk_watchlist_test.mjs
// Browser watchlist engine must equal services/watchlist_service.py (fake yfinance over real pandas/numpy, patched clock/DB).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/valuebuy.js'); require('../docs/zk/orderflow.js');
const WL = require('../docs/zk/watchlist.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const NOW = '2026-11-18T12:30:00Z', nowS = Date.parse(NOW) / 1000;
let seed = 2024; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function bizdays(endIso, n) { const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n) { if (d.getUTCDay() % 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const mk = (n, f, o = {}) => { const dates = bizdays(o.end || '2026-11-17', n); const close = dates.map((_, i) => +(f(i / (n - 1), i) * (1 + (rnd() - 0.5) * (o.noise || 0.012))).toFixed(4));
  const volume = dates.map((_, i) => Math.round(1e6 * (i >= n - (o.hiTail ? 1 : 0) ? (o.hiTail || 1) : 1) * (1 + rnd() * 0.1)));
  return { dates, close, volume, currency: o.ccy === undefined ? 'USD' : o.ccy, exchange: o.exch || 'NasdaqGS', regularStart: o.partial ? nowS - 4 * 3600 : nowS - 20 * 3600, regularEnd: o.partial ? nowS + 4 * 3600 : nowS - 12 * 3600 }; };
const upS = (t) => 100 + 70 * t, overb = t => t < 0.9 ? 100 + 20 * t : 118 + 120 * (t - 0.9), oversold = t => t < 0.95 ? 100 + 60 * t / 0.95 : 160 - 30 * (t - 0.95) / 0.05, downS = t => t < 0.7 ? 160 - 90 * t : 97 - 5 * (t - 0.7), flatS = t => 100 + 3 * Math.sin(t * 25), crashS = t => 100 - 55 * t;
const info = (o = {}) => o;
const goodInfo = { recommendationKey: 'strong_buy', numberOfAnalystOpinions: 40, targetMeanPrice: 210, currency: 'USD', quoteType: 'EQUITY', profitMargins: 0.25, revenueGrowth: 0.12, returnOnEquity: 0.4, debtToEquity: 40, operatingMargins: 0.3, returnOnAssets: 0.12, currentRatio: 1.8, quickRatio: 1.4, earningsGrowth: 0.18,
  sharesOutstanding: 1.5e10, marketCap: 3e12, previousClose: 170, open: 171, dayLow: 168, dayHigh: 173, volume: 5e7, averageVolume: 6e7, trailingPE: 28, forwardPE: 24, dividendYield: 0.005, beta: 1.2, fiftyTwoWeekHigh: 190, fiftyTwoWeekLow: 110, sector: 'Technology', industry: 'Consumer Electronics', longBusinessSummary: 'Designs devices. ' + 'x'.repeat(950), website: 'https://x.test', fullTimeEmployees: 160000, country: 'United States' };
const items = [
  [{ ticker: 'AAPL', name: 'Apple', t212_ticker: 'AAPL_US_EQ', type: 'Stock' }, mk(252, upS, { partial: true }), { info: goodInfo, rec_counts: { strongBuy: 20, buy: 15, hold: 5, sell: 0, strongSell: 0 } }],
  [{ ticker: 'VOD.L', name: 'Vodafone', t212_ticker: 'VODl_EQ' }, mk(252, downS, { ccy: 'GBp', exch: 'LSE' }), { info: { recommendationKey: 'sell', numberOfAnalystOpinions: 20, targetMeanPrice: 6000, currency: 'GBp', profitMargins: -0.05, revenueGrowth: -0.03, debtToEquity: 250, returnOnEquity: 0.02, currentRatio: 0.8, trailingPE: -5, sharesOutstanding: 2.6e10, marketCap: 2e10, previousClose: 7000 }, rec_counts: null }],
  [{ ticker: 'SPY', name: 'S&P ETF', type: 'ETF', t212_ticker: 'SPYl_EQ' }, mk(252, upS, { exch: 'NYSEArca', noise: 0.004 }), { info: { quoteType: 'ETF', category: 'Large Blend', fundFamily: 'SSGA', annualReportExpenseRatio: 0.0009, currency: 'USD', beta: 1.0 }, rec_counts: null }],
  [{ ticker: 'GC=F', name: 'Gold', category: 'commodity', alternatives: [{ symbol: 'SGLN.L' }, { symbol: 'IGLN.L' }] }, mk(252, crashS, { exch: 'COMEX', noise: 0.006 }), { info: { currency: 'USD' }, rec_counts: null }],
  [{ ticker: 'BTC-USD', name: 'Bitcoin', category: 'crypto', alternatives: [{ symbol: 'BTCE.L' }] }, mk(252, upS, { end: '2026-11-18', noise: 0.03, exch: 'CCC', partial: true }), { info: { marketCap: 1.8e12, currency: 'USD', quoteType: 'CRYPTOCURRENCY' }, rec_counts: null }],
  [{ ticker: 'TINYC-USD', name: 'Tiny coin', category: 'crypto' }, mk(252, crashS, { end: '2026-11-18', noise: 0.05, exch: 'CCC' }), { info: { marketCap: 4e8, currency: 'USD' }, rec_counts: null }],
  [{ ticker: 'OVERS', name: 'Oversold', t212_ticker: 'OVERS_US_EQ' }, mk(252, oversold, { hiTail: 3, noise: 0.01 }), { info: { ...goodInfo, recommendationKey: 'buy', numberOfAnalystOpinions: 6 }, rec_counts: null }],
  [{ ticker: 'ENTR', name: 'Oversold quiet', t212_ticker: 'ENTR_US_EQ' }, mk(252, oversold, { noise: 0.004 }), { info: { ...goodInfo, recommendationKey: 'buy', numberOfAnalystOpinions: 6 }, rec_counts: null }],
  [{ ticker: 'OVERB', name: 'Overbought', t212_ticker: 'OVERB_US_EQ' }, mk(252, overb, {}), { info: { recommendationKey: 'hold', numberOfAnalystOpinions: 12, targetMeanPrice: 900, currency: 'USD', sharesOutstanding: 1e9, marketCap: 9e11 }, rec_counts: { strongBuy: 1, buy: 2, hold: 8, sell: 1, strongSell: 0 } }],
  [{ ticker: 'STALE', name: 'Stale' }, mk(252, upS, { end: '2026-11-10' }), { info: goodInfo, rec_counts: null }],
  [{ ticker: 'SHORT', name: 'Short' }, mk(40, upS), { info: {}, rec_counts: null }],
  [{ ticker: 'JUMP', name: 'Jump' }, mk(252, (t, i) => i > 240 ? 10000 : 100), { info: {}, rec_counts: null }],
  [{ ticker: 'NOCCY', name: 'No currency' }, mk(252, upS, { ccy: '' }), { info: {}, rec_counts: null }],
  [{ ticker: 'NOHIST', name: 'No history' }, null, { info: {}, rec_counts: null }],
  [{ ticker: 'DOWNG', name: 'Downtrend good', t212_ticker: 'DOWNG_US_EQ' }, mk(252, downS, { noise: 0.01 }), { info: { ...goodInfo, targetMeanPrice: 5000 }, rec_counts: { strongBuy: 5, buy: 5, hold: 2, sell: 0, strongSell: 0 } }],
  [{ ticker: 'NOBROKER', name: 'Not on T212' }, mk(252, flatS, { noise: 0.008 }), { info: { recommendationKey: 'none', currency: 'USD', trailingPE: 12, forwardPE: 14, beta: 0.8, dividendYield: 0.03 }, rec_counts: null }],
  [{ ticker: 'SAF.JO', name: 'ZAc line', category: 'stock', t212_ticker: 'SAF_EQ' }, mk(252, upS, { ccy: 'ZAc', exch: 'JNB' }), { info: { recommendationKey: 'buy', numberOfAnalystOpinions: 5, targetMeanPrice: 25000, currency: 'ZAc', profitMargins: 0.12 }, rec_counts: { strongBuy: 0, buy: 3, hold: 1, sell: 0, strongSell: 0 } }],
  [{ ticker: 'GLD', name: 'Gold ETF', type: 'ETF', category: 'commodity', t212_ticker: 'GLD_EQ' }, mk(252, upS, { noise: 0.005 }), { info: { quoteType: 'ETF', currency: 'USD' }, rec_counts: null }],
];
const fx = { USD: [1.30, 1.31, 1.3175] };
const PY = `
import os, sys, json, types
import pandas as pd
os.environ.update(SUPABASE_URL="x", SUPABASE_KEY="x")
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s; self.d = F["charts"].get(s); self.det = F["det"].get(s) or {}
    @property
    def history_metadata(self):
        d = self.d
        if not d: return {}
        return {"currency": d["currency"], "fullExchangeName": d["exchange"], "currentTradingPeriod": {"regular": {"start": d["regularStart"], "end": d["regularEnd"]}}}
    @property
    def info(self): return dict(self.det.get("info") or {})
    @property
    def recommendations(self):
        rc = self.det.get("rec_counts")
        return pd.DataFrame([rc]) if rc else None
    def history(self, period=None, interval=None, auto_adjust=None):
        if self.s.startswith("GBP") and self.s.endswith("=X"):
            v = F["fx"].get(self.s[3:-2])
            if not v: raise RuntimeError("no fx")
            return pd.DataFrame({"Close": v}, index=pd.date_range("2026-11-10", periods=len(v), freq="B"))
        d = self.d
        if not d: return pd.DataFrame()
        return pd.DataFrame({"Close": pd.Series(d["close"], dtype="float64").values, "Volume": pd.Series(d["volume"], dtype="float64").values}, index=pd.to_datetime(d["dates"]))
yf.Ticker = Ticker; sys.modules["yfinance"] = yf
import services.watchlist_service as wl
Real = wl.datetime
class DT(Real):
    @classmethod
    def now(cls, tz=None): return Real.fromisoformat(F["now"].replace("Z", "+00:00")).astimezone(tz)
wl.datetime = DT
out = []
def sb(method, path, data=None, prefer=None):
    if method == "GET" and path.startswith("watchlist"): return F["items"]
    if method == "POST": out.append(data); return True
wl.sb = sb
wl.run()
print("@@" + json.dumps(out, default=float))
`;
const charts = {}, det = {}; for (const [it, ch, d] of items) { charts[it.ticker] = ch; det[it.ticker] = d; }
const py = JSON.parse(execFileSync('python3', ['-I', '-c', PY], { input: JSON.stringify({ charts, det, items: items.map(x => x[0]), fx, now: NOW }), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop().replace(/\bNaN\b/g, 'null'));
const data = {}; for (const [it, ch, d] of items) data[it.ticker] = { chart: ch, det: d };
const js = WL.compute({ items: items.map(x => x[0]), data, fx: { USD: fx.USD[2] }, now: new Date(NOW) });
const diff = (a, b, p = '') => {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) ? null : `${p}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return `${p}: array length js ${a && a.length} vs py ${b && b.length}`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return null; }
  return `${p}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
};
ok(`same ${items.length} names in the same order`, js.map(r => r.ticker).join() === py.map(r => r.ticker).join());
for (const r of js) { const p = py.find(x => x.ticker === r.ticker), d = diff(JSON.parse(JSON.stringify(r)), (({ updated_at, ...o }) => o)(p)); ok(`  ${r.ticker.padEnd(10)} ${r.status.padEnd(10)} ${(r.verdict || '-').padEnd(11)} ${(r.data.reason || '').slice(0, 44).padEnd(44)} identical to Python`, d === null); if (d) console.log('    first difference:', d); }
const verdicts = new Set(js.map(r => r.verdict)), reasons = js.map(r => r.data.reason || '').join('|');
ok('covers ENTER/ACCUMULATE/HOLD/AVOID and the unverified reasons (no history, short, stale, units, currency)', ['ENTER', 'ACCUMULATE', 'HOLD', 'AVOID'].every(v => verdicts.has(v)) && ['no price history', 'only 40 sessions', 'is stale', 'inconsistent price units', 'listing currency unknown'].every(w => reasons.includes(w)));
ok('covers stocks, ETFs, commodity, crypto and sub-unit quotes (GBp, ZAc)', ['stock', 'commodity', 'crypto'].every(c => js.some(r => r.status === 'ok' && r.data.category === c)));
{ const okRows = js.filter(r => r.status === 'ok'), act = okRows.filter(r => ['ENTER', 'ACCUMULATE'].includes(r.verdict));
  ok('regression (no fixed budget): no £ amounts or budget object anywhere; every name has a relative weight and each price point a share', okRows.every(r => r.data.budget === undefined && r.data.weight && r.data.entries.every(e => e.amount_gbp === undefined && e.shares === undefined && e.share > 0)));
  for (const cat of ['stock', 'commodity', 'crypto']) { const g = act.filter(r => r.data.category === cat); if (g.length) ok(`  ${cat}: the buys this week share 100% of what you invest`, Math.abs(g.reduce((a, r) => a + r.data.weight.share, 0) - 1) < 1e-3); } }
// run(): through store + market
const tables = { watchlist: items.map(x => x[0]), }, saved = [];
const store = { load: async k => tables[k] || [], get: async (k, key) => (tables[k] || []).find(r => r.key === key) || null, put: async (k, r) => saved.push(...r) };
const market = { chart: async (s) => s === 'GBPUSD=X' ? { close: fx.USD } : (charts[s] || null), detail: async s => det[s] || { info: {}, rec_counts: null } };
const out = await WL.run({ store, market }, new Date(NOW));
ok('run(): fetches market data and FX, saves one analysis per name', saved.length === items.length && JSON.stringify(out.rows.map(r => r.verdict)) === JSON.stringify(js.map(r => r.verdict)));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

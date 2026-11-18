// Run: node tests/zk_analystratings_test.mjs
// Browser analyst/trend ratings must equal services/analyst_service.py (fake yfinance over real pandas).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js');
const AR = require('../docs/zk/analystratings.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ser = (n, f) => Array.from({ length: n }, (_, i) => +(f(i / (n - 1)) * (1 + (rnd() - 0.5) * 0.01)).toFixed(4));
const up = t => 100 + 60 * t, knife = t => 100 - 40 * t, dipUp = t => t < 0.88 ? 100 + 50 * t / 0.88 : 150 - 10 * (t - 0.88) / 0.12, flatS = t => 100 + 2 * Math.sin(t * 30), down = t => 100 - 8 * t;
const T = (a, b, c, d, e) => ({ strongBuy: a, buy: b, hold: c, sell: d, strongSell: e });
const tr = rows => rows.map((r, i) => ({ period: ['0m', '-1m', '-2m', '-3m'][i], ...r }));
const universe = [
  ['NVDA_US_EQ', 'NVDA', 'Stocks', 'NASDAQ/NYSE', { recommendationKey: 'strong_buy', targetMeanPrice: 200, numberOfAnalystOpinions: 55, trend: tr([T(20, 25, 5, 1, 0), T(21, 24, 5, 1, 0), T(22, 22, 6, 1, 0), T(20, 20, 7, 2, 1)]) }, null],
  ['AMD_US_EQ', 'AMD', 'Stocks', 'NASDAQ/NYSE', { recommendationKey: 'hold', targetMeanPrice: 150, numberOfAnalystOpinions: 30, trend: tr([T(3, 8, 15, 4, 1), T(2, 9, 14, 5, 2)]) }, null],        // only 2 rows: use all
  ['INTC_US_EQ', 'INTC', 'Stocks', 'NASDAQ/NYSE', { recommendationKey: 'underperform', targetMeanPrice: 25, numberOfAnalystOpinions: 20, trend: [] }, null],         // fallback map
  ['ZERO_US_EQ', 'ZERO', 'Stocks', 'NASDAQ/NYSE', { recommendationKey: 'buy', targetMeanPrice: 10, trend: tr([T(0, 0, 0, 0, 0), T(0, 0, 0, 0, 0), T(0, 0, 0, 0, 0), T(0, 0, 0, 0, 0)]) }, null], // total 0, count missing
  ['NONEWT_US_EQ', 'NONEWT', 'Stocks', 'NASDAQ/NYSE', { recommendationKey: 'none', targetMeanPrice: 12 }, null],                                                        // none but target -> map (40/40/20)
  ['VWRPl_EQ', 'VWRP', 'Wider ETF', 'LSE', {}, up(0) && ser(252, up)],                                                                                                  // ETF, uptrend
  ['SGLNl_EQ', 'SGLN', null, 'LSE', { recommendationKey: 'none' }, ser(252, knife)],                                                                                    // falling knife
  ['VUSAl_EQ', 'VUSA', 'Wider ETF', 'LSE', 'RAISE', ser(252, dipUp)],                                                                                                   // info fails -> trend, dip in uptrend
  ['IAEXa_EQ', 'IAEX', 'Countries', 'AMS', {}, ser(252, flatS)],
  ['SSLNl_EQ', 'SSLN', 'Countries', 'LSE', {}, ser(252, down)],
  ['TINYl_EQ', 'TINY', 'Countries', 'LSE', {}, ser(40, up)],                                                                                                            // too short -> no data
  ['GONE_US_EQ', 'GONE', 'Stocks', 'NASDAQ/NYSE', {}, null],                                                                                                            // nothing at all
  ['NVDA_US_EQ', 'NVDA', 'Solo holdings', 'NASDAQ/NYSE', null, null],                                                                                                   // duplicate row, later wins
];
const positions = universe.map(([ticker, display, pie, exchange]) => ({ ticker, display, pie, exchange }));
const S = require('../docs/zk/symbols.js'), yOf = p => S.t212ToYahoo(p.ticker, p.exchange)[0];
const infos = {}, hist = {}; for (const [t, , , ex, info, h] of universe) { const y = S.t212ToYahoo(t, ex)[0]; if (info !== null) infos[y] = info; if (h) hist[y] = h; }
const PY = `
import os, sys, json, types
import pandas as pd
os.environ.update(SUPABASE_URL="x", SUPABASE_KEY="x")
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s
    @property
    def info(self):
        i = F["info"].get(self.s, {})
        if i == "RAISE": raise RuntimeError("boom")
        return {k: v for k, v in i.items() if k != "trend"}
    @property
    def fast_info(self): raise RuntimeError("no fast info")
    @property
    def recommendations(self):
        t = (F["info"].get(self.s) or {})
        t = t.get("trend") if isinstance(t, dict) else None
        return pd.DataFrame(t) if t else None
    def history(self, period=None, interval=None, auto_adjust=None):
        h = F["hist"].get(self.s)
        if not h: return pd.DataFrame()
        return pd.DataFrame({"Close": h}, index=pd.date_range("2025-11-03", periods=len(h), freq="B"))
yf.Ticker = Ticker; sys.modules["yfinance"] = yf
import services.analyst_service as an
an.time.sleep = lambda s: None
rows, dels = [], []
def req(method, path, data=None):
    if method == "GET" and path.startswith("portfolio_snapshots"): return [{"id": 1}]
    if method == "GET": return F["positions"]
    if method == "POST": rows.append(data); return {}
    if method == "DELETE": dels.append(path); return {}
an.supabase_request = req
an.run()
print("@@" + json.dumps({"rows": rows, "dels": dels}))
`;
const py = JSON.parse(execFileSync('python3', ['-I', '-c', PY], { input: JSON.stringify({ info: infos, hist, positions }), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
const data = {}; for (const [y, i] of Object.entries(infos)) data[y] = { info: i === 'RAISE' ? null : i }; for (const [y, h] of Object.entries(hist)) { data[y] = data[y] || {}; data[y].closes = h; }
for (const y of Object.keys(data)) if (data[y].info && AR.fromAnalysts(data[y].info)) delete data[y].closes;      // run() only loads history when analysts have no rating
const js = AR.compute({ positions, data, nowIso: 'X' });
const strip = r => { const { updated_at, ...o } = r; return o; };
ok('same holdings rated, same order (duplicate merged, unrated tickers skipped)', js.rows.map(r => r.ticker).join() === py.rows.map(r => r.ticker).join() && js.rows.length === 10);
for (const r of js.rows) { const p = py.rows.find(x => x.ticker === r.ticker), a = JSON.stringify(strip(r)), b = JSON.stringify(strip(p)); ok(`  ${r.ticker.padEnd(12)} ⭐${r.star_rating} ${r.recommendation.padEnd(12)} buy ${String(r.buy_pct).padStart(5)}% [${r.source}] identical to Python`, a === b); if (a !== b) console.log('    js', a, '\n    py', b); }
ok('covers analyst rows, fallback map, zero-total, trend ratings (uptrend, falling knife, dip-in-uptrend) and 1-5 stars', new Set(js.rows.map(r => r.source)).size === 2 && js.rows.some(r => r.recommendation === 'sell') && js.rows.some(r => r.recommendation === 'strong_buy') && new Set(js.rows.map(r => r.star_rating)).size >= 3);
ok('python also pruned unrated tickers; ratings missing for GONE/TINY on both sides', py.dels.length === 1 && !js.rated.includes('GONE_US_EQ') && !js.rated.includes('TINYl_EQ'));
// run(): end to end through store + market, only loading history when needed
const tables = { portfolio_snapshots: [{ id: 's', created_at: '2026-11-18T08:00:00Z' }], positions: positions.map(p => ({ ...p, snapshot_id: 's' })), analyst_ratings: [{ ticker: 'OLD' }] };
const saved = [], removed = [], charts = []; const store = { load: async k => tables[k], put: async (k, r) => { saved.push(...r); tables.analyst_ratings = [...tables.analyst_ratings, ...r]; }, remove: async (k, key) => removed.push(key) };
const market = { info: async y => infos[y] === 'RAISE' ? null : (infos[y] || {}), chart: async (y, rg) => { charts.push(y); return hist[y] ? { adjclose: hist[y] } : null; } };
const out = await AR.run({ store, market }, new Date('2026-11-18T12:00:00Z'));
ok('run(): saves identical ratings to the encrypted store, drops stale ones, fetches price history only for uncovered tickers', JSON.stringify(out.rows.map(strip)) === JSON.stringify(js.rows.map(strip)) && removed.includes('OLD') && !charts.includes('NVDA') && charts.includes('VWRP.L'));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

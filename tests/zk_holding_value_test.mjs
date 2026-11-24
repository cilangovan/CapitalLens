// Run: node tests/zk_holding_value_test.mjs
// Browser holding-decision and value-buy engines must equal their Python services (fake yfinance over real pandas/numpy).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js');
const HD = require('../docs/zk/holdingdecision.js'), VB = require('../docs/zk/valuebuy.js'); require('../docs/zk/orderflow.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let seed = 31337; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function series(n, shape, base = 100, noise = 0.012, volBase = 1000, volTail = 1000) {
  const c = [], h = [], l = [], v = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1), x = base * shape(t) * (1 + (rnd() - 0.5) * noise); c.push(+x.toFixed(4)); h.push(+(x * (1 + rnd() * 0.012)).toFixed(4)); l.push(+(x * (1 - rnd() * 0.012)).toFixed(4)); v.push(i >= n - 5 ? volTail : volBase); }
  return { c, h, l, v };
}
const up = t => 1 + 0.6 * t, down = t => 1 - 0.3 * t, hump = t => t < 0.7 ? 1 + 0.5 * t : 1.35 - 0.8 * (t - 0.7) * 1.9, crash = t => t < 0.6 ? 1 + 0.4 * t : 1.24 - 1.1 * (t - 0.6), flat = t => 1 + 0.01 * Math.sin(t * 20), dip = t => t < 0.9 ? 1 + 0.2 * t : 1.18 - 0.9 * (t - 0.9);
const diff = (a, b, p = '') => {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${p}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return `${p}: length js ${a.length} vs py ${b.length}`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (k === 'updated_at') continue; const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return null; }
  return `${p}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
};
const PYPRE = `
import os, sys, json, types, datetime as dt
import pandas as pd
os.environ["SUPABASE_URL"] = "x"; os.environ["SUPABASE_KEY"] = "x"
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s
    @property
    def info(self): return F.get("info", {}).get(self.s, {})
    def history(self, period=None, interval=None, auto_adjust=None):
        d = F["hist"].get(self.s)
        if d is None: return pd.DataFrame()
        return pd.DataFrame({"Close": d["c"], "High": d["h"], "Low": d["l"], "Volume": d["v"]}, index=pd.date_range("2025-06-02", periods=len(d["c"]), freq="B"))
yf.Ticker = Ticker; sys.modules["yfinance"] = yf
`;
const py = (code, F) => JSON.parse(execFileSync('python3', ['-I', '-c', PYPRE + code], { input: JSON.stringify(F), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());

// ───────── holding decisions ─────────
const TODAY = '2026-11-18';
const hdPos = [['NVDA_US_EQ', 'NVDA', 'Stocks', 'NASDAQ/NYSE', up, 1000, 3000], ['ITWNl_EQ', 'ITWNl', 'Countries', 'LSE', hump, 1000, 1500], ['XDAXl_EQ', 'XDAXl', 'Countries', 'LSE', crash, 1000, 1800],
  ['VWCEd_EQ', 'VWCEd', 'Wider ETF', 'XETRA', flat, 1000, 1000], ['VUSAa_EQ', 'VUSAa', 'Wider ETF', 'AMS', dip, 1000, 600], ['SGLNl_EQ', 'SGLNl', 'Solo holdings', 'LSE', down, 1000, 500],
  ['NODATA_US_EQ', 'NODATA', 'Stocks', 'NASDAQ/NYSE', null], ['SHORT_US_EQ', 'SHORT', 'Stocks', 'NASDAQ/NYSE', 'short'], ['MID_US_EQ', 'MID', 'Stocks', 'NASDAQ/NYSE', 'mid'], ['ODD_XX_EQ', 'ODD', null, 'EURONEXT', up, 1000, 1200]];
const hdHist = {}, hdPositions = [];
for (const [t, disp, pie, ex, shape, vb, vt] of hdPos) {
  hdPositions.push({ ticker: t, display: disp, pie, exchange: ex });
  const sym = HD.yfSymbol(disp, ex);
  hdHist[sym] = shape === null ? null : shape === 'short' ? series(8, up) : shape === 'mid' ? series(12, up, 50) : series(126, shape, 100, 0.012, vb, vt);
}
hdPositions.push({ ...hdPositions[0] });                                           // duplicate row (positions table can repeat)
const flow = { markets: JSON.stringify([{ region: 'USA', score: 82 }, { region: 'UK', score: 35 }, { region: 'Europe', score: 64 }]) };
const pyHD = py(`
import services.holding_decision_service as hd
class D(dt.date):
    @classmethod
    def today(cls): return cls.fromisoformat(F["today"])
hd.date = D; hd.time.sleep = lambda s: None
cap = {}
hd.sb_get = lambda table, query="": F["positions"] if table == "positions" else [F["flow"]]
hd.sb_upsert = lambda table, rows, conflict=None: cap.update(rows=rows)
hd.run()
print("@@" + json.dumps(cap["rows"]))
`, { hist: hdHist, positions: hdPositions, flow, today: TODAY });
const metrics = {}; for (const p of hdPositions) { const h = hdHist[HD.yfSymbol(p.display, p.exchange)]; metrics[p.ticker] = h ? HD.techMetrics({ c: h.c, h: h.h, v: h.v }) : null; }
const jsHD = HD.compute({ today: TODAY, positions: hdPositions, metrics, regionScores: HD.regionScores(flow.markets) }).rows;
ok('holding decisions: same holdings scored (no-data and too-short histories skipped, duplicates removed)', jsHD.map(r => r.ticker).join() === pyHD.map(r => r.ticker).join() && jsHD.length === 8);
for (const r of jsHD) { const d = diff(r, pyHD.find(x => x.ticker === r.ticker)); ok(`  ${r.display.padEnd(6)} ${String(r.score).padStart(3)}/100 ${r.decision.padEnd(26)} sell L${r.sell_level} identical to Python`, d === null); if (d) console.log('    first difference:', d); }
ok('fixture covers several decisions and sell levels incl. a Level 3+ signal', new Set(jsHD.map(r => r.decision)).size >= 3 && jsHD.some(r => r.sell_level >= 3) && jsHD.some(r => r.sell_level === 0));
ok('region scores accepted as JSON text or as an array', JSON.stringify(HD.regionScores(flow.markets)) === JSON.stringify(HD.regionScores(JSON.parse(flow.markets))));

// ───────── value buy ─────────
const vbPos = [['NVDA_US_EQ', 'NVDA', 'Stocks', 'NASDAQ/NYSE', 112.5], ['ITWNl_EQ', 'ITWNl', 'Countries', 'LSE', 3100], ['VWCEd_EQ', 'VWCEd', 'Wider ETF', 'XETRA', 118.2], ['SGLNl_EQ', 'SGLNl', null, 'LSE', 36.4],
  ['LOW_US_EQ', 'LOW', 'Stocks', 'NASDAQ/NYSE', 90], ['VOL_US_EQ', 'VOL', 'Stocks', 'NASDAQ/NYSE', 20], ['NOHIST_US_EQ', 'NOHIST', 'Stocks', 'NASDAQ/NYSE', 10], ['NOAVG_US_EQ', 'NOAVG', 'Stocks', 'NASDAQ/NYSE', null], ['NVDA_US_EQ', 'NVDA', 'Stocks', 'NASDAQ/NYSE', 115.0]];
const vbShapes = { NVDA: [up, 100], 'ITWN.L': [hump, 3000], 'VWCE.DE': [flat, 110], 'SGLN.L': [down, 40], LOW: [dip, 100], VOL: [(t) => 1 + 0.9 * Math.sin(t * 12) * 0.6 + 0.4 * t, 20], NOAVG: [crash, 50] };
const vbHist = {}; for (const [s, [sh, b]] of Object.entries(vbShapes)) vbHist[s] = series(252, sh, b, s === 'VOL' ? 0.12 : 0.012);
vbHist.NOHIST = series(15, up, 10);
const vbInfo = { NVDA: { trailingPE: 62.4, forwardPE: 40.1, targetMeanPrice: 200, recommendationKey: 'strong_buy', numberOfAnalystOpinions: 55, marketCap: 3e12, sector: 'Technology', shortName: 'NVIDIA Corp' },
  'VWCE.DE': { shortName: 'Vanguard FTSE All-World' }, LOW: { trailingPE: 9.5, recommendationKey: 'hold', numberOfAnalystOpinions: 3, longName: 'Low Corp Inc' }, VOL: { trailingPE: 0, recommendationKey: 'sell', numberOfAnalystOpinions: 0 }, NOAVG: { trailingPE: 28, recommendationKey: 'underperform', numberOfAnalystOpinions: 12 }, 'ITWN.L': { recommendationKey: 'buy', numberOfAnalystOpinions: 25 } };
const vbPositions = vbPos.map(([ticker, display, pie, exchange, avg_price]) => ({ ticker, display, pie, exchange, avg_price }));
const pyVB = py(`
import services.value_buy_service as vb
vb.time.sleep = lambda s: None
cap = {}
vb.sb_get = lambda table, query="": [{"id": 1}] if table == "portfolio_snapshots" else F["positions"]
vb.sb_upsert = lambda table, rows, conflict=None: cap.update(rows=rows)
vb.sb_delete_stale = lambda t: None
vb.run()
print("@@" + json.dumps(cap["rows"]))
`, { hist: vbHist, info: vbInfo, positions: vbPositions });
const data = {}; for (const p of vbPositions) { const y = require('../docs/zk/symbols.js').t212ToYahoo(p.ticker, p.exchange)[0]; data[y] = VB.yahooData(vbHist[y] ? { c: vbHist[y].c, h: vbHist[y].h, l: vbHist[y].l, v: vbHist[y].v } : null, vbInfo[y], y); }
const jsVB = VB.compute({ positions: vbPositions, data, nowIso: 'X' }).rows;
ok('value buy: same holdings analysed (short history skipped, duplicate ticker merged)', jsVB.map(r => r.ticker).join() === pyVB.map(r => r.ticker).join() && jsVB.length === 7);
for (const r of jsVB) {
  const p = pyVB.find(x => x.ticker === r.ticker), norm = o => ({ ...o, entry_zones: JSON.parse(o.entry_zones), scorecard: JSON.parse(o.scorecard), earnings: JSON.parse(o.earnings), this_week: JSON.parse(o.this_week) });
  const d = diff(norm(r), norm(p)); ok(`  ${r.ticker.padEnd(8)} ${String(r.score).padStart(3)}/100 ${r.verdict.padEnd(12)} ${JSON.parse(r.this_week).action.padEnd(13)} identical to Python (zones, target, scorecard, warning)`, d === null); if (d) console.log('    first difference:', d);
}
ok('fixture covers several verdicts and actions, with and without warnings', new Set(jsVB.map(r => r.verdict)).size >= 3 && new Set(jsVB.map(r => JSON.parse(r.this_week).action)).size >= 3 && jsVB.some(r => r.warning) && jsVB.some(r => !r.warning));

// run(): end to end through store + market (adjusted prices)
const tables = { portfolio_snapshots: [{ id: 5, created_at: TODAY + 'T08:00:00Z' }], positions: hdPositions.slice(0, 6).map(p => ({ ...p, snapshot_id: 5, avg_price: 100 })), value_buy_scores: [{ ticker: 'OLD' }], holding_decisions: [] };
const saved = {}, removed = [];
const store = { load: async k => tables[k] || [], put: async (k, r) => { saved[k] = r; if (k === 'value_buy_scores') tables.value_buy_scores = [...tables.value_buy_scores, ...r]; }, remove: async (k, key) => removed.push(key) };
const market = { chart: async (sym) => { const h = hdHist[sym] || vbHist[sym]; return h ? { close: h.c, adjclose: h.c, high: h.h, low: h.l, volume: h.v } : null; }, info: async () => ({}) };
const r1 = await HD.run({ store, market, flowReport: flow }, new Date(TODAY + 'T12:00:00Z')), r2 = await VB.run({ store, market }, new Date(TODAY + 'T12:00:00Z'));
ok('run(): both engines read the encrypted store, save rows, and value-buy drops stale tickers', saved.holding_decisions.length === r1.rows.length && r1.rows.length >= 4 && saved.value_buy_scores.length === r2.rows.length && removed.includes('OLD'));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

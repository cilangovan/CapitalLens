// Run: node tests/zk_profitbooking_test.mjs
// Browser profit-booking engine must equal services/profit_booking_service.py (fake yfinance over real pandas) on the same data.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js'); const PB = require('../docs/zk/profitbooking.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let seed = 4242; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const L = 252;
const path = (p0, p1, noise, vol0 = 1000, volLast = 1000) => { const c = [], h = [], l = [], v = []; for (let i = 0; i < L; i++) { const x = p0 + (p1 - p0) * i / (L - 1) + (rnd() - 0.5) * noise * p0; c.push(+x.toFixed(4)); h.push(+(x * (1 + rnd() * 0.01)).toFixed(4)); l.push(+(x * (1 - rnd() * 0.01)).toFixed(4)); v.push(Math.round(i >= L - 5 ? volLast : vol0)); } return { c, h, l, v }; };
const hist = { '^GSPC': path(4000, 5200, 0.01), ACWI: path(100, 125, 0.01), '^VIX': path(18, 17, 0.1), SPY: path(400, 520, 0.01), XLK: path(180, 260, 0.01), XLF: path(38, 40, 0.01), XLE: path(90, 80, 0.01),
  NVDA: path(90, 175, 0.02, 1000, 2500), ABC: path(100, 60, 0.02, 1000, 3000), MID: path(50, 58, 0.01, 1000, 1000), 'VUSA.AS': path(80, 100, 0.01), 'QDVE.DE': path(30, 45, 0.015), 'SGLN.L': path(38, 44, 0.01),
  FOO: path(100, 70, 0.02), CORE: path(20, 24, 0.01), NOHIST: null };
for (const k of Object.keys(hist)) if (hist[k]) { hist[k].v[hist[k].v.length - 1] = 0; }
const info = { NVDA: { sector: 'Technology', targetMeanPrice: 200, currentPrice: 170 }, ABC: { sector: 'Financial Services', targetMeanPrice: 55, currentPrice: 60 }, FOO: { longName: 'Global Semiconductor Index Fund' }, CORE: { shortName: 'Core Equity ETF' } };
const pos = (ticker, display, exchange, gain, qty, cur, avg, pie) => ({ ticker, display, exchange, gain_pct: gain, quantity: qty, current_price: cur, avg_price: avg, pie });
const positions = [pos('NVDA_US_EQ', 'NVDA', 'NASDAQ/NYSE', 52.3, 12.5, 175, 114.9, 'Stocks'), pos('ABC_US_EQ', 'ABC', 'NASDAQ/NYSE', -12.4, 30, 60, 68.5, 'Stocks'), pos('MID_US_EQ', 'MID', 'NASDAQ/NYSE', 22.1, 40, 58, 47.5, 'Stocks'),
  pos('VUSAa_EQ', 'VUSA', 'AMS', 8.2, 30, 100, 92.4, 'Wider ETF'), pos('QDVEd_EQ', 'QDVE', 'XETRA', 31.0, 20, 45, 34.4, 'Wider ETF'), pos('SGLNl_EQ', 'SGLN', 'LSE', 6.1, 15, 4400, 4147, 'Gold'),
  pos('FOOl_EQ', 'FOO', 'LSE', -30.0, 10, 7000, 10000, 'Solo holdings'), pos('NOHISTl_EQ', 'NOHIST', 'LSE', 1.0, 5, 100, 99, 'Solo holdings'), pos('CORE_US_EQ', 'CORE', 'NASDAQ/NYSE', 3.0, 8, 24, 23.3, 'Solo holdings')];
const pinst = (ticker, value, invested, expected, current, qty) => ({ ticker, qty, expected, current, result: { priceAvgValue: value, priceAvgInvestedValue: invested, priceAvgResult: value - invested } });
const snap = { id: 3, total_value: 9100.5, cash: 210.2, invested: 8890, raw: { pies: [
  { name: 'Stocks ', instruments: [pinst('NVDA_US_EQ', 1500, 900, 0.3, 0.3, 12.5), pinst('ABC_US_EQ', 700, 800, 0.2, 0.1, 30), pinst('MID_US_EQ', 450, 370, 0.2, 0.1, 40)] },
  { name: 'Wider ETF', instruments: [pinst('VUSAa_EQ', 2600, 2400, 0.25, 0.62, 30), pinst('QDVEd_EQ', 300, 230, 0.10, 0.05, 20)] },
  { name: 'Gold', instruments: [pinst('SGLNl_EQ', 500, 470, 1, 1, 15)] },
  { name: 'Solo holdings', instruments: [pinst('FOOl_EQ', 400, 570, 0.5, 0.4, 10), pinst('CORE_US_EQ', 150, 140, 0.3, 0.2, 8)] }] } };
const ratings = { NVDA_US_EQ: { ticker: 'NVDA_US_EQ', analyst_count: 40, star_rating: 4 }, ABC_US_EQ: { ticker: 'ABC_US_EQ', analyst_count: 12, star_rating: 2 }, MID_US_EQ: { ticker: 'MID_US_EQ', analyst_count: 5, star_rating: 5 } };
const F = { hist, info, positions, snap, ratings: Object.values(ratings) };
function pyRun() {
  return JSON.parse(execFileSync('python3', ['-I', '-c', `
import os, sys, json, types
import pandas as pd
for k in ("SUPABASE_URL","SUPABASE_KEY"): os.environ[k]="x"
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s
    @property
    def info(self): return F["info"].get(self.s, {})
    def history(self, period=None, interval=None):
        d = F["hist"].get(self.s)
        if d is None: raise Exception("no data")
        return pd.DataFrame({"Close": d["c"], "High": d["h"], "Low": d["l"], "Volume": d["v"]}, index=pd.date_range("2025-11-18", periods=len(d["c"]), freq="B"))
yf.Ticker = Ticker
sys.modules["yfinance"] = yf
import services.profit_booking_service as pb
cap = {}
def sb(method, path, data=None, prefer=None):
    if method == "GET" and path.startswith("portfolio_snapshots"): return [F["snap"]]
    if method == "GET" and path.startswith("positions"): return F["positions"]
    if method == "GET" and path.startswith("analyst_ratings"): return F["ratings"]
    if method == "POST" and path.startswith("profit_booking?"): cap["rows"] = data
    elif method == "POST": cap["summary"] = data
    return []
pb.sb = sb
pb.run()
print("@@" + json.dumps(cap))
`], { input: JSON.stringify(F), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
}
function diff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${p}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return `${p}: length js ${a.length} vs py ${b.length}`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (k === 'updated_at') continue; const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return null; }
  return `${p}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
}
let py; try { py = pyRun(); } catch (e) { console.log(String(e.stderr || e).slice(-1800)); process.exit(2); }
const js = PB.compute({ snap, positions, ratings, hist, info, nowIso: 'X' });
ok('same holdings scored, same order', js.rows.map(r => r.ticker).join() === py.rows.map(r => r.ticker).join() && js.rows.length === 9);
for (const r of js.rows) { const d = diff(r, py.rows.find(x => x.ticker === r.ticker)); ok(`${r.display.padEnd(6)} score ${String(r.score).padStart(3)} ${r.action_level.padEnd(9)} identical to Python (breakdown, ladder, stop, sizing, signals, notes, action text)`, d === null); if (d) console.log('    first difference:', d); }
const ds = diff(js.summary, py.summary); ok('portfolio summary identical (regime, sectors, pies, limits, totals, notes)', ds === null); if (ds) console.log('    first difference:', ds);
const lv = new Set(js.rows.map(r => r.action_level)), kinds = new Set(js.rows.map(r => r.kind));
ok('fixture exercises trim / rebalance / reassess-or-hold, stock and ETF paths, trailing-exit breach, missing history', ['trim', 'rebalance'].every(x => lv.has(x)) && kinds.size === 2 && js.rows.some(r => r.signals.trail_breached) && js.rows.some(r => r.signals.drawdown_pct === null));
// run(): store + market client end to end
const tables = { portfolio_snapshots: [{ ...snap, created_at: '2026-11-18T08:00:00Z' }], positions: positions.map(p => ({ ...p, snapshot_id: 3 })), profit_booking: [{ ticker: 'OLD_US_EQ' }] };
const saved = {}, removed = [];
const store = { load: async k => tables[k] || [], put: async (k, rows) => { saved[k] = rows; if (k === 'profit_booking') tables.profit_booking = [...tables.profit_booking, ...rows]; }, remove: async (k, key) => removed.push(key) };
const symOf = {}; const market = { chart: async s => hist[s] ? { close: hist[s].c, high: hist[s].h, low: hist[s].l, volume: hist[s].v } : null, info: async s => info[s] || {} };
const res = await PB.run({ store, market, ratings: Object.values(ratings) }, new Date('2026-11-18T12:00:00Z'));
ok('run(): same result through the store/market path, stale row removed, summary saved', diff(res.rows.map(r => ({ ...r, trim_plan: r.trim_plan })), js.rows) === null && removed.join() === 'OLD_US_EQ' && saved.profit_booking_summary.length === 1);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

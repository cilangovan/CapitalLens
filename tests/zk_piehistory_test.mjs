// Run: node tests/zk_piehistory_test.mjs
// Browser pie history must equal services/pie_history_service.py (run with a fake yfinance over real pandas) on the same data.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js'); const P = require('../docs/zk/piehistory.js'), S = require('../docs/zk/symbols.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const TODAY = '2026-11-18', MS = 86400000, add = (s, n) => new Date(Date.parse(s) + n * MS).toISOString().slice(0, 10);
const bd = (a, b) => { const o = []; for (let d = a; d <= b; d = add(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); if (w && w < 6) o.push(d); } return o; };
const walk = (days, p0, p1, noise = 0.01) => days.map((_, i) => +(p0 + (p1 - p0) * i / (days.length - 1) + (rnd() - 0.5) * noise * p0).toFixed(4));

const DAYS = bd('2025-01-02', TODAY);
const prices = {}, fx = {}, fills = [], ccyRows = {}; let oid = 1;
const fill = (t, side, d, qty, px, ch) => fills.push({ ticker: t, side, status: 'FILLED', filled_at: d + 'T10:00:00Z', quantity: side === 'SELL' ? -qty : qty, net_value: +(qty * px).toFixed(2), id: String(oid++), channel: ch });
fx.USD = { dates: DAYS, close: walk(DAYS, 1.25, 1.32, 0.005) }; fx.EUR = { dates: DAYS, close: walk(DAYS, 1.15, 1.18, 0.004) };
// NVDA: 10:1 split on 2025-06-10, pre-split fills in old share counts; split-adjusted Yahoo closes
prices.NVDA = { dates: DAYS, close: walk(DAYS, 60, 190), splits: [['2025-06-10', 10]] }; ccyRows['NVDA_US_EQ'] = 'USD';
fill('NVDA_US_EQ', 'BUY', '2025-02-03', 4, 8, 'AUTOINVEST'); fill('NVDA_US_EQ', 'BUY', '2025-04-07', 2, 9, 'AUTOINVEST'); fill('NVDA_US_EQ', 'BUY', '2025-08-04', 3, 12, 'APP'); fill('NVDA_US_EQ', 'SELL', '2026-01-12', 1, 14, 'APP');
// ITWN: pence, all fills direct but 3 shares sit in a pie now -> apportioned
prices['ITWN.L'] = { dates: DAYS, close: walk(DAYS, 2800, 3300) }; ccyRows['ITWNl_EQ'] = 'GBX';
fill('ITWNl_EQ', 'BUY', '2025-03-03', 5, 28, 'APP'); fill('ITWNl_EQ', 'BUY', '2025-09-01', 4, 31, 'APP');
// SGLN: pounds, exact, direct only
prices['SGLN.L'] = { dates: DAYS, close: walk(DAYS, 38, 44) }; ccyRows['SGLNl_EQ'] = 'GBP';
fill('SGLNl_EQ', 'BUY', '2025-05-05', 10, 38.5, 'APP'); fill('SGLNl_EQ', 'BUY', '2026-02-02', 5, 41, 'APP');
// delisted: no price data, sold
ccyRows['OLDd_EQ'] = 'EUR'; fill('OLDd_EQ', 'BUY', '2025-03-10', 10, 20, 'APP'); fill('OLDd_EQ', 'SELL', '2025-07-10', 10, 25, 'APP');
// EUR on Amsterdam, pie only
prices['EURA.AS'] = { dates: DAYS, close: walk(DAYS, 50, 58) }; ccyRows['EURAa_EQ'] = 'EUR'; fill('EURAa_EQ', 'BUY', '2025-06-02', 6, 47, 'AUTOINVEST');
// JPY prices exist but no FX history: excluded; sold
prices.JPYX = { dates: DAYS, close: walk(DAYS, 3000, 3200) }; ccyRows['JPYx_EQ'] = 'JPY'; fill('JPYx_EQ', 'BUY', '2025-04-01', 5, 18, 'APP'); fill('JPYx_EQ', 'SELL', '2025-10-01', 5, 20, 'APP');
// history 100x too big vs what you traded at -> rescaled by the trade-price check; sold
prices['PENCE.L'] = { dates: DAYS, close: walk(DAYS, 40, 44) }; ccyRows['PENCEl_EQ'] = 'GBP'; fill('PENCEl_EQ', 'BUY', '2025-05-12', 100, 0.41, 'APP'); fill('PENCEl_EQ', 'SELL', '2025-12-01', 100, 0.43, 'APP');
fills.sort((a, b) => a.filled_at.localeCompare(b.filled_at) || a.id.localeCompare(b.id));
// weekend/holes in market data
for (const p of Object.values(prices)) for (let k = 0; k < 6; k++) p.close[Math.floor(rnd() * (DAYS.length - 5)) + 2] = null;

const qtyOf = (t, ch) => { const sp = t === 'NVDA_US_EQ' ? 10 : 1; return fills.filter(f => f.ticker === t && (!ch || (f.channel === 'AUTOINVEST') === (ch === 'pie'))).reduce((s, f) => s + (f.side === 'BUY' ? 1 : -1) * Math.abs(f.quantity) * (f.filled_at < '2025-06-10' ? sp : 1), 0); };
const last = (a) => a[a.length - 1];
const nvdaLivePps = last(prices.NVDA.close) / last(fx.USD.close), itwnPps = last(prices['ITWN.L'].close) / 100, euraPps = last(prices['EURA.AS'].close) / last(fx.EUR.close);
const positions = { 'NVDA_US_EQ': { exchange: 'NASDAQ/NYSE', quantity: qtyOf('NVDA_US_EQ') }, 'ITWNl_EQ': { exchange: 'LSE', quantity: 9 }, 'SGLNl_EQ': { exchange: 'LSE', quantity: 15 }, 'EURAa_EQ': { exchange: 'AMS', quantity: 6 } };
const pieQ = { NVDA_US_EQ: qtyOf('NVDA_US_EQ', 'pie'), ITWNl_EQ: 3, EURAa_EQ: 6 };
const inst = (t, pps, extra) => ({ ticker: t, qty: pieQ[t], expectedShare: 0.5, result: { priceAvgValue: pieQ[t] * pps * 1.02, priceAvgInvestedValue: pieQ[t] * pps * 0.9, priceAvgResult: pieQ[t] * pps * 0.12 } });
const snap = { id: 7, total_value: 4100.4, cash: 150.2, total_ppl: 230.5, created_at: TODAY + 'T08:00:00Z', raw: { account: { invested: 3500.25, ppl: 230.5, total: 4100.4 }, instrument_meta: {},
  pies: [{ name: 'Tech', instruments: [inst('NVDA_US_EQ', nvdaLivePps)] }, { name: 'Countries', instruments: [inst('ITWNl_EQ', itwnPps)] }, { name: 'Europe', instruments: [inst('EURAa_EQ', euraPps)] }, { name: 'Empty', instruments: [] }] } };
const fx_ = { prices, fx, fills, positions, ccyRows, snap, today: TODAY };

function pyRun() {
  return JSON.parse(execFileSync('python3', ['-I', '-c', `
import os, sys, json, types, datetime as dt
import pandas as pd
for k in ("SUPABASE_URL","SUPABASE_KEY"): os.environ[k]="x"
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
def frame(s):
    p = F["prices"][s]
    spl = [0.0]*len(p["dates"])
    for d, r in p.get("splits", []):
        if d in p["dates"]: spl[p["dates"].index(d)] = r
    return pd.DataFrame({"Close": [float("nan") if v is None else v for v in p["close"]], "Stock Splits": spl}, index=pd.to_datetime(p["dates"]))
def download(syms, **kw):
    frames = {s: frame(s) for s in syms if s in F["prices"]}
    if len(syms) > 1: return pd.concat(frames, axis=1)
    return frames[syms[0]] if frames else pd.DataFrame()
class Ticker:
    def __init__(self, name): self.ccy = name[3:6]
    def history(self, **kw):
        if self.ccy not in F["fx"]: raise Exception("no fx")
        f = F["fx"][self.ccy]; return pd.DataFrame({"Close": f["close"]}, index=pd.to_datetime(f["dates"]))
yf.download, yf.Ticker = download, Ticker
sys.modules["yfinance"] = yf
import services.pie_history_service as ph
class D(dt.date):
    @classmethod
    def today(cls): return cls.fromisoformat(F["today"])
ph.date = D
out = []
def sb(method, path, data=None, prefer=None):
    if method == "GET" and path.startswith("portfolio_snapshots"): return [F["snap"]]
    if method == "GET" and path.startswith("positions"): return [dict(ticker=t, **v) for t, v in F["positions"].items()]
    if method == "POST": out.append(data[0]); return True
    return True
def sb_all(path, page=1000):
    if path.startswith("t212_orders"): return [dict(f, channel=f["channel"]) for f in F["fills"]]
    if path.startswith("instruments"): return [{"ticker": t, "currency": c} for t, c in F["ccyRows"].items()]
    return []
ph.sb, ph.sb_all = sb, sb_all
ph.run()
print("@@" + json.dumps(out))
`], { input: JSON.stringify(fx_), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
}
function diff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${p}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return `${p}: length js ${a.length} vs py ${b.length}`; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], p + '.' + k); if (d) return d; } return null; }
  return `${p}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
}
let py; try { py = pyRun(); } catch (e) { console.log(String(e.stderr || e).slice(-1500)); process.exit(2); }
const js = P.compute({ snap, positions, fills, ccyOf: ccyRows, prices, fx, today: TODAY });
const norm = rows => Object.fromEntries(rows.map(r => [r.pie, r.series]));
ok('same set of series (pies, __DIRECT__, __SOLD__, __ALL__)', Object.keys(norm(js.rows)).sort().join() === Object.keys(norm(py.map(r => ({ pie: r.pie, series: r.series })))).sort().join());
for (const r of js.rows) { const d = diff(r.series, norm(py)[r.pie]); ok(`series "${r.pie}" identical to Python (dates, values, invested, per-ticker, verification, excluded)`, d === null); if (d) console.log('    first difference:', d); }
const all = js.rows.find(r => r.pie === '__ALL__').series;
ok('sanity: ≥ 400 days, positive value today, exclusions flagged (delisted, no FX), rescale note, apportioned split', all.dates.length > 400 && last(all.value) > 0 && all.excluded.length >= 2 && js.notes.length === 1 && all.verification.some(v => v.split === 'apportioned'));
// run(): gathers from the encrypted store + market client, saves rows, removes stale ones
const tables = { portfolio_snapshots: [snap], positions: Object.entries(positions).map(([t, v]) => ({ snapshot_id: 7, ticker: t, ...v })),
  t212_orders: fills.map(f => ({ ...f, raw: { order: { initiatedFrom: f.channel } } })), pie_history: [{ pie: 'Stale pie', series: {} }] };
const saved = {}, removed = [];
const store = { load: async k => tables[k] || [], put: async (k, rows) => { saved[k] = rows; }, remove: async (k, key) => removed.push(key) };
const symCcy = { NVDA: 'USD', 'ITWN.L': 'GBp', 'SGLN.L': 'GBP', 'EURA.AS': 'EUR', JPYX: 'JPY', 'PENCE.L': 'GBP' };
const market = { chart: async (sym, range) => sym.startsWith('GBP') && sym.endsWith('=X') ? (fx[sym.slice(3, 6)] ? { dates: fx[sym.slice(3, 6)].dates, close: fx[sym.slice(3, 6)].close } : null)
  : prices[sym] ? { dates: prices[sym].dates, close: prices[sym].close, splits: (prices[sym].splits || []).map(([date, ratio]) => ({ date, ratio })), currency: symCcy[sym] } : null };
const res = await P.run({ store, market }, new Date(TODAY + 'T12:00:00Z'));
ok('run(): saved a row per series and removed the stale pie row', saved.pie_history.length === js.rows.length && removed.join() === 'Stale pie');
ok('run(): whole-account series matches direct compute (currency taken from market data)', JSON.stringify(res.rows.find(r => r.pie === '__ALL__').series.value) === JSON.stringify(all.value));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

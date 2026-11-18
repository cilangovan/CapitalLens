// Run: node tests/zk_alertreport_test.mjs
// Browser daily alert report must equal services/alert_service.py (fake yfinance over real pandas, patched clock/DB/ntfy).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js'); require('../docs/zk/alertfmt.js');
const AR = require('../docs/zk/alertreport.js'), S = require('../docs/zk/symbols.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const NOW = '2026-11-18T12:30:00Z', sha = t => createHash('sha1').update(t).digest('hex').slice(0, 10);
function bizdays(endIso, n) { const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n) { if (d.getUTCDay() % 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const mk = (n, end, f, ccy, tail) => { const dates = bizdays(end, n); const close = dates.map((_, i) => +(f(i / (n - 1), i)).toFixed(4)); (tail || []).forEach((v, k) => { close[n - tail.length + k] = v; }); return { dates, close, currency: ccy }; };
const flat = b => (t, i) => b * (1 + 0.002 * Math.sin(i));
const END = '2026-11-17';
const charts = {
  'ITWN.L': mk(63, END, (t) => 3000 + 600 * t, 'GBp', [3600, 3100]),        // deep dip + sharp fall, pence
  'IPOL.L': mk(63, END, (t) => 3000 + 600 * t, 'GBp', [3590, 3100]),        // t212 in pounds
  'XDAX.L': (() => { const c = mk(63, END, flat(100), 'GBp'); c.close[5] = null; return c; })(),
  'IMIB.L': mk(63, END, flat(120), 'GBp'),
  'CS1.L': mk(63, '2026-11-12', flat(100), 'GBp'),                           // stale
  'IAEX.AS': mk(63, END, flat(100), 'EUR'),                                  // price mismatch with T212
  'VFEM.L': mk(63, END, (t, i) => i > 50 ? 10000 : 100, 'GBp'),             // unit jump
  'VEVE.L': mk(10, END, flat(100), 'GBp'),                                   // short
  'SSLN.L': null,                                                            // no history
  'SGLN.L': mk(63, END, flat(100), ''),                                      // currency unknown
  NVDA: mk(63, END, (t) => 200 - 10 * t, 'USD', [200, 181.5]),               // dip -9.25%, daily -9.25
  TSLA: mk(63, END, flat(300), 'USD', [300, 289]),                           // sharp daily fall
  AMZN: mk(63, END, flat(150), 'EUR'),
  ZZZ: null,
  'VWCE.DE': mk(63, END, flat(110), 'EUR'),
  'VUSA.L': mk(63, END, flat(80), 'GBP'),
  'NOPE.L': null,
  'GBPUSD=X': { dates: bizdays(END, 5), close: [1.31, 1.32, 1.3, 1.33, 1.3175], currency: 'GBP' },
};
const inst = (ticker, current, expected) => ({ ticker, current, expected });
const pies = [
  { name: 'Countries', value: 1000, instruments: [inst('ITWNl_EQ', 0.38, 0.25), inst('IPOLl_EQ', 0.10, 0.20), inst('XDAXl_EQ', 0.20, 0.20), inst('IMIBl_EQ', 0.20, 0.20), inst('CS1l_EQ', 0.03, 0.03), inst('IAEXa_EQ', 0.03, 0.03), inst('VFEMl_EQ', 0.02, 0.02), inst('VEVEl_EQ', 0.01, 0.01), inst('SSLNl_EQ', 0.01, 0.01), inst('SGLNl_EQ', 0.02, 0.02)] },
  { name: 'Stocks', value: 500, instruments: [inst('NVDA_US_EQ', 0.30, 0.30), inst('TSLA_US_EQ', 0.10, 0.20), inst('AMZN_US_EQ', 0.40, 0.40), inst('ZZZ_US_EQ', 0.20, 0.20)] },
  { name: 'Wider ETFs', value: 200, instruments: [inst('VWCEd_EQ', 1, 1)] },
  { name: 'Unverified', value: 100, instruments: [inst('NOPEl_EQ', 1, 1)] },
  { name: 'Dividend', value: 300, instruments: [inst('VUSAl_EQ', 0.7, 0.5)] },
  { name: 'Empty', value: 0, instruments: [inst('VUSAl_EQ', 1, 1)] },
  { name: 'Nothing', value: 50, instruments: [] },
];
const positions = [
  { ticker: 'ITWNl_EQ', exchange: 'LSE', current_price: 3100, avg_price: 2500 }, { ticker: 'IPOLl_EQ', exchange: 'LSE', current_price: 31.0, avg_price: 30 },
  { ticker: 'XDAXl_EQ', exchange: 'LSE', current_price: 100, avg_price: 0 }, { ticker: 'IMIBl_EQ', exchange: 'LSE', current_price: 120, avg_price: 80 },
  { ticker: 'CS1l_EQ', exchange: 'LSE', current_price: 100, avg_price: 90 }, { ticker: 'IAEXa_EQ', exchange: 'AMS', current_price: 140, avg_price: 90 },
  { ticker: 'VFEMl_EQ', exchange: 'LSE', current_price: 100, avg_price: 90 }, { ticker: 'VEVEl_EQ', exchange: 'LSE', current_price: 100, avg_price: 90 },
  { ticker: 'SSLNl_EQ', exchange: 'LSE', current_price: 100, avg_price: 90 }, { ticker: 'SGLNl_EQ', exchange: 'LSE', current_price: 100, avg_price: 90 },
  { ticker: 'NVDA_US_EQ', exchange: 'NASDAQ/NYSE', current_price: 181.5, avg_price: 100 }, { ticker: 'TSLA_US_EQ', exchange: 'NASDAQ/NYSE', current_price: 289, avg_price: 280 },
  { ticker: 'AMZN_US_EQ', exchange: 'NASDAQ/NYSE', current_price: 150, avg_price: 140 }, { ticker: 'ZZZ_US_EQ', exchange: 'NASDAQ/NYSE', current_price: 5, avg_price: 4 },
  { ticker: 'VWCEd_EQ', exchange: 'XETRA', current_price: 110, avg_price: 100 }, { ticker: 'VUSAl_EQ', exchange: 'LSE', current_price: 80, avg_price: 70 }, { ticker: 'NOPEl_EQ', exchange: 'LSE', current_price: 1 }];
const instrument_meta = { TSLA_US_EQ: { name: 'Tesla Inc' }, ZZZ_US_EQ: { name: 'Zed Corp' } };
const ratings = [{ ticker: 'IMIBl_EQ', star_rating: 4, buy_pct: 80.4, source: 'analyst' }, { ticker: 'NVDA_US_EQ', star_rating: 5, buy_pct: 90, source: 'trend' }, { ticker: 'TSLA_US_EQ', star_rating: 3, buy_pct: 49.5, source: 'analyst' }];
const day = '2026-11-18', keyOf = (p, flags) => `report:${p}:${day}:${sha(flags.slice().sort().join('|'))}`;
const todays = [{ id: 'old1', pie: 'Countries', dedup_key: 'report:Countries:2026-11-18:oldoldold0', alert_type: 'report', created_at: day + 'T07:00:00Z' },
  { id: 'old2', pie: 'Countries', dedup_key: 'x', alert_type: 'report', archived_at: day + 'T08:00:00Z', created_at: day + 'T07:00:00Z' },
  { id: 'same-archived', pie: 'Wider ETFs', dedup_key: keyOf('Wider ETFs', []), alert_type: 'report', dismissed_at: day + 'T08:00:00Z', created_at: day + 'T07:00:00Z' },
  { id: 'same-open', pie: 'Unverified', dedup_key: keyOf('Unverified', []), alert_type: 'report', created_at: day + 'T07:00:00Z' },
  { id: 'same-pushed', pie: 'Dividend', dedup_key: keyOf('Dividend', ['VUSA:overweight']), alert_type: 'report', created_at: day + 'T07:00:00Z' }];

const PY = `
import os, sys, json, types
import pandas as pd
os.environ.update(SUPABASE_URL="x", SUPABASE_KEY="x", NTFY_TOPIC="t")
sys.path.insert(0, ".")
F = json.loads(sys.stdin.read())
yf = types.ModuleType("yfinance")
class Ticker:
    def __init__(self, s): self.s = s; self._d = F["charts"].get(s)
    @property
    def history_metadata(self): return {"currency": self._d["currency"]} if self._d else {}
    def history(self, period=None, interval=None, auto_adjust=None):
        d = self._d
        if not d: return pd.DataFrame()
        return pd.DataFrame({"Close": pd.Series(d["close"], dtype="float64").values}, index=pd.to_datetime(d["dates"]))
yf.Ticker = Ticker; sys.modules["yfinance"] = yf
import services.alert_service as al
Real = al.datetime
class DT(Real):
    @classmethod
    def now(cls, tz=None): return Real.fromisoformat(F["now"].replace("Z", "+00:00")).astimezone(tz)
al.datetime = DT
def sb_get(path):
    if path.startswith("portfolio_snapshots"): return [F["snap"]]
    if path.startswith("positions"): return F["positions"]
    if path.startswith("analyst_ratings"): return F["ratings"]
    if path.startswith("alerts"): return F["todays"]
    return []
al.sb_get = sb_get
acts, pushes = [], []
def _sb(method, path, data=None, prefer=None):
    if method == "DELETE": acts.append({"op": "delete", "id": path.split("eq.")[1]})
    elif method == "PATCH": acts.append({"op": "patch", "id": path.split("eq.")[1], "title": data["title"], "body": data["body"]})
    else: acts.append({"op": "post", "pie": data["pie"], "title": data["title"], "body": data["body"], "dedup_key": data["dedup_key"]})
al._sb = _sb
al.ntfy_push = lambda title, body, priority="default", tags="bell": pushes.append({"title": title, "body": body, "priority": priority, "tags": tags})
al.run()
print("@@" + json.dumps({"actions": acts, "pushes": pushes}))
`;
const norm = o => JSON.parse(JSON.stringify(o));
async function scenario(label, snapIso) {
  const snap = { id: 1, created_at: snapIso, raw: { pies, instrument_meta } };
  const py = JSON.parse(execFileSync('python3', ['-I', '-c', PY], { input: JSON.stringify({ charts, snap, positions, ratings, todays, now: NOW }), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
  const js = await AR.compute({ snap, positions, ratings, todays, nowMs: Date.parse(NOW), getChart: async s => charts[s] || null, yahooSymbol: (t, ex) => S.t212ToYahoo(t, ex)[0],
    fx: async c => { const x = charts[`GBP${c}=X`]; return x ? x.close.filter(v => v !== null).slice(-1)[0] : null; } });
  const jsActs = js.actions.filter(a => a.op !== 'skip').map(a => a.op === 'post' ? { op: 'post', pie: a.pie, title: a.title, body: a.body, dedup_key: a.dedup_key } : a.op === 'patch' ? { op: 'patch', id: a.id, title: a.title, body: a.body } : { op: 'delete', id: a.id });
  const same = (x, y) => JSON.stringify(norm(x)) === JSON.stringify(norm(y));
  ok(`${label}: dashboard actions (delete/refresh/post) identical to Python, text byte for byte`, same(jsActs, py.actions));
  if (!same(jsActs, py.actions)) { const i = jsActs.findIndex((a, k) => !same(a, py.actions[k])); console.log('   JS :', JSON.stringify(jsActs[i]).slice(0, 700), '\n   PY :', JSON.stringify(py.actions[i]).slice(0, 700)); }
  ok(`${label}: phone pushes (title, text, priority, tag) identical to Python`, same(js.pushes, py.pushes));
  if (!same(js.pushes, py.pushes)) console.log('   JS :', JSON.stringify(js.pushes).slice(0, 500), '\n   PY :', JSON.stringify(py.pushes).slice(0, 500));
  return { js, py, jsActs };
}
const A = await scenario('fresh snapshot', '2026-11-18T08:00:00Z');
const B = await scenario('3-day-old snapshot', '2026-11-15T09:00:00Z');
const posts = A.jsActs.filter(a => a.op === 'post'), all = posts.map(p => p.body).join('\n');
ok('covers every branch: overweight, underweight, deep dip, sharp fall, profit target, clear holdings', ['overweight', 'underweight', 'deep dip', 'sharp daily fall', 'profit target', 'no threshold crossed'].every(w => all.includes(w)));
ok('covers every data-coverage reason (stale, price mismatch, unit jump, short, none, no currency)', ['is stale', "Trading 212's live quote", 'inconsistent price units', 'only 10 sessions', 'no daily price history', 'listing currency unknown'].every(w => all.includes(w)));
ok('covers GBP conversion line, FX-less currency, analyst and trend rows', all.includes('(≈ £') && all.includes('Analyst view') && all.includes('Trend rating'));
ok('covers all report titles: flags, no threshold crossed, data unverified', A.js.actions.some(a => a.title && a.title.startsWith('⚠️')) && A.js.actions.some(a => a.title && a.title.startsWith('✅')) && A.js.actions.some(a => a.title && a.title.startsWith('❔')));
ok('archived/dismissed report left alone; refreshed-in-place report not pushed again; unfunded and empty pies skipped', A.js.actions.some(a => a.op === 'skip' && a.pie === 'Wider ETFs') && A.js.actions.some(a => a.op === 'patch' && a.id === 'same-pushed') && !A.js.pushes.some(p => p.title.includes('Dividend')) && !A.js.actions.some(a => a.pie === 'Empty' || a.pie === 'Nothing'));
ok('stale-snapshot note appears only for the 3-day-old snapshot', B.jsActs.map(a => a.body || '').join('').includes('not live-verified (snapshot 76h old)') && !all.includes('not live-verified'));

// run(): end to end through the encrypted store
const tables = { portfolio_snapshots: [{ id: 's1', created_at: '2026-11-18T08:00:00Z', raw: { pies, instrument_meta } }], positions: positions.map(p => ({ ...p, snapshot_id: 's1' })), alerts: todays.map(t => ({ ...t })) };
const puts = [], removed = [], pushed = [];
const store = { load: async k => tables[k] || [], put: async (k, r) => puts.push(...r.map(x => ({ k, ...x }))), remove: async (k, id) => removed.push(id) };
const market = { chart: async s => charts[s] || null };
const out = await AR.run({ store, market, ratings, notify: async p => pushed.push(p) }, new Date(NOW));
ok('run(): reads encrypted snapshot/positions/alerts, writes reports, removes replaced ones, hands pushes to notify', puts.filter(p => p.alert_type === 'report').length === A.jsActs.filter(a => a.op === 'post' || a.op === 'patch').length && puts.some(p => p.id === 'same-pushed' || p.id === 'same-open') && removed.includes('old1') && pushed.length === out.pushes.length && pushed.length >= 2);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

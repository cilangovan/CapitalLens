// Run: node tests/zk_returns_test.mjs
// Browser returns calculation must equal services/returns_service.py on the same data.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const R = require('../docs/zk/returns.js');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const TODAY = '2026-11-18', addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
function fixture(kind) {
  const start = '2024-03-04', txns = [], divs = [], orders = [], dates = [], value = [];
  if (kind !== 'nodeposit') for (let m = 0; m < 33; m++) { const d = addDays(start, m * 30); txns.push({ type: 'DEPOSIT', amount: 200 + Math.floor(rnd() * 400), date_time: d + 'T09:00:00Z' }); }
  txns.push({ type: 'WITHDRAW', amount: -300, date_time: '2025-06-10T10:00:00Z' }, { type: 'INTEREST_ON_CASH', amount: 1.23, date_time: '2025-07-01T00:00:00Z' }, { type: 'FEE', amount: -0.5, date_time: '2025-08-02T00:00:00Z' }, { type: 'TRANSFER', amount: 5, date_time: '2025-09-02T00:00:00Z' });
  for (let i = 0; i < 150; i++) { const d = addDays(start, 2 + Math.floor(rnd() * 800)), sell = rnd() < 0.3; orders.push({ side: sell ? 'SELL' : 'BUY', net_value: (sell ? 1 : -1) * (20 + rnd() * 90), realised_pnl: sell ? (rnd() - 0.3) * 40 : (rnd() < 0.5 ? 0 : null), filled_at: d + 'T10:00:01Z' }); }
  for (let i = 0; i < 40; i++) divs.push({ amount: Math.round(rnd() * 900) / 100, paid_on: addDays(start, 30 + Math.floor(rnd() * 700)) + 'T00:00:00Z' });
  let v = 0, d = new Date(start + 'T00:00:00Z'); while (d.toISOString().slice(0, 10) <= TODAY) { if (d.getUTCDay() % 6) { v = Math.max(100, v * (1 + (rnd() - 0.47) * 0.01) + (rnd() < 0.05 ? 150 : 0)); dates.push(d.toISOString().slice(0, 10)); value.push(rnd() < 0.02 ? null : Math.round(v * 100) / 100); } d = new Date(+d + 86400000); }
  const snap = { total_value: 9000.5, cash: 120.25, raw: { account: { total: 9100.75, free: 100.5, blocked: 1.25, pieCash: 3.5, ppl: 480.126 } } };
  return { snap, txns, divs, orders: kind === 'nohist' ? orders.filter(o => o.side === 'SELL') : orders, hist: kind === 'nohist' ? null : { series: { dates, value } }, today: TODAY };
}
const KEYS = ['xirr_pct', 'annualised_pct', 'total_return_pct', 'yearly_breakdown', 'monthly_breakdown', 'details'];
function pyRun(fx) {
  return JSON.parse(execFileSync('python3', ['-I', '-c', `
import os, sys, json, datetime as dt
for k in ("SUPABASE_URL","SUPABASE_KEY"): os.environ[k]="x"
sys.path.insert(0, ".")
import services.returns_service as rs
fx = json.loads(sys.stdin.read())
class D(dt.date):
    @classmethod
    def today(cls): return cls.fromisoformat(fx["today"])
rs.date = D
out = {}
def sb(method, path, data=None, prefer=None):
    if method == "GET" and path.startswith("portfolio_snapshots"): return [fx["snap"]]
    if method == "GET" and path.startswith("pie_history"): return [fx["hist"]] if fx["hist"] else []
    if method == "POST": out["row"] = data[0]; return True
    return True
def sb_all(path, page=1000):
    return fx["txns"] if "t212_transactions" in path else fx["divs"] if "t212_dividends" in path else fx["orders"]
rs.sb, rs.sb_all = sb, sb_all
rs.run()
print("@@" + json.dumps(out.get("row")))
`], { input: JSON.stringify(fx), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }).split('@@').pop());
}
// recursive compare: exact, or reports first difference
function diff(a, b, path = '') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9 ? null : `${path}: js ${a} vs py ${b}`;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], path + '.' + k); if (d) return d; } return null; }
  return `${path}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`;
}
for (const kind of ['normal', 'nohist']) {
  const fx = fixture(kind), py = pyRun(fx), js = R.compute({ ...fx, nowIso: 'X' }).row;
  const strip = r => Object.fromEntries(KEYS.map(k => [k, k === 'details' ? { ...r[k], as_of: 0 } : r[k]]));
  const d = diff(strip(js), strip(py));
  ok(`${kind}: whole returns_summary row identical to Python (XIRR, TWR, periods, yearly, monthly, series, breakdown)`, d === null);
  if (d) console.log('    first difference:', d);
  ok(`${kind}: sanity — XIRR ${js.xirr_pct}%, 1Y profit ${js.details.periods.find(p => p.label === '1Y').profit}, ${Object.keys(js.monthly_breakdown).length} months`, js.xirr_pct !== null && Object.keys(js.monthly_breakdown).length > 20);
}
ok('python round() tie behaviour matched (0.125 -> 0.12, 0.375 -> 0.38, 2.675 -> 2.67)', R.pyRound(0.125, 2) === 0.12 && R.pyRound(0.375, 2) === 0.38 && R.pyRound(2.675, 2) === 2.67);
ok('no transactions -> clear error, no crash', R.compute({ ...fixture('normal'), txns: [], nowIso: 'X' }).error !== undefined);
ok('no deposits -> clear error instead of a crash', R.compute({ ...fixture('nodeposit'), txns: [], nowIso: 'X' }).error !== undefined);
// end to end through the store interface
const kinds = { portfolio_snapshots: [{ id: 'a', created_at: '2026-11-18T08:00:00Z', ...fixture('normal').snap }], t212_transactions: fixture('normal').txns, t212_dividends: fixture('normal').divs,
  t212_orders: fixture('normal').orders.map(o => ({ ...o, status: 'FILLED' })), pie_history: [{ pie: '__ALL__', series: fixture('normal').hist.series }, { pie: 'Other', series: {} }] };
const saved = {}; const fake = { load: async k => kinds[k] || [], put: async (k, rows) => { saved[k] = rows; } };
const res = await R.run(fake, new Date('2026-11-18T12:00:00Z'));
ok('run(): reads the store, saves one returns_summary row with XIRR', res.row && saved.returns_summary.length === 1 && saved.returns_summary[0].xirr_pct === res.row.xirr_pct);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

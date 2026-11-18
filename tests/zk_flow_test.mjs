// Run: node tests/zk_flow_test.mjs
// Per-customer portfolio actions in the browser equal institutional_flow_service.build_portfolio_actions;
// public mode of the central job reads no customer data.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const FL = require('../docs/zk/flow.js'), HD = (require('../docs/zk/returns.js'), require('../docs/zk/holdingdecision.js'));
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const markets = [{ region: 'USA', score: 82, label: 'NASDAQ / S&P 500' }, { region: 'UK', score: 50, label: 'FTSE' }, { region: 'Europe', score: 30, label: 'STOXX' }];
const positions = [['NVDA_US_EQ', 'Stocks', 'NASDAQ/NYSE'], ['AMD_US_EQ', 'Stocks', 'NYSE'], ['ITWNl_EQ', 'Countries', 'LSE'], ['XDAXl_EQ', 'Countries', 'XETRA'], ['IAEXa_EQ', 'Countries', 'AMS'], ['VWCEd_EQ', null, 'XETRA'], ['VUSAl_EQ', '', 'LSE'],
  ['ODD_XX_EQ', 'Stocks', 'TOKYO'], ['CRYPT_EQ', 'Crypto', 'LSE'], ['NVDA_US_EQ', 'Solo holdings', 'NASDAQ/NYSE'], ['EUR_EQ', 'Zed', 'EURONEXT'], ['NOEX_EQ', 'Stocks', undefined]].map(([ticker, pie, exchange]) => ({ ticker, pie, exchange }));
const PRE = `
import os, sys, types, json
os.environ.update(SUPABASE_URL="x", SUPABASE_KEY="x")
sys.path.insert(0, ".")
yf = types.ModuleType("yfinance"); sys.modules["yfinance"] = yf
F = json.loads(sys.stdin.read())
`;
const run = (code, F) => JSON.parse(execFileSync('python3', ['-I', '-c', PRE + code], { input: JSON.stringify(F), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'pipe'] }).split('@@').pop());
const py = run(`
import services.institutional_flow_service as fl
pos = {}
for p in F["positions"]: pos[p["ticker"]] = {k: v for k, v in p.items()}
print("@@" + json.dumps(fl.build_portfolio_actions(F["markets"], {}, pos)))
`, { markets, positions });
const js = FL.portfolioActions(markets, positions);
ok('portfolio actions identical to Python (grouping, sorting, ADD/HOLD/REDUCE text, unknown exchanges skipped, duplicate tickers, empty pie names)', JSON.stringify(js) === JSON.stringify(py) && js.length >= 6);
ok('covers all three action texts', ['ADD gradually', 'HOLD', 'REDUCE or AVOID'].every(w => js.some(a => a.action.startsWith(w))));
ok('same region mapping as the holding-decision engine', ['NASDAQ/NYSE', 'LSE', 'XETRA', 'AMS', 'EURONEXT', 'TOKYO', ''].every(e => FL.regionOf(e) === (e === 'NASDAQ/NYSE' ? 'USA' : e === 'LSE' ? 'UK' : ['XETRA', 'AMS', 'EURONEXT'].includes(e) ? 'Europe' : null)));
// central job in public mode
const pub = run(`
os.environ["FLOW_PUBLIC_MODE"] = "1"
import services.institutional_flow_service as fl
reads, up, scored = [], [], []
fl.sb_get = lambda t, q="": reads.append(t) or [{"ticker": "SECRET", "pie": "P", "exchange": "LSE"}]
fl.sb_upsert = lambda t, row, conflict="report_date": up.append(row)
fl.time.sleep = lambda s: None
fl.analyse_market = lambda k, c: scored.append(k) or {"region": k, "label": c["label"], "score": 70 if k == "USA" else 50, "signal": "s", "action": "a", "breakdown": {"institutional_accumulation": {"note": "n"}, "sentiment": {"note": "m"}}}
fl.analyse_sectors = lambda: {"leaders": [], "laggards": []}
fl.run()
print("@@" + json.dumps({"reads": reads, "scored": scored, "actions": up[0]["portfolio_actions"], "positionsLeak": "SECRET" in json.dumps(up)}))
`, {});
ok('public mode reads no customer table, scores all three markets, publishes no per-customer actions', pub.reads.length === 0 && pub.scored.join() === 'USA,UK,Europe' && pub.actions === '[]' && !pub.positionsLeak);
const legacy = run(`
import services.institutional_flow_service as fl
reads, scored = [], []
fl.sb_get = lambda t, q="": reads.append(t) or [{"ticker": "T", "pie": "P", "exchange": "LSE"}]
fl.sb_upsert = lambda t, row, conflict="report_date": None
fl.time.sleep = lambda s: None
fl.analyse_market = lambda k, c: scored.append(k) or {"region": k, "label": c["label"], "score": 70, "signal": "s", "action": "a", "breakdown": {"institutional_accumulation": {"note": "n"}, "sentiment": {"note": "m"}}}
fl.analyse_sectors = lambda: {"leaders": [], "laggards": []}
fl.run()
print("@@" + json.dumps({"reads": reads, "scored": scored}))
`, {});
ok('default (legacy) behaviour unchanged: still reads positions and scores only held regions', legacy.reads.includes('positions') && legacy.scored.join() === 'UK');
// latest(): reads the shared table with the user token and builds this customer's actions
let url = null; const call = async (u, o, t) => { url = [u, t]; return { ok: true, json: async () => [{ report_date: '2026-11-15', markets: JSON.stringify(markets), sector_rotation: { leaders: [] }, opportunities: [], cautions: '[]', summary: 's' }] }; };
const rep = await FL.latest(call, 'JWT', positions);
ok('latest(): reads shared report with signed-in token, parses jsonb text, adds only this customer\'s actions', url[0].includes('institutional_flow_reports') && url[0].includes('limit=1') && url[1] === 'JWT' && rep.markets.length === 3 && rep.portfolio_actions.length === js.length && Array.isArray(rep.cautions));
ok('region scores from this report feed the holding-decision engine', HD.regionScores(rep.markets).USA === 82);
ok('no report yet -> null', (await FL.latest(async () => ({ ok: true, json: async () => [] }), 't', [])) === null);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

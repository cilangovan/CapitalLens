// Run: node tests/zk_live_persist_test.mjs - the LIVE feed survives a page reload until logout / inactivity timeout / Stop.
// Regression (24 Nov): refreshing the browser dropped LIVE and the key had to be re-entered. Credentials are kept only in this tab's
// sessionStorage, encrypted under the data key (never plaintext, never DB / localStorage); logout + the 45-min inactivity logout clear it.
import { readFileSync } from 'node:fs'; import vm from 'node:vm'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ZK = require('../docs/js/zkcrypto.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const R = p => readFileSync(new URL(p, import.meta.url), 'utf8'), tools = R('../docs/zkapp/zkapp-tools.js'), auth = R('../docs/zkapp/zkapp-auth.js');
const acct = await ZK.createAccount('correct horse battery staple'), UID = '33333333-3333-3333-3333-333333333333';
const mkStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), dump: () => JSON.stringify([...m]) }; };
function page(ss, dk) {                              // one "page load": fresh JS state, same tab sessionStorage
  const els = {}, el = id => els[id] || (els[id] = { id, style: {}, textContent: '', value: '', remove() {} }), ticks = [];
  const sb = { window: { addEventListener() {} }, document: { getElementById: el, querySelector: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } }, console, Date, setTimeout, setInterval: () => 1, clearInterval() {}, sessionStorage: ss, localStorage: mkStorage(), ZK, ZKCTX: dk ? { dk, uid: UID, store: {}, market: {}, call: async () => ({}), token: 't' } : null };
  vm.createContext(sb); vm.runInContext(tools, sb); sb.zkLiveTick = async () => { ticks.push([vm.runInContext('_liveKey', sb), vm.runInContext('_liveSec', sb)]); };
  return { sb, els, ticks, live: () => vm.runInContext('_liveKey', sb) };
}
const wait = () => new Promise(r => setTimeout(r, 30));
const ss = mkStorage();
const p1 = page(ss, acct.dk); p1.sb.zkLiveStart('KEY-123', 'SEC-456'); await wait();
ok('starting live keeps the credentials for a reload (sessionStorage)', ss.getItem('zk_live') !== null);
ok('...but never in plaintext, and never in localStorage', !ss.dump().includes('KEY-123') && !ss.dump().includes('SEC-456') && p1.sb.localStorage.dump() === '[]');
const p2 = page(ss, acct.dk); ok('after a reload nothing is live yet', p2.live() === null);
const resumed = await p2.sb.zkLiveResume();
ok('page reload: live comes back by itself with the same credentials, no re-entry', resumed === true && p2.live() === 'KEY-123' && p2.ticks.length === 1 && p2.ticks[0][1] === 'SEC-456');
const p3 = page(ss, acct.dk); await p3.sb.zkLiveResume(); await wait();
ok('a second reload still resumes (resume does not consume the stored credentials)', p3.live() === 'KEY-123' && ss.getItem('zk_live') !== null);
const other = await ZK.createAccount('another passphrase entirely'), p4 = page(ss, other.dk);
ok('credentials cannot be opened with a different data key (and are discarded)', (await p4.sb.zkLiveResume()) === false && p4.live() === null && ss.getItem('zk_live') === null);
const ss2 = mkStorage(), q1 = page(ss2, acct.dk); q1.sb.zkLiveStart('K', 'S'); await wait(); q1.sb.zkLiveStop();
ok('Stop forgets the credentials: a reload stays off', ss2.getItem('zk_live') === null && (await page(ss2, acct.dk).sb.zkLiveResume()) === false);
const q2 = page(mkStorage(), acct.dk); ok('no saved credentials: reload does nothing', (await q2.sb.zkLiveResume()) === false && q2.live() === null);
const q3 = page(ss2, null); ok('signed out (no data key): never resumes', (await q3.sb.zkLiveResume()) === false);
ok('logout (also the 45-min inactivity logout) clears all sessionStorage and stops live', /function logout\(\)[\s\S]{0,400}zkLiveStop\(\)[\s\S]{0,300}sessionStorage\.clear\(\)/.test(auth) && /setTimeout\(\(\) => \{[^}]*t212_timeout[^}]*\}[^;]*logout\(\)/.test(auth));
ok('sign-in restores the session, then resumes live before the auto re-analysis', /zkLiveResume\(\)[^\n]*\n\s*if \(typeof zkAutoRefresh/.test(auth));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

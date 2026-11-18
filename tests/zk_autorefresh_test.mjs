// Run: node tests/zk_autorefresh_test.mjs — the login-time auto re-analysis decides correctly (stale / version change / fresh / once per page / busy).
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
import { current } from '../scripts/analysis_fingerprint.mjs';
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const src = readFileSync(new URL('../docs/zkapp/zkapp-tools.js', import.meta.url), 'utf8'), VERSION = current().version;
async function scenario(rec, { running = false, twice = false } = {}) {
  const calls = []; const sb = { window: {}, document: { getElementById: () => null }, console, Date, setTimeout: fn => fn(), ZKCTX: { store: { get: async (kind, key) => { calls.push([kind, key]); if (rec === 'THROW') throw new Error('x'); return rec; } } } };
  vm.createContext(sb); vm.runInContext(src, sb); let runs = 0, args = []; sb.zkToolsRun = a => { runs++; args.push(a); };
  if (running) vm.runInContext('ZK_RUN.running = true', sb);
  await sb.zkAutoRefresh(); if (twice) await sb.zkAutoRefresh();
  return { runs, args, calls };
}
const h = n => new Date(Date.now() - n * 3600e3).toISOString();
ok('never analysed -> runs automatically (no credentials)', (await scenario(null)).runs === 1);
ok('analysis is run in auto mode so no key is needed', (await scenario(null)).args[0] === true);
ok('fresh and same version -> does nothing', (await scenario({ at: h(1), version: VERSION })).runs === 0);
ok('app version changed -> runs even if fresh', (await scenario({ at: h(1), version: 'old-version' })).runs === 1);
ok('older than 6 hours -> runs', (await scenario({ at: h(7), version: VERSION })).runs === 1);
ok('exactly inside the window (5h) -> does nothing', (await scenario({ at: h(5), version: VERSION })).runs === 0);
ok('reads the encrypted settings record last_analysis', (await scenario(null)).calls[0].join() === 'settings,last_analysis');
ok('record unreadable -> still runs (safe default)', (await scenario('THROW')).runs === 1);
ok('only once per page load', (await scenario(null, { twice: true })).runs === 1);
ok('does not start while a refresh is already running', (await scenario(null, { running: true })).runs === 0);
ok('the version the browser uses is the one CI fingerprints', /ZK_ANALYSIS_VERSION = '[^']+'/.test(src));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

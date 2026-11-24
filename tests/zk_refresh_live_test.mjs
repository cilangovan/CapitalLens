// Run: node tests/zk_refresh_live_test.mjs — ONE button: "Refresh now" with a key refreshes AND turns the live feed on (no separate Start button).
// Regression (24 Nov): two buttons (Refresh now + Start live feed) confused the owner; live now follows a manual refresh automatically.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const src = readFileSync(new URL('../docs/zkapp/zkapp-tools.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../scripts/build_zkapp.py', import.meta.url), 'utf8');
function scenario({ key = 'K', sec = 'S', auto, pipelineOk = true } = {}) {
  const els = {}; const el = id => els[id] || (els[id] = { id, value: '', textContent: '', checked: false, style: {}, disabled: false, scrollTop: 0, scrollHeight: 0, remove() {} });
  els['zk-key'] = Object.assign(el('zk-key'), { value: key }); els['zk-sec'] = Object.assign(el('zk-sec'), { value: sec }); el('zk-tools').style.display = 'flex';
  const started = []; const sb = { window: { addEventListener() {}, removeEventListener() {} }, document: { getElementById: el, querySelector: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } }, console, Date, setTimeout, setInterval: () => 1, clearInterval() {},
    ZKCTX: { store: { put: async () => {} }, market: {}, call: async () => ({}), token: 't' }, ZKPipeline: { create: () => ({ run: async () => ({ ok: pipelineOk, results: pipelineOk ? [] : [{ name: 'x', ok: false }] }) }) },
    ZKMonitor: {}, RELAY_URL: 'http://relay', ZK_ANALYSIS_VERSION: 'v', loadTab() {}, _cache: {} };
  vm.createContext(sb); vm.runInContext(src, sb);
  sb.zkShowChanges = () => {}; sb.zkLiveTick = async () => {};                       // the tick itself is tested elsewhere; here we only watch what starts it
  const real = sb.zkLiveStart; sb.zkLiveStart = (k, s) => { started.push([k, s]); return real(k, s); };
  return { sb, els, started, run: () => sb.zkToolsRun(auto) };
}
{ const s = scenario(); await s.run(); ok('manual Refresh now with key + secret starts the live feed with those credentials', s.started.length === 1 && s.started[0][0] === 'K' && s.started[0][1] === 'S');
  ok('the key and secret boxes are emptied (credentials never stay on the page)', s.els['zk-key'].value === '' && s.els['zk-sec'].value === '');
  ok('the Stop button appears once live', s.els['zk-live-btn'] && s.els['zk-live-btn'].style.display === '' && /Stop/.test(s.els['zk-live-btn'].textContent));
  ok('the status says live is on', /Live: on/.test(s.els['zk-status'].textContent)); }
{ const s = scenario({ auto: true }); await s.run(); ok('the automatic login re-analysis never starts the live feed', s.started.length === 0); }
{ const s = scenario({ key: '', sec: '' }); await s.run(); ok('refresh with no key (re-analyse stored data only) does not start live', s.started.length === 0); }
{ const s = scenario({ pipelineOk: false }); await s.run(); ok('a refresh with problems still goes live (the live tick reports a refused key in red)', s.started.length === 1); }
{ const s = scenario(); await s.run(); s.sb.zkLiveStop(); ok('Stop hides the button and says how to turn it back on', s.els['zk-live-btn'].style.display === 'none' && /Refresh now/.test(s.els['zk-live-status'].textContent)); }
ok('the panel has no "Start live feed" button any more (one button)', !/Start live feed/.test(src) && !/Start live feed<\/button>/.test(page));
ok('the Stop button starts hidden until live', /id="zk-live-btn"[^>]*display:none/.test(page));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

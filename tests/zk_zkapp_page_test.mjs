// Run: node tests/zk_zkapp_page_test.mjs
// Static + smoke checks of the generated private dashboard page (no browser available here; real-browser check is a separate step).
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const html = readFileSync(new URL('../docs/zkapp/index.html', import.meta.url), 'utf8'), dir = new URL('../docs/zkapp/', import.meta.url);
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('http'));
ok('every script the page loads exists', srcs.every(s => existsSync(new URL(s, dir))));
const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1], conn = /connect-src ([^;]+)/.exec(csp)[1].split(' ');
ok('CSP lets the page reach only Supabase (demo), the relay and ntfy', conn.join() === "'self',https://ggprfdetivzekjxlpvyq.supabase.co,https://capitallens-relay.itsme-daf.workers.dev,https://ntfy.sh" && /default-src 'none'/.test(csp) && !/legacy|workers\.dev\/(?!$)/.test(csp.replace('capitallens-relay.itsme-daf.workers.dev', '')));
ok('no demo shell or legacy worker left in the page', !/demo-(auth|shim)|capitallens-proxy/.test(html + readFileSync(new URL('zkapp-auth.js', dir), 'utf8')));
const order = srcs.map(s => s.split('/').pop());
const before = (a, b) => order.indexOf(a) >= 0 && order.indexOf(a) < order.indexOf(b);
ok('load order: api.js < zk modules < shell; shell before dashboards that call it; router last', before('api.js', 'zkcrypto.js') && before('zkcrypto.js', 'store.js') && before('shim.js', 'zkapp-auth.js') && before('postgrest.js', 'shim.js') && before('zkapp-auth.js', 'overview.js') && order[order.length - 1] === 'router.js');
// smoke: run every script in order inside a sandbox with a stub DOM
const stub = new Proxy(function () {}, { get: (t, k) => k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false } : k === 'style' ? {} : k === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, construct: () => stub });
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, Response, Request, Headers, atob, btoa, Promise, JSON, Math, Date, Object, Array, String, Number, Set, Map, Uint8Array, Error, Intl, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { search: '', reload() {} }, history: {}, navigator: {}, Chart: function () {}, alert() {}, fetch: async () => new Response('[]') };
ctx.MutationObserver = function () { this.observe = () => {}; this.disconnect = () => {}; }; ctx.IntersectionObserver = ctx.MutationObserver; ctx.requestAnimationFrame = f => setTimeout(f, 0); ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; ctx.window = ctx; ctx.self = ctx; ctx.top = ctx; ctx.globalThis = ctx; ctx.document = new Proxy({ addEventListener() {}, getElementById: () => stub, querySelector: () => stub, querySelectorAll: () => [], createElement: () => stub, body: stub, documentElement: stub }, { get: (t, k) => k in t ? t[k] : stub });
ctx.Response.prototype.json = Response.prototype.json; vm.createContext(ctx);
let err = null; for (const s of srcs) { try { vm.runInContext(readFileSync(new URL(s, dir), 'utf8'), ctx, { filename: s }); } catch (e) { err = `${s}: ${e.message}`; break; } }
ok('all page scripts load in order without errors', err === null); if (err) console.log('   ', err);
const need = ['ZK', 'ZKStore', 'ZKMarket', 'ZKT212', 'ZKMonitor', 'ZKAnalystRatings', 'ZKReturns', 'ZKPieHistory', 'ZKProfitBooking', 'ZKStrategy', 'ZKHoldingDecision', 'ZKValueBuy', 'ZKWatchlist', 'ZKWatchlistOps', 'ZKAlertReport', 'ZKFlow', 'ZKNotify', 'ZKQuery', 'ZKShim', 'ZKPipeline', 'ZKSymbols', 'ZKAlertFmt'];
const missing = need.filter(n => typeof vm.runInContext(`typeof ${n}`, ctx) !== 'string' || vm.runInContext(`typeof ${n}`, ctx) === 'undefined'); ok('all zero-knowledge modules are available to the page', missing.length === 0); if (missing.length) console.log('   missing:', missing);
// every inline handler in the markup resolves to a function
const handlers = new Set([...html.matchAll(/on(?:click|change|keydown|input)="(?:if\([^)]*\))?\s*([A-Za-z_]\w*)\(/g)].map(m => m[1])), notFn = [...handlers].filter(h => { try { return vm.runInContext(`typeof ${h}`, ctx) !== 'function'; } catch (e) { return true; } });
ok(`all ${handlers.size} inline handlers (doLogin, zkToolsRun, showTab …) are defined`, notFn.length === 0); if (notFn.length) console.log('   undefined:', notFn);
ok('Trading 212 credential fields are password inputs without autofill', /id="zk-key" type="password"[^>]*autocomplete="off"/.test(html) && /id="zk-sec" type="password"[^>]*autocomplete="off"/.test(html));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

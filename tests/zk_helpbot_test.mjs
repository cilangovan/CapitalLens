// Run: node tests/zk_helpbot_test.mjs - Help assistant client (epic #54): same safety rules as the worker, honest errors, safe links, on every dashboard.
import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const R = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
globalThis.SESSION_TOKEN = 'tok.en.123';
const H = require('../docs/js/helpbot.js');

ok('keys, secrets, card numbers and "my password is" are blocked in the browser (same rules as the server)', H.hbLooksSensitive('key ' + 'a'.repeat(40)) && H.hbLooksSensitive('card 4111 1111 1111 1111') && H.hbLooksSensitive('my password is hunter2') && !H.hbLooksSensitive('How do I turn on the live feed? Dip Planner, 1 pie, £200') && !H.hbLooksSensitive('order 1234 5678'));
ok('source links must be relative portal pages (external or protocol-relative links are dropped)', H.hbSourceUrl('https://x/help/', 'menus/strategy.html#a') === 'https://x/help/menus/strategy.html#a' && H.hbSourceUrl('https://x/help/', 'https://evil.example') === null && H.hbSourceUrl('https://x/help/', '//evil.example') === null && H.hbSourceUrl('https://x/help/', 'javascript:alert(1)') === null);
ok('portal base comes from the footer Documentation link, with a safe default', H.hbPortalBase({ querySelector: () => ({ href: 'https://s/CapitalLens/zkapp/../help/' }) }) === 'https://s/CapitalLens/zkapp/../help/' && /\/help\/$/.test(H.hbPortalBase({ querySelector: () => null })));
const msgs = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }, { role: 'assistant', text: 'boom', err: true }, { role: 'user', text: 'q2' }, { role: 'assistant', text: 'a2' }, { role: 'user', text: 'q3' }];
const h = H.hbHistory(msgs);
ok('history sent = last 4 real turns only (errors never sent), kept in the browser', h.length === 4 && h.at(-1).content === 'q3' && !h.some(x => x.content === 'boom'));
ok('error texts are plain and never technical', [401, 429, 503, 400, 500, 0].every(s => { const t = H.hbErrorText(s, null); return t.length > 10 && !/undefined|stack|Error:|worker|cloudflare|AI\b/i.test(t); }) && /do not type keys/.test(H.hbErrorText(400, { error: 'sensitive', message: 'Please do not type keys, passwords or card numbers here.' })));

let sent = null; const fx = (resp, status = 200) => async (url, init) => { sent = { url, init }; return { ok: status < 400, status, json: async () => resp }; };
let r = await H.hbAsk('How do I turn on live?', [{ role: 'user', content: 'hi' }], fx({ answer: 'Press Refresh now.', sources: [{ title: 'Settings', url: 'menus/settings-and-account.html' }, 1, 2, 3], found: true }));
ok('asks the help worker with the sign-in token, only question + history in the body', sent.url === H.HB_URL && sent.init.method === 'POST' && sent.init.headers.Authorization === 'Bearer tok.en.123' && Object.keys(JSON.parse(sent.init.body)).sort().join() === 'history,question');
ok('a good answer comes back with at most 3 sources', r.ok && r.answer === 'Press Refresh now.' && r.sources.length === 3);
r = await H.hbAsk('x', [], fx({ error: 'sensitive', message: 'Please do not type keys, passwords or card numbers here.' }, 400)); ok('a refused (sensitive) message shows the server wording', !r.ok && /do not type keys/.test(r.text));
r = await H.hbAsk('x', [], fx({ error: 'x' }, 429)); ok('rate limit -> friendly message', !r.ok && /Too many questions/.test(r.text));
r = await H.hbAsk('x', [], async () => { throw new Error('network down: secret detail'); }); ok('a network failure is a friendly message with no detail', !r.ok && !/secret detail|network down/.test(r.text));
r = await H.hbAsk('x', [], fx({ nope: 1 }, 200)); ok('a malformed reply is treated as unavailable, not shown', !r.ok);
const saved = globalThis.SESSION_TOKEN; globalThis.SESSION_TOKEN = null; sent = null; r = await H.hbAsk('x', [], fx({})); ok('signed out: nothing is sent', !r.ok && sent === null); globalThis.SESSION_TOKEN = saved;

// on every dashboard (CLAUDE.md rule 5): sources load it, builds keep it, CSP lets it reach the worker
const HOST = 'https://capitallens-help.itsme-daf.workers.dev';
for (const f of ['docs/index.html', 'docs/demo/index.html', 'docs/app/index.html', 'docs/zkapp/index.html', 'docs/zkapp-prod/index.html']) {
  const html = R(f), conn = /connect-src ([^;"]+)/.exec(html)[1];
  ok(`${f}: loads helpbot.js and its CSP allows the help worker`, /helpbot\.js/.test(html) && conn.split(' ').includes(HOST));
}
const js = R('docs/js/helpbot.js');
ok('widget rules: theme variables only (white text on the accent and the shadow alpha are the existing app pattern), no inline scripts/handlers, answers set with textContent (never innerHTML), tap targets >= 40px, sand-clock loading', !/#[0-9a-fA-F]{3,8}\b(?!;?\s*\/\/)/.test(js.replace(/#hb-[a-z]+/g, '').replace(/#(fff|0006|0008)\b/g, '')) && !/innerHTML|onclick=|eval\(|new Function/.test(js) && /min-height:40px/.test(js) && /loading busy/.test(js));
ok('the button only shows while signed in and the chat is wiped on sign-out', /hbToken\(\)/.test(js) && /HB\.msgs = \[\]/.test(js));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

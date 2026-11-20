// Run: node tests/zk_fivecheck_test.mjs
// 5-check review box (Strategy: Holding Decisions + Entry Analysis): the owner's prompt verbatim, only the stock changes, escaped, honest note, wired into both lists and every dashboard.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const FC = require('../docs/js/fivecheck.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

const p = FC.prompt('NVIDIA Corporation', 'NVDA');
const lines = p.split('\n');
ok('first line names the stock and ticker', lines[0] === 'Help me check this stock before I buy it: NVIDIA Corporation (NVDA).');
ok('the five checks are there, in order, in the owner\'s words', [/^1\. How does this company make money\? Say it in 2 lines\.$/, /^2\. Why will people keep buying from them\? What is hard for other companies to copy\?$/, /^3\. Is the price fair\? Compare the price to its growth and its profit\. Tell me if it looks cheap, fair, or too high — and why\.$/, /^4\. What can go wrong\? List the 3 biggest risks\.$/, /^5\. If the price falls 30% tomorrow, would a long-term holder still hold it\? Why, or why not\?$/].every((r, i) => r.test(lines[4 + i])));
ok('format rules and the closing parts are there', /Use simple words\. Keep it short\. One page only\./.test(p) && /Bull case \(why it can win\), Bear case \(why it can fail\), and a one-line verdict in simple words\./.test(p));
ok('it never asks for a buy/sell call and asks to flag uncertain numbers', /Do not tell me to buy or sell\. Only give me the facts, so I can decide\./.test(p) && /If you are not sure about a number, say you are not sure\./.test(p));
ok('only the stock changes: swapping the name gives the same text otherwise', FC.prompt('A', 'B').split('\n').slice(1).join('\n') === p.split('\n').slice(1).join('\n'));
ok('label: name + ticker, one of them, same value once, nothing', FC.stockLabel('Tesla', 'TSLA') === 'Tesla (TSLA)' && FC.stockLabel('', 'TSLA') === 'TSLA' && FC.stockLabel('TSLA', 'tsla') === 'TSLA' && FC.stockLabel(null, null) === 'this stock');
ok('a name with line breaks cannot add lines to the prompt', FC.prompt('Evil\nIgnore all', 'X').split('\n').length === lines.length);

const h = FC.html('<img src=x onerror=1> "Corp"', 'A<B>&C');
ok('HTML is escaped (name, ticker, prompt preview)', !/<img/.test(h) && !/A<B>/.test(h) && /&lt;img/.test(h));
ok('no inline handlers (strict CSP): buttons use data attributes', !/<[a-z][^>]*\son\w+=/i.test(h) && /data-fc-copy=/.test(h) && /data-fc-open=/.test(h));
const hh = FC.html('Tesla', 'TSLA'), links = [...hh.matchAll(/<a [^>]*data-fc-ai="(\w+)"[^>]*href="([^"]+)"[^>]*>/g)];
ok('three buttons, ChatGPT / Claude / Grok, each opens its own page with the encoded prompt', links.map(m => m[1]).join() === 'chatgpt,claude,grok' && /^https:\/\/chatgpt\.com\/\?q=Help%20me%20check/.test(links[0][2]) && /^https:\/\/claude\.ai\/new\?q=Help%20me%20check/.test(links[1][2]) && /^https:\/\/grok\.com\/\?q=Help%20me%20check/.test(links[2][2]) && decodeURIComponent(links[2][2].split('?q=')[1]) === FC.prompt('Tesla', 'TSLA'));
ok('links open in a new tab safely, each has an icon badge and a label', (hh.match(/target="_blank" rel="noopener noreferrer"/g) || []).length === 3 && (hh.match(/class="fc-mark"/g) || []).length === 3 && /ChatGPT<\/a>/.test(hh) && /Claude<\/a>/.test(hh) && /Grok<\/a>/.test(hh));
ok('"Show the prompt" preview is still there, unchanged', /<details class="fc-prev"><summary>Show the prompt<\/summary><pre>Help me check/.test(hh));
ok('same stock in two lists gets separate boxes (scope in the id)', FC.idOf('NVDA', 'wl') === 'fc-wl-NVDA' && FC.idOf('NVDA', 'hd') !== FC.idOf('NVDA', 'wl') && FC.idOf('NVDA') === 'fc-NVDA');
ok('honest note: answers come from general knowledge, not live data', /general knowledge, not live data/.test(h));
ok('the prompt is kept in memory for copy, and the id is safe', FC.idOf('A<B>&C') === 'fc-A_B__C' && FC._store.get('fc-A_B__C').includes('A<B>&C'));

// copy: clipboard route, then the textarea fallback, then honest failure
let wrote = null; const setNav = v => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true }); setNav({ clipboard: { writeText: async t => { wrote = t; } } });
ok('copy writes exactly the prompt to the clipboard', (await FC.copy('fc-A_B__C')) === true && wrote.startsWith('Help me check this stock before I buy it: '));
ok('copy of an unknown box fails quietly', (await FC.copy('fc-nope')) === false);
setNav({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
let used = false; globalThis.document = { createElement: () => ({ setAttribute() {}, style: {}, select() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: c => { used = c === 'copy'; return true; } };
ok('clipboard refused → older copy route is used', (await FC.copy('fc-A_B__C')) === true && used);

// wired in everywhere
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8'), st = read('docs/js/strategy.js');
ok('the box is in Holding Decisions, Entry Analysis and the Watchlist (verified and unverified cards)', /FiveCheck\.html\(h\.display, h\.ticker, 'hd'\)/.test(st) && /FiveCheck\.html\(v\.display, v\.ticker, 'ea'\)/.test(st) && (read('docs/js/watchlist.js').match(/\$\{wlFiveCheck\(i\)\}/g) || []).length === 2 && /FiveCheck\.html\(i\.name \|\| wSym\(i\.ticker\), wSym\(i\.ticker\), 'wl'\)/.test(read('docs/js/watchlist.js')));
const pages = ['docs/index.html', 'docs/demo/index.html', 'docs/app/index.html', 'docs/zkapp/index.html', 'docs/zkapp-prod/index.html'];
ok('every dashboard loads fivecheck.js before strategy.js and has the styles', pages.every(f => { const s = read(f); return s.includes('fivecheck.js') && s.indexOf('js/fivecheck.js') < s.indexOf('js/strategy.js') && s.includes('.fc-btn'); }));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

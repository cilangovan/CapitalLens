// Run: node tests/zk_watchlist_analyst_chip_test.mjs — every watchlist card shows the analyst view, or says there is no coverage.
import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const src = readFileSync(new URL('../docs/js/watchlist.js', import.meta.url), 'utf8');
const i = src.indexOf('function wlAnalystChip'), j = src.indexOf('function wlAmount');
const ctx = {}; vm.createContext(ctx);
vm.runInContext("const _wesc = s => String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));" + src.slice(i, j) + ';this.chip=wlAnalystChip;', ctx);
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
ok('strong buy with 3 analysts is green and shows the count', /w-tag g".*Analysts: Strong buy \(3\)/.test(ctx.chip({ analyst: { rec: 'strong_buy', count: 3 } })));
ok('hold is amber', /w-tag y".*Hold \(12\)/.test(ctx.chip({ analyst: { rec: 'hold', count: 12 } })));
ok('sell is red', /w-tag r"/.test(ctx.chip({ analyst: { rec: 'sell', count: 5 } })));
ok('no coverage is stated, not invented', ctx.chip({ analyst: { rec: 'none', count: 0 } }).includes('no coverage') && ctx.chip({}).includes('no coverage') && ctx.chip(undefined).includes('no coverage'));
ok('a rating with zero analysts is treated as no coverage', ctx.chip({ analyst: { rec: 'buy', count: 0 } }).includes('no coverage'));
ok('source is named', ctx.chip({ analyst: { rec: 'buy', count: 4 } }).includes('Yahoo Finance'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

// Run: node tests/zk_lynch_parity_test.mjs — the Python (legacy services) and JS (private dashboard) classifiers must agree.
import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process';
const L = createRequire(import.meta.url)('../docs/zk/lynch.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const cases = []; const seeds = [null, 0.4, 0.2, 0.12, 0.07, 0.02, -0.03];
for (const quoteType of ['EQUITY', 'ETF']) for (const sector of ['Technology', 'Energy', 'Utilities', '']) for (const industry of ['Software', 'Airlines', 'Semiconductors', 'Utilities - Regulated Electric', ''])
  for (const eg of seeds) for (const rg of [null, 0.6, 0.1]) for (const pm of [null, 0.2, -0.1]) for (const cap of [null, 2e9, 50e9]) for (const pb of [null, 0.5, 3, -2])
    cases.push({ quoteType, sector, industry, earningsGrowth: eg, revenueGrowth: rg, profitMargins: pm, marketCap: cap, priceToBook: pb });
const py = JSON.parse(execFileSync('python3', ['-c', 'import sys,json\nfrom services.lynch_service import classify\nprint(json.dumps([classify(c) for c in json.load(sys.stdin)]))'], { input: JSON.stringify(cases), cwd: new URL('..', import.meta.url).pathname, maxBuffer: 1 << 28 }).toString());
let diffs = 0, first = null;
cases.forEach((c, i) => { const j = L.classify(c), p = py[i]; if (j.bucket !== p.bucket || j.name !== p.name || j.reason !== p.reason || j.confidence !== p.confidence || j.basis !== p.basis) { diffs++; first = first || { c, j, p }; } });
ok(`${cases.length} generated inputs: JS and Python give identical bucket, name, reason, confidence`, diffs === 0);
if (first) console.log(JSON.stringify(first, null, 1));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

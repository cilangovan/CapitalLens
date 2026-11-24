// Order-flow estimator: JS must match the Python golden vectors exactly (same algorithm in services/orderflow.py).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs'), assert = require('assert'), OF = require('../docs/zk/orderflow.js');
const __dirname = new URL('.', import.meta.url).pathname;
const cases = JSON.parse(fs.readFileSync(__dirname + '/data/orderflow_golden.json', 'utf8'));
let n = 0;
for (const c of cases) {
  const g = OF.estimate(c.h, c.l, c.c, c.v, c.dates, c.partial), e = c.expect;
  for (const k of ['state', 'score', 'rvol', 'pressure', 'age', 'date', 'extra_shares', 'note']) assert.deepStrictEqual(g[k], e[k], `${c.name}: ${k} js=${g[k]} py=${e[k]}`);
  assert.strictEqual(g.estimated, true); n++;
}
const by = s => cases.find(c => c.name.startsWith(s)).expect;
assert.strictEqual(by('buy footprint today').state, 'accumulation');
assert.strictEqual(by('sell footprint today').state, 'distribution');
assert.notStrictEqual(by('big volume but only 1.8x').state, 'accumulation');
assert.notStrictEqual(by('footprint older').state, 'accumulation');
assert.strictEqual(by('no volume').state, 'unverified'); assert.strictEqual(by('too little').state, 'unverified'); assert.strictEqual(by('missing volume').state, 'unverified');
assert.ok(/not from actual orders/.test(by('buy footprint today').note));
console.log('orderflow ok', n, 'golden cases');

// Regression: the demo Returns page crashed with "Cannot read properties of undefined (reading 'cash_rebuilt')" because the demo's returns_summary rows have no `check`.
import { createRequire } from 'node:module';
import assert from 'node:assert';
const require = createRequire(import.meta.url);
globalThis.IS_GUEST = false;
const { rtCheckText } = require('../docs/js/returns.js');
assert.doesNotThrow(() => rtCheckText(undefined));
assert.match(rtCheckText(undefined), /not available/);
assert.match(rtCheckText(null), /not available/);
assert.match(rtCheckText({}), /not available/);
assert.match(rtCheckText({ cash_rebuilt: 10, cash_t212: 10.01 }), /to the penny/);
assert.match(rtCheckText({ cash_rebuilt: 10, cash_t212: 12.5 }), /within £2\.50/);
console.log('returns footer ok');

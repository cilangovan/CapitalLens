// Run: node tests/zk_analysis_version_test.mjs — fails when the analysis code changed without bumping ZK_ANALYSIS_VERSION.
import { readFileSync } from 'node:fs'; import { current } from '../scripts/analysis_fingerprint.mjs';
const cur = current(), rec = JSON.parse(readFileSync(new URL('../config/analysis_fingerprint.json', import.meta.url), 'utf8'));
if (rec.hash === cur.hash && rec.version === cur.version) { console.log(`  ✓ analysis code matches the recorded fingerprint for version '${cur.version}'\n1 passed, 0 failed`); process.exit(0); }
console.log(rec.hash !== cur.hash && rec.version === cur.version
  ? `  ✗ the code that produces the analysis changed, but ZK_ANALYSIS_VERSION is still '${cur.version}'.\n    Bump it in docs/zkapp/zkapp-tools.js, then run: node scripts/analysis_fingerprint.mjs --update`
  : `  ✗ fingerprint out of date. Run: node scripts/analysis_fingerprint.mjs --update`);
console.log('0 passed, 1 failed'); process.exit(1);

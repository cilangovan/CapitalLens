// Guards "new analysis features need a manual Refresh": when the code that PRODUCES the analysis changes, ZK_ANALYSIS_VERSION
// (docs/zkapp/zkapp-tools.js) must change too, so every browser re-analyses once on its next login.
//   node scripts/analysis_fingerprint.mjs            check (used by CI)
//   node scripts/analysis_fingerprint.mjs --update   record the new fingerprint (refuses unless the version was bumped)
import { readFileSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url), R = p => readFileSync(new URL(p, root), 'utf8');
export const FILES = ['pipeline', 'orderflow', 'analystratings', 'lynch', 'returns', 'piehistory', 'profitbooking', 'strategy', 'holdingdecision', 'valuebuy', 'watchlist', 'flow', 'alertreport', 'alertfmt', 'monitor', 'symbols'].map(n => `docs/zk/${n}.js`);
export const current = () => ({ version: R('docs/zkapp/zkapp-tools.js').match(/ZK_ANALYSIS_VERSION = '([^']+)'/)[1], hash: createHash('sha256').update(FILES.map(f => f + '\n' + R(f)).join('\n--\n')).digest('hex') });
if (process.argv[1] && process.argv[1].endsWith('analysis_fingerprint.mjs')) {
  const cur = current(); let rec = null; try { rec = JSON.parse(R('config/analysis_fingerprint.json')); } catch (e) {}
  if (process.argv.includes('--update')) {
    if (rec && rec.hash !== cur.hash && rec.version === cur.version) { console.error(`The analysis code changed but ZK_ANALYSIS_VERSION is still '${cur.version}'. Bump it in docs/zkapp/zkapp-tools.js first.`); process.exit(1); }
    writeFileSync(new URL('config/analysis_fingerprint.json', root), JSON.stringify(cur, null, 1) + '\n'); console.log('recorded', cur.version, cur.hash.slice(0, 12)); process.exit(0);
  }
  if (!rec || rec.hash !== cur.hash || rec.version !== cur.version) {
    console.error(rec && rec.hash !== cur.hash && rec.version === cur.version
      ? `FAIL: analysis code changed but ZK_ANALYSIS_VERSION is still '${cur.version}'. Bump it in docs/zkapp/zkapp-tools.js, then run: node scripts/analysis_fingerprint.mjs --update`
      : `FAIL: fingerprint out of date. Run: node scripts/analysis_fingerprint.mjs --update`); process.exit(1);
  }
  console.log(`ok: analysis fingerprint matches version '${cur.version}'`);
}

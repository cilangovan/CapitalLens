// Production pages must point ONLY at the production project, keep demo-only features out, and have valid SRI hashes.
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('FAIL', n)); };
const DEMO = 'ggprfdetivzekjxlpvyq', PROD = 'kloqkcxchstfoljpqcbq', R = p => readFileSync(new URL('../docs/' + p, import.meta.url), 'utf8');
for (const d of ['zkapp-prod', 'zk-prod']) {
  const files = d === 'zkapp-prod' ? ['index.html', 'zkapp-auth.js'] : ['index.html', 'zk.js'];
  for (const f of files) { const t = R(d + '/' + f); ok(`${d}/${f} has no demo project`, !t.includes(DEMO)); ok(`${d}/${f} uses prod project`, t.includes(PROD)); ok(`${d}/${f} uses separate session keys`, !/\bzk_(token|email|dk)\b/.test(t)); }
  const html = R(d + '/index.html'), csp = html.match(/Content-Security-Policy"[^>]*content="([^"]+)"/)[1];
  ok(`${d} CSP has no demo host`, !csp.includes(DEMO)); ok(`${d} no inline script allowed`, /script-src 'self'(;|$)/.test(csp) && !/unsafe-(inline|eval)[^;]*script|script-src[^;]*unsafe/.test(csp));
  for (const m of html.matchAll(/<script src="([^"]+)"[^>]*integrity="sha384-([^"]+)"/g)) {
    const h = createHash('sha384').update(readFileSync(new URL('../docs/' + d + '/' + m[1], import.meta.url))).digest('base64'); ok(`${d} SRI ${m[1]}`, h === m[2]);
  }
  ok(`${d} every local script pinned`, [...html.matchAll(/<script src="(?!http)[^"]+"[^>]*>/g)].every(m => /integrity=/.test(m[0])));
}
const z = R('zk-prod/index.html');
ok('prod /zk/ has no private-notes probe', !/zk_probe|notes-plain|note-in/.test(z) && !/zk_probe/.test(R('zk-prod/zk.js').replace(/if \(!\$\('notes-plain'\)\)[\s\S]*?\n/, '').split('loadNotes')[0] + ''));
ok('prod /zk/ has no plaintext-delete box', !/purge-confirm|Delete plaintext/.test(z));
ok('prod pages link to each other, not demo', z.includes('../zkapp-prod/') && R('zkapp-prod/zkapp-auth.js').includes('../zk-prod/') && !R('zkapp-prod/zkapp-auth.js').includes("'../zk/'"));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

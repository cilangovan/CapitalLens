// Run: node tests/zk_login_flash_test.mjs
// Refreshing while signed in must not flash the sign-in box: it is hidden by CSS until the saved-session check is finished.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
for (const dir of ['zkapp', 'zkapp-prod']) {
  const page = readFileSync(new URL(`../docs/${dir}/index.html`, import.meta.url), 'utf8'), js = readFileSync(new URL(`../docs/${dir}/zkapp-auth.js`, import.meta.url), 'utf8');
  ok(`${dir}: sign-in box is hidden until revealed (CSS, so it applies before any script runs)`, /#login-screen:not\(\.show\)\s*\{\s*visibility:\s*hidden/.test(page));
  ok(`${dir}: revealed only after the saved-session check, and only if the app did not open`, /finally\s*\{[^}]*classList\.contains\('visible'\)[^}]*showLoginScreen\(\)/.test(js) && /function showLoginScreen\(\)[^}]*classList\.add\('show'\)/.test(js));
  ok(`${dir}: the session check runs on DOMContentLoaded and reveals the box on failure too (finally)`, /DOMContentLoaded/.test(js) && /catch \(e\) \{[^}]*\}\s*finally/.test(js.replace(/\n/g, ' ')));
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

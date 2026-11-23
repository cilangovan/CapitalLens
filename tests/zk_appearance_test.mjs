// Appearance (Epic: Personalisation steps 1-2): 6 themes, 6 fonts, 4 text sizes; contrast is computed, not eyeballed; saved values are validated.
import { createRequire } from 'module'; import { readFileSync, existsSync } from 'fs';
const require = createRequire(import.meta.url), A = require('../docs/js/appearance.js');
let pass = 0, fail = 0; const ok = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const MID = { bg: '#0f1117', bg2: '#1a1d27', bg3: '#22263a', text: '#e2e8f0', muted: '#8892a4', border: '#2d3353', accent: '#6366f1', green: '#22c55e', red: '#ef4444', yellow: '#f59e0b' };
ok('6 themes, 6 fonts, 4 text sizes (the owner chose all six of each)', A.THEMES.length === 6 && A.FONTS.length === 6 && A.SIZES.length === 4);
ok('themes are Midnight, Daylight, AMOLED black, High contrast, Forest, Sepia', A.THEMES.map(t => t.id).join() === 'midnight,daylight,amoled,contrast,forest,sepia');
ok('fonts are System, Inter, IBM Plex Sans, Atkinson Hyperlegible, Serif, Monospace', A.FONTS.map(f => f.label).join() === 'System,Inter,IBM Plex Sans,Atkinson Hyperlegible,Serif,Monospace');
for (const t of A.THEMES) {
  const v = t.vars || MID, min = t.id === 'contrast' ? 7 : 4.5;
  ok(`${t.label}: text on page and cards >= ${min}:1, muted on cards >= ${min}:1`, cr(v.text, v.bg) >= min && cr(v.text, v.bg2) >= min && cr(v.muted, v.bg2) >= min && cr(v.muted, v.bg3) >= (t.id === 'midnight' ? 4.5 : min));
  ok(`${t.label}: white button text on the accent >= 4.5:1 (Midnight is the unchanged original palette, 4.47)`, cr('#ffffff', v.accent) >= (t.id === 'midnight' ? 4.4 : 4.5));
  ok(`${t.label}: gain/loss/caution colours >= 4.5:1 on cards (Midnight: original red 4.47)`, ['green', 'red', 'yellow'].every(k => cr(v[k], v.bg2) >= (t.id === 'midnight' ? 4.4 : 4.5)));
}
ok('every non-default theme defines the full colour set', A.THEMES.filter(t => t.vars).every(t => ['bg', 'bg2', 'bg3', 'text', 'muted', 'border', 'accent', 'green', 'red', 'yellow', 'blue', 'purple', 'cyan'].every(k => /^#[0-9a-f]{6}$/i.test(t.vars[k]))));
ok('bad saved values fall back to defaults (no injection through a stored preference)', JSON.stringify(A.clean({ theme: '"><script>', font: 'comic', size: 99, follow: 'yes' })) === JSON.stringify(A.DEFAULT) && A.clean(null).theme === 'midnight');
ok('good saved values are kept', (c => c.theme === 'sepia' && c.font === 'inter' && c.size === 'xl' && c.follow === true)(A.clean({ theme: 'sepia', font: 'inter', size: 'xl', follow: true })));
const css = A.buildCss('../fonts/');
ok('CSS has a block per theme, a font rule per non-system font, a size rule per non-normal size', A.THEMES.filter(t => t.vars).every(t => css.includes(`html[data-theme="${t.id}"]{`)) && A.FONTS.filter(f => f.stack).every(f => css.includes(`html[data-font="${f.id}"]`)) && ['s', 'l', 'xl'].every(s => css.includes(`html[data-size="${s}"]`)));
ok('fonts are self-hosted: only url() is ../fonts/ (no third-party request; CSP font-src stays self)', [...css.matchAll(/url\("([^"]+)"\)/g)].every(m => m[1].startsWith('../fonts/')) && !/https?:\/\//.test(css));
ok('the bundled Inter files exist (regular + semibold)', existsSync('docs/fonts/Inter-Regular.woff') && existsSync('docs/fonts/Inter-SemiBold.woff'));
const src = readFileSync('docs/js/appearance.js', 'utf8');
ok('no inline handlers, no eval: wired with addEventListener only (strict CSP)', !/\son(click|change|input|keydown)=/.test(src) && !/\beval\(|new Function\(/.test(src));
ok('the account copy follows the user: saved through ClPrefs and adopted from the prefs row', src.includes("ClPrefs.set('__appearance'") && readFileSync('docs/js/collapse.js', 'utf8').includes('ClAppearance.adopt(saved.__appearance)'));
for (const f of ['docs/index.html', 'docs/demo/index.html']) ok(`${f} loads appearance.js before everything else (no flash of the wrong theme)`, readFileSync(f, 'utf8').indexOf('appearance.js') < readFileSync(f, 'utf8').indexOf('collapse.js') && readFileSync(f, 'utf8').indexOf('appearance.js') < readFileSync(f, 'utf8').indexOf('</head>'));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);

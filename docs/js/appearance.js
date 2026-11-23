// Appearance: per-user theme, font and text size (Epic: Personalisation, steps 1-2). Loaded first on every dashboard.
// Choices apply instantly, are remembered on this device (so the sign-in screen and the first paint are right) and, once you are signed in,
// saved with your other screen preferences (table user_ui_prefs, own row only) so they follow your account to other devices.
// No inline handlers (strict CSP): everything is wired with addEventListener.
(function (root) {
  'use strict';
  const KEY = 'cl_appearance';
  const THEMES = [
    { id: 'midnight', label: 'Midnight', note: 'Dark navy (default)', dark: true,  vars: null },
    { id: 'daylight', label: 'Daylight', note: 'Light, for bright rooms', dark: false, vars: { bg: '#f1f4f9', bg2: '#ffffff', bg3: '#e8ecf4', text: '#1a2132', muted: '#576177', border: '#c9d1e0', accent: '#4f46e5', green: '#15803d', red: '#b91c1c', yellow: '#a16207', blue: '#1d4ed8', purple: '#6d28d9', cyan: '#0e7490' } },
    { id: 'amoled',   label: 'AMOLED black', note: 'True black, saves OLED battery', dark: true, vars: { bg: '#000000', bg2: '#0b0b0d', bg3: '#17171c', text: '#f1f5f9', muted: '#9aa4b5', border: '#2a2a33', accent: '#5a5de8', green: '#22c55e', red: '#f05252', yellow: '#f59e0b', blue: '#3b82f6', purple: '#a78bfa', cyan: '#06b6d4' } },
    { id: 'contrast', label: 'High contrast', note: 'Black and white, thick borders (AAA text)', dark: true, vars: { bg: '#000000', bg2: '#000000', bg3: '#1c1c1c', text: '#ffffff', muted: '#e6e6e6', border: '#ffffff', accent: '#2563eb', green: '#4ade80', red: '#ff6b6b', yellow: '#ffd60a', blue: '#60a5fa', purple: '#c4b5fd', cyan: '#22d3ee' } },
    { id: 'forest',   label: 'Forest', note: 'Deep green, calmer on the eyes', dark: true, vars: { bg: '#0d1512', bg2: '#15211c', bg3: '#1e2d26', text: '#e4f0e9', muted: '#93ab9c', border: '#2b4237', accent: '#047857', green: '#4ade80', red: '#f87171', yellow: '#fbbf24', blue: '#60a5fa', purple: '#c4b5fd', cyan: '#22d3ee' } },
    { id: 'sepia',    label: 'Sepia', note: 'Warm paper tones for long reading', dark: false, vars: { bg: '#f2e8d5', bg2: '#fbf5e8', bg3: '#eadfc7', text: '#3a2e1c', muted: '#675637', border: '#d4c5a0', accent: '#9a4a0f', green: '#2f6b1f', red: '#a32323', yellow: '#8a5a00', blue: '#1e4fa3', purple: '#5b3a9d', cyan: '#0b6275' } },
  ];
  // bundled = the font file ships with CapitalLens (self-hosted, works offline). Others are used when installed on the device, otherwise the named fallback shows.
  const FONTS = [
    { id: 'system',  label: 'System', stack: null, bundled: true, note: 'Your device font (default, fastest)' },
    { id: 'inter',   label: 'Inter', stack: "'Inter CL','Inter',system-ui,-apple-system,'Segoe UI',sans-serif", bundled: true, note: 'Clear numbers, equal-width digits' },
    { id: 'plex',    label: 'IBM Plex Sans', stack: "'IBM Plex Sans','Segoe UI',system-ui,-apple-system,sans-serif", bundled: false, note: 'Technical and wide. Used if installed on your device' },
    { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible','Verdana',system-ui,sans-serif", bundled: false, note: 'Made for low vision. Used if installed, else Verdana' },
    { id: 'serif',   label: 'Serif', stack: "'Source Serif 4','Source Serif Pro',Georgia,'Times New Roman',serif", bundled: false, note: 'Source Serif if installed, else Georgia' },
    { id: 'mono',    label: 'Monospace', stack: "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace", bundled: false, note: 'Columns line up. JetBrains Mono if installed' },
  ];
  const SIZES = [{ id: 's', label: 'Small', px: 13 }, { id: 'n', label: 'Normal', px: 14 }, { id: 'l', label: 'Large', px: 16 }, { id: 'xl', label: 'Extra large', px: 18 }];
  const DEFAULT = { theme: 'midnight', follow: false, font: 'system', size: 'n' };
  const byId = (a, id) => a.find(x => x.id === id);

  function clean(o) {
    o = o && typeof o === 'object' ? o : {};
    return { theme: byId(THEMES, o.theme) ? o.theme : DEFAULT.theme, follow: o.follow === true, font: byId(FONTS, o.font) ? o.font : DEFAULT.font, size: byId(SIZES, o.size) ? o.size : DEFAULT.size };
  }
  function themeCss(t) {
    if (!t.vars) return '';
    const v = t.vars, names = ['bg', 'bg2', 'bg3', 'text', 'muted', 'border', 'accent', 'green', 'red', 'yellow', 'blue', 'purple', 'cyan'];
    return 'html[data-theme="' + t.id + '"]{' + names.map(n => '--' + n + ':' + v[n]).join(';') + ';--card:' + v.bg2 + ';color-scheme:' + (t.dark ? 'dark' : 'light') + '}';
  }
  function buildCss(fontBase) {
    let c = THEMES.map(themeCss).join('\n');
    c += '\nhtml[data-theme="contrast"] .card{border-width:2px}html[data-theme="contrast"] a{text-decoration:underline}';
    c += '\n@font-face{font-family:"Inter CL";font-weight:400;font-style:normal;font-display:swap;src:url("' + fontBase + 'Inter-Regular.woff") format("woff")}';
    c += '\n@font-face{font-family:"Inter CL";font-weight:600 700;font-style:normal;font-display:swap;src:url("' + fontBase + 'Inter-SemiBold.woff") format("woff")}';
    FONTS.filter(f => f.stack).forEach(f => { c += '\nhtml[data-font="' + f.id + '"]{--cl-font:' + f.stack + '}'; });
    c += '\nhtml[data-font] body,html[data-font] button,html[data-font] input,html[data-font] select,html[data-font] textarea{font-family:var(--cl-font)}';
    c += '\nhtml[data-font] td,html[data-font] th,html[data-font] .value{font-variant-numeric:tabular-nums}';
    SIZES.filter(s => s.id !== 'n').forEach(s => { c += '\nhtml[data-size="' + s.id + '"] body{font-size:' + s.px + 'px}'; });
    c += '\n#cl-ap-btn{background:none;border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;min-height:32px;margin-right:6px}';
    c += '\n#cl-ap{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:60;align-items:center;justify-content:center}';
    c += '\n#cl-ap .cl-ap-box{background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:16px;width:min(560px,94vw);max-height:92vh;overflow:auto}';
    c += '\n#cl-ap h3{margin:0;flex:1;font-size:15px;text-transform:none;color:var(--text)}#cl-ap h4{margin:14px 0 6px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}';
    c += '\n#cl-ap .cl-ap-head{display:flex;align-items:center;gap:10px}#cl-ap .cl-ap-x{min-width:44px;min-height:44px;background:none;border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:16px}';
    c += '\n#cl-ap .cl-ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}';
    c += '\n#cl-ap .cl-ap-opt{min-height:56px;text-align:left;padding:8px 10px;border:2px solid var(--border);border-radius:10px;background:var(--bg3);color:var(--text);cursor:pointer;font-size:13px;display:block;width:100%}';
    c += '\n#cl-ap .cl-ap-opt[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}#cl-ap .cl-ap-opt small{display:block;color:var(--muted);font-size:11px;margin-top:2px}';
    c += '\n#cl-ap .cl-ap-sw{display:flex;gap:3px;margin-bottom:5px}#cl-ap .cl-ap-sw i{display:block;width:18px;height:18px;border-radius:4px;border:1px solid rgba(128,128,128,.5)}';
    c += '\n#cl-ap .cl-ap-sizes{display:flex;gap:6px;flex-wrap:wrap}#cl-ap .cl-ap-sizes .cl-ap-opt{flex:1 1 70px;text-align:center;width:auto}';
    c += '\n#cl-ap .cl-ap-prev{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg);margin-top:12px}#cl-ap .cl-ap-prev b{font-size:20px}';
    c += '\n#cl-ap .cl-ap-reset{min-height:44px;margin-top:12px;padding:0 14px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);cursor:pointer}';
    c += '\n#cl-ap .cl-ap-note{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4}';
    return c;
  }

  let state = clean(DEFAULT), mq = null;
  const doc = root.document;
  function effectiveTheme(s) {
    if (!s.follow) return s.theme;
    const light = root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches;
    return light ? 'daylight' : 'midnight';
  }
  function apply() {
    if (!doc) return;
    const h = doc.documentElement, t = effectiveTheme(state);
    if (t === 'midnight') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', t);
    if (state.font === 'system') h.removeAttribute('data-font'); else h.setAttribute('data-font', state.font);
    if (state.size === 'n') h.removeAttribute('data-size'); else h.setAttribute('data-size', state.size);
    const m = doc.querySelector('meta[name=theme-color]'); if (m && m.setAttribute) m.setAttribute('content', clv('--bg') || '#0f1117');
    refreshCharts();
  }
  function clv(name) { try { return root.getComputedStyle(doc.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; } }
  function refreshCharts() {         // canvas charts keep their own colours: recolour the ones already drawn
    try {
      const C = root.Chart; if (!C || !C.instances) return;
      Object.values(C.instances).forEach(ch => {
        const sc = ch.options && ch.options.scales || {};
        Object.keys(sc).forEach(k => { const o = sc[k]; if (o.ticks) o.ticks.color = clv('--muted'); if (o.grid && typeof o.grid.color === 'string') o.grid.color = clv('--border'); });
        const lg = ch.options && ch.options.plugins && ch.options.plugins.legend; if (lg && lg.labels) lg.labels.color = clv('--text');
        ch.update('none');
      });
    } catch (e) {}
  }
  // The dashboards were drawn for a dark page, so some labels use pale tints (light red, light blue...). On the light themes those would be
  // unreadable: swap each pale tint for the theme's own gain/loss/caution colour. Found by reading the page's own style rules, so new CSS is covered too.
  const PALE = { '#fca5a5': 'red', '#f87171': 'red', '#ec835a': 'red', '#93c5fd': 'blue', '#60a5fa': 'blue', '#4ade80': 'green', '#86efac': 'green', '#fcd34d': 'yellow', '#fbbf24': 'yellow', '#a78bfa': 'purple', '#c4b5fd': 'purple', '#e2e8f0': 'text', '#8892a4': 'muted' };
  const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; };
  const PALE_RGB = Object.keys(PALE).reduce((o, h) => { o[hexToRgb(h)] = PALE[h]; return o; }, {});
  function lightFixes() {
    if (!doc || doc.getElementById('cl-ap-light')) return;
    const sel = [], inl = [];
    try {
      for (const sh of Array.from(doc.styleSheets)) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of Array.from(rules || [])) { if (r.type !== 1 || !r.style) continue; const c = PALE_RGB[(r.style.color || '').replace(/\s+/g, ' ').trim()]; if (c) sel.push([r.selectorText, c]); } }
    } catch (e) {}
    Object.keys(PALE).forEach(h => { const c = PALE[h]; ['color:' + h, 'color: ' + h, 'fill="' + h + '"'].forEach(m => { if (m.indexOf('fill') === 0) return; inl.push(['[style*="' + m + '"]', c]); }); });
    let css = '';
    ['daylight', 'sepia'].forEach(t => { sel.concat(inl).forEach(([q, c]) => { css += 'html[data-theme="' + t + '"] ' + q.split(',').map(x => x.trim()).join(', html[data-theme="' + t + '"] ') + '{color:var(--' + c + ')!important}\n'; }); });
    const st = doc.createElement('style'); st.id = 'cl-ap-light'; st.textContent = css; doc.head.appendChild(st);
  }
  function readDevice() { try { return clean(JSON.parse(root.localStorage.getItem(KEY) || 'null')); } catch (e) { return clean(null); } }
  function writeDevice() { try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function set(patch, silent) {
    state = clean(Object.assign({}, state, patch));
    apply(); writeDevice();
    if (!silent && root.ClPrefs) root.ClPrefs.set('__appearance', state);   // follows the account (user_ui_prefs)
    paint();
  }
  // Called when the account's saved screen preferences arrive after sign-in: the account copy wins over this device's copy.
  function adopt(saved) { if (saved && typeof saved === 'object') { state = clean(saved); apply(); writeDevice(); paint(); } }

  // ---- dialog ----
  function el(tag, attrs, html) { const e = doc.createElement(tag); Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); if (html != null) e.innerHTML = html; return e; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function sample(t) { const v = t.vars || { bg: '#0f1117', bg2: '#1a1d27', accent: '#6366f1', text: '#e2e8f0', green: '#22c55e' }; return [v.bg, v.bg2, v.accent, v.text, v.green].map(c => '<i style="background:' + c + '"></i>').join(''); }
  function paint() {
    const box = doc && doc.getElementById('cl-ap-body'); if (!box) return;
    const themeTiles = THEMES.map(t => '<button type="button" class="cl-ap-opt" data-theme-id="' + t.id + '" aria-pressed="' + (!state.follow && state.theme === t.id) + '"><span class="cl-ap-sw">' + sample(t) + '</span>' + esc(t.label) + '<small>' + esc(t.note) + '</small></button>').join('')
      + '<button type="button" class="cl-ap-opt" data-follow="1" aria-pressed="' + state.follow + '"><span class="cl-ap-sw"><i style="background:#0f1117"></i><i style="background:#f1f4f9"></i></span>Match my device<small>Light by day, dark by night, as your phone is set</small></button>';
    const fontTiles = FONTS.map(f => '<button type="button" class="cl-ap-opt" data-font-id="' + f.id + '" aria-pressed="' + (state.font === f.id) + '" style="' + (f.stack ? 'font-family:' + f.stack : '') + '">' + esc(f.label) + (f.bundled ? '' : '') + '<small style="font-family:inherit">' + esc(f.note) + '</small></button>').join('');
    const sizeTiles = SIZES.map(s => '<button type="button" class="cl-ap-opt" data-size-id="' + s.id + '" aria-pressed="' + (state.size === s.id) + '" style="font-size:' + s.px + 'px">' + esc(s.label) + '</button>').join('');
    box.innerHTML = '<h4>Theme</h4><div class="cl-ap-grid">' + themeTiles + '</div>'
      + '<h4>Font</h4><div class="cl-ap-grid">' + fontTiles + '</div>'
      + '<h4>Text size</h4><div class="cl-ap-sizes">' + sizeTiles + '</div>'
      + '<div class="cl-ap-prev"><div style="color:var(--muted);font-size:12px">Preview</div><b>£12,345.67</b> <span style="color:var(--green)">▲ +2.4%</span> <span style="color:var(--red)">▼ −1.1%</span><div style="font-size:13px">Gains and losses always carry a sign and an arrow, never colour alone.</div></div>'
      + '<button type="button" class="cl-ap-reset" data-reset="1">Reset to defaults</button>'
      + '<div class="cl-ap-note">Saved to your account and to this device. Text size changes the body text; small fixed-size labels stay small. Fonts marked “if installed” use a copy already on your device, nothing is downloaded.</div>';
  }
  function open() { const d = doc.getElementById('cl-ap'); if (d) { paint(); d.style.display = 'flex'; } }
  function close() { const d = doc.getElementById('cl-ap'); if (d) d.style.display = 'none'; }
  function mount() {
    if (doc.getElementById('cl-ap')) return;
    const d = el('div', { id: 'cl-ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Appearance' },
      '<div class="cl-ap-box"><div class="cl-ap-head"><h3>🎨 Appearance</h3><button type="button" class="cl-ap-x" id="cl-ap-close" aria-label="Close">✕</button></div><div id="cl-ap-body"></div></div>');
    doc.body.appendChild(d);
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('#cl-ap-close')) return close();
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.themeId) set({ theme: b.dataset.themeId, follow: false });
      else if (b.dataset.follow) set({ follow: !state.follow });
      else if (b.dataset.fontId) set({ font: b.dataset.fontId });
      else if (b.dataset.sizeId) set({ size: b.dataset.sizeId });
      else if (b.dataset.reset) set(DEFAULT);
    });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const hdr = doc.querySelector('header');
    const btn = el('button', { type: 'button', id: 'cl-ap-btn', title: 'Theme, font and text size' }, '🎨 Appearance');
    btn.addEventListener('click', open);
    if (hdr) { const anchor = hdr.querySelector('#logout-btn'); if (anchor) hdr.insertBefore(btn, anchor); else hdr.appendChild(btn); } else { btn.style.cssText += ';position:fixed;top:6px;right:6px;z-index:40'; doc.body.appendChild(btn); }
  }
  function init() {
    if (!doc) return;
    const src = (doc.currentScript && doc.currentScript.src) || '';
    const base = src ? src.replace(/js\/appearance\.js.*$/, 'fonts/') : '../fonts/';
    const st = doc.createElement('style'); st.id = 'cl-ap-css'; st.textContent = buildCss(base); doc.head.appendChild(st);
    state = readDevice(); apply();                        // before first paint: no flash of the wrong theme
    if (root.matchMedia) { mq = root.matchMedia('(prefers-color-scheme: light)'); const f = () => { if (state.follow) apply(); }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f); }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => { mount(); lightFixes(); }); else { mount(); lightFixes(); }
    root.addEventListener('load', lightFixes);
  }
  const api = { THEMES, FONTS, SIZES, DEFAULT, clean, themeCss, buildCss, set, adopt, open, close, state: () => state, clv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) { root.ClAppearance = api; root.clv = clv; init(); }
})(typeof window !== 'undefined' ? window : globalThis);

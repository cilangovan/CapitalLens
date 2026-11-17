// ── MASKING ───────────────────────────────────────────────────
function mask(val) {
  if (IS_GUEST) return '<span class="masked">***</span>';
  return val;
}
function maskPlain(val) {
  if (IS_GUEST) return '***';
  return val;
}

// ── SECURITY: one gate for everything that comes back from the server ─────────
// 1) Every request to the worker carries your session (the worker refuses reads without it).
// 2) Every string in every worker response is defused before any page code sees it: < > " ' ` are swapped
//    for look-alike characters, so data can never become HTML, an attribute or script (XSS), whatever the view does.
// 3) A rejected session sends you back to the sign-in screen.
const SAFE_CHARS = { '<': '‹', '>': '›', '"': '″', "'": '’', '`': 'ˋ' };
function defuse(v) {
  if (typeof v === 'string') return /[<>"'`]/.test(v) ? v.replace(/[<>"'`]/g, c => SAFE_CHARS[c]) : v;
  if (Array.isArray(v)) return v.map(defuse);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[defuse(k)] = defuse(v[k]); return o; }
  return v;
}
// HTML-escape for text that doesn't come from the worker (error messages, user input)
function esc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); }

(() => {
  const isWorker = url => typeof PROXY !== 'undefined' && String(url).startsWith(PROXY);
  const _fetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (isWorker(url) && typeof SESSION_TOKEN !== 'undefined' && SESSION_TOKEN) {
      const h = new Headers(init.headers || {});
      h.set('Authorization', 'Bearer ' + SESSION_TOKEN);
      init = { ...init, headers: h };
    }
    const r = await _fetch(input, init);
    if (r.status === 401 && isWorker(url) && !/\/auth\//.test(url) && typeof SESSION_TOKEN !== 'undefined' && SESSION_TOKEN) {
      try { sessionStorage.setItem('t212_expired', '1'); } catch (e) {}
      if (typeof logout === 'function') logout();
    }
    return r;
  };
  const _json = Response.prototype.json;
  Response.prototype.json = async function () {
    const d = await _json.call(this);
    return isWorker(this.url) ? defuse(d) : d;
  };
})();

// ── API ───────────────────────────────────────────────────────
let _cache = {};

async function api(table, params='') {
  const key = table + params;
  if (_cache[key]) return _cache[key];
  const r = await fetch(`${PROXY}/${table}${params}`);
  if (!r.ok) throw new Error(`${r.status} ${table}`);
  const d = await r.json();
  _cache[key] = d;
  return d;
}

// ── FORMAT HELPERS ────────────────────────────────────────────
function fmt(v, dec=2) { return v == null ? '—' : Number(v).toFixed(dec); }
function fmtGbp(v) {
  if (IS_GUEST) return '<span class="masked">***</span>';
  return v == null ? '—' : '£' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
}
function fmtGbpPlain(v) {
  if (IS_GUEST) return '***';
  return v == null ? '—' : '£' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
}
function clr(v) { return v > 0 ? 'green' : v < 0 ? 'red' : ''; }
function stars(n) { return '★'.repeat(n || 0) + '☆'.repeat(5-(n||0)); }
// Target price in the listing's own currency (Yahoo suffix): none → $, .L → pence, .DE/.AS/.PA → €
function fmtTarget(v, yahoo) {
  if (v == null) return '—';
  const s = yahoo || '';
  if (/\.L$/.test(s)) return Number(v).toFixed(2) + 'p';
  if (/\.(DE|AS|PA|MI|MC)$/.test(s)) return '€' + Number(v).toFixed(2);
  return /\./.test(s) ? Number(v).toFixed(2) : '$' + Number(v).toFixed(2);
}
// Analyst consensus badge, or a clearly different "Trend" badge when there is no analyst coverage (ETFs)
function badgeRating(r) {
  if (r && r.source === 'trend') return `<span class="badge trend" title="No analyst coverage — score from the price trend (MA50/MA200, 6-month return)">📈 TREND ${(r.recommendation||'').replace('_',' ').toUpperCase()}</span>`;
  return badgeRec(r && r.recommendation);
}
function badgeRec(r) {
  const cls = r === 'strong_buy' ? 'strong_buy' : r === 'buy' ? 'buy' : r === 'hold' ? 'hold' : 'sell';
  return `<span class="badge ${cls}">${(r||'—').replace('_',' ').toUpperCase()}</span>`;
}

// ── MASKING ───────────────────────────────────────────────────
function mask(val) {
  if (IS_GUEST) return '<span class="masked">***</span>';
  return val;
}
function maskPlain(val) {
  if (IS_GUEST) return '***';
  return val;
}

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

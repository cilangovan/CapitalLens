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
function badgeRec(r) {
  const cls = r === 'strong_buy' ? 'strong_buy' : r === 'buy' ? 'buy' : r === 'hold' ? 'hold' : 'sell';
  return `<span class="badge ${cls}">${(r||'—').replace('_',' ').toUpperCase()}</span>`;
}

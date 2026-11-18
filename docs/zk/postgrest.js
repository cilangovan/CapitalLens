// Evaluates the small PostgREST query dialect the dashboards use (select / filters / order / limit / JSON paths) over decrypted rows,
// so the existing dashboards run unchanged on end-to-end encrypted data. Pure functions, no network.
(function (root) {
  'use strict';
  const RESERVED = new Set(['select', 'order', 'limit', 'offset']);
  function splitList(s) { return s === '' ? [] : s.split(','); }
  function parse(params) {
    const qs = String(params || '').replace(/^\?/, ''), out = { select: ['*'], filters: [], order: [], limit: null, offset: 0 };
    for (const part of qs.split('&')) {
      if (!part) continue; const i = part.indexOf('='); const k = decodeURIComponent(i < 0 ? part : part.slice(0, i)), v = decodeURIComponent(i < 0 ? '' : part.slice(i + 1));
      if (k === 'select') out.select = splitList(v);
      else if (k === 'order') out.order = splitList(v).map(o => { const [col, dir, nulls] = o.split('.'); return { col, desc: dir === 'desc', nulls: nulls || null }; });
      else if (k === 'limit') out.limit = Math.max(0, parseInt(v, 10) || 0);
      else if (k === 'offset') out.offset = Math.max(0, parseInt(v, 10) || 0);
      else if (!RESERVED.has(k)) { const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(v); if (!m) throw new Error('unsupported filter ' + k + '=' + v); out.filters.push({ col: k, neg: !!m[1], op: m[2], val: m[3] }); }
    }
    return out;
  }
  const getPath = (row, col) => { const [head, ...rest] = col.split('->'); let v = row[head]; for (const k of rest) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } } v = v == null ? null : v[k]; } return v === undefined ? null : v; };
  const isNum = x => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)));
  const cmp = (a, b) => (isNum(a) && isNum(b) ? Number(a) - Number(b) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  function test(row, f) {
    const v = getPath(row, f.col); let r;
    switch (f.op) {
      case 'eq': r = v !== null && (isNum(v) && isNum(f.val) ? Number(v) === Number(f.val) : String(v) === f.val); break;
      case 'neq': r = v === null || !(isNum(v) && isNum(f.val) ? Number(v) === Number(f.val) : String(v) === f.val); break;
      case 'gt': r = v !== null && cmp(v, f.val) > 0; break; case 'gte': r = v !== null && cmp(v, f.val) >= 0; break;
      case 'lt': r = v !== null && cmp(v, f.val) < 0; break; case 'lte': r = v !== null && cmp(v, f.val) <= 0; break;
      case 'in': r = v !== null && splitList(f.val.replace(/^\(|\)$/g, '')).map(x => x.replace(/^"|"$/g, '')).some(x => (isNum(v) && isNum(x) ? Number(v) === Number(x) : String(v) === x)); break;
      case 'is': r = f.val === 'null' ? v === null : f.val === 'true' ? v === true : f.val === 'false' ? v === false : false; break;
      default: r = false;
    }
    return f.neg ? !r : r;
  }
  function run(rows, params) {
    const q = typeof params === 'object' ? params : parse(params);
    let out = rows.filter(r => q.filters.every(f => test(r, f)));
    if (q.order.length) out = out.map((r, i) => [r, i]).sort((x, y) => {
      for (const o of q.order) {
        const a = getPath(x[0], o.col), b = getPath(y[0], o.col); if (a === null && b === null) continue;
        const nullsFirst = o.nulls ? o.nulls === 'nullsfirst' : o.desc;      // Postgres: NULLS LAST for asc, NULLS FIRST for desc
        if (a === null) return nullsFirst ? -1 : 1; if (b === null) return nullsFirst ? 1 : -1;
        const c = cmp(a, b); if (c) return o.desc ? -c : c;
      } return x[1] - y[1];
    }).map(p => p[0]);
    if (q.offset) out = out.slice(q.offset);
    if (q.limit !== null) out = out.slice(0, q.limit);
    if (q.select.length === 1 && q.select[0] === '*') return out.map(r => Object.assign({}, r));
    return out.map(r => { const o = {}; for (const s of q.select) { if (s === '*') { Object.assign(o, r); continue; } const m = /^([^:]+):(.+)$/.exec(s); const alias = m ? m[1] : s.split('->').pop(), col = m ? m[2] : s; o[alias] = getPath(r, col); } return o; });
  }
  root.ZKQuery = { parse, run, getPath };
  if (typeof module !== 'undefined') module.exports = root.ZKQuery;
})(typeof window !== 'undefined' ? window : globalThis);

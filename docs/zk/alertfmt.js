// Port of services/alert_format.py (one house style for every alert). Pure functions, no network.
(function (root) {
  'use strict';
  const MINUS = '−';
  const NAMES = { ITWN: 'Taiwan', IPOL: 'Poland', IMIB: 'Italy', CS1: 'Spain', XDAX: 'Germany', IAEX: 'Netherlands', VFEM: 'Emerging Markets',
    VEVE: 'Developed World', SGLN: 'Gold', SSLN: 'Silver', VWCE: 'FTSE All-World', VUSA: 'S&P 500', SXRV: 'Nasdaq-100', QDVE: 'S&P 500 IT',
    FB: 'Meta', GOOGL: 'Alphabet', AAPL: 'Apple', MSFT: 'Microsoft', AMZN: 'Amazon', NVDA: 'Nvidia' };
  const CCY = { GBP: '£', USD: '$', EUR: '€' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function baseSymbol(t) {
    const core = (t || '').replace('_EQ', '');
    if (core.endsWith('_US')) return core.slice(0, -3);
    const m = core.match(/^([A-Z0-9.]+)[a-z]?$/);
    return m ? m[1] : core;
  }
  function friendly(t, metaName) {
    const sym = baseSymbol(t), name = NAMES[sym] || (metaName || '').trim();
    return name && name !== sym ? `${name} (${sym})` : sym;
  }
  const roundTo = (v, d) => { const m = Math.pow(10, d); return Math.round((v + Number.EPSILON * Math.sign(v)) * m) / m; };
  function signed(v, d = 2) {
    const s = Math.abs(v).toFixed(d);
    if (roundTo(v, d) === 0) return s;
    return (v > 0 ? '+' : MINUS) + s;
  }
  const pct = (v, d = 2, sign = true) => (sign ? signed(v, d) : v.toFixed(d)) + '%';
  function money(v, ccy) {
    const [ip, fp] = Math.abs(v).toFixed(3).split('.');
    let s = (v < 0 ? '-' : '') + ip.replace(/\B(?=(\d{3})+$)/g, ',') + '.' + fp;
    if (s.endsWith('0')) s = s.slice(0, -1);
    return CCY[ccy] ? CCY[ccy] + s : `${s} ${ccy}`;
  }
  const dayMonth = d => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const hhmm = d => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

  function Section(title) { this.title = title; this.blocks = []; }
  Section.prototype.table = function (left, right, rows) { this.blocks.push(['table', left, right, rows]); return this; };
  Section.prototype.line = function (text) { this.blocks.push(['line', text]); return this; };

  function renderTable(left, right, rows) {
    const w = Math.max(left.length, ...rows.map(r => r[0].length)) + 2;
    return [left.padEnd(w) + right, ...rows.map(([l, v]) => l.padEnd(w) + v)];
  }
  function renderText(sections) {
    const out = [];
    sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.title}`);
      for (const b of s.blocks) out.push(...(b[0] === 'table' ? renderTable(b[1], b[2], b[3]) : [b[1]]));
      out.push('');
    });
    return out.join('\n').replace(/\s+$/, '');
  }
  function renderPush(sections, limit = 3800) {
    const out = [];
    sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.title}`);
      for (const b of s.blocks) {
        if (b[0] === 'table') out.push(...b[3].map(([l, v]) => `• ${l}: ${v}`));
        else if (!b[1].startsWith('Source:')) out.push(b[1]);
      }
      out.push('');
    });
    let text = out.join('\n').replace(/\s+$/, '');
    if (text.length > limit) text = text.slice(0, limit).replace(/\n[^\n]*$/, '') + '\n… full report on the dashboard';
    return text;
  }
  root.ZKAlertFmt = { baseSymbol, friendly, signed, pct, money, dayMonth, hhmm, Section, renderText, renderPush };
  if (typeof module !== 'undefined') module.exports = root.ZKAlertFmt;
})(typeof window !== 'undefined' ? window : globalThis);

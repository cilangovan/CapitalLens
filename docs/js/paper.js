// ── PAPER TRADING (fake money, Swing tab) ─────────────────────
// A forward test, not a recommendation. Two fake accounts get the SAME deposit every week (the amount you type when you start it):
//   • Trend account: buys a stock when the Minervini trend template + 20-day breakout fires (the one book strategy that looked best
//     in the back-test, which did NOT confirm on fresh stocks) and sells when it closes under its 50-day average, falls 15%, or after 120 days.
//   • ETF account: puts the same deposit into a world index ETF every week (the bar the trend account has to beat).
// Honest fills: a signal is read on a COMPLETED daily bar and the order fills at the NEXT session's open (or is cancelled if the price ran
// away or is through the stop); every buy and sell pays a 0.2% fee. Nothing runs while the app is closed: the account catches up when you
// open the Swing tab, using the daily candles it fetches (missed weeks are credited and bought at that week's real open).
// The whole account is saved in your per-user settings (user_ui_prefs key __paper), so it follows your login. No real money, no orders sent.
// Pure maths first (paperStep, tested in tests/zk_paper_test.mjs), then the card.

const PP = { fee: 0.002, maxPos: 5, stopPct: 0.15, maxHold: 120, smaN: 50, etf: 'VWRP.L', strat: 'minervini', exit: 'hold50', keepTrades: 200, keepEquity: 400, keepSeen: 300 };
const PPS = (typeof module !== 'undefined' && typeof require === 'function') ? require('./swing.js') : { swSma, swStratSignal, swPrep, swR };

function ppEsc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); }
function ppGbp(n) { n = Number(n) || 0; const a = Math.abs(n); return (n < 0 ? '−' : '') + '£' + (a >= 1000 ? Math.round(a).toLocaleString('en-GB') : a.toFixed(2)); }
function ppPct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%'; }
function ppDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function ppMonday(ms) { const d = new Date(ms), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), wd = (new Date(t).getUTCDay() + 6) % 7; return t - wd * 86400000; }   // 00:00 UTC of that week's Monday
function ppWeekKey(ms) { return ppDay(ppMonday(ms)); }

function paperInit(weekly, nowMs) {
  weekly = Number(weekly); if (!(weekly >= 1 && weekly <= 100000)) throw new Error('Enter a weekly amount of £1 or more');
  return { v: 1, weekly, start: nowMs, weeks: [], dep: 0, seen: [], equity: [], run: null,
    trend: { cash: 0, pos: [], pending: [], closed: [] }, etf: { units: 0, buys: [] } };
}
function ppFirstAtOrAfter(t, ts) { for (let i = 0; i < t.length; i++) if (t[i] >= ts) return i; return -1; }
function ppFirstAfter(t, ts) { for (let i = 0; i < t.length; i++) if (t[i] > ts) return i; return -1; }

// data: { etf: { X, live, sessionOpen } | null, stocks: [{ sym, name, X, live, sessionOpen }] }  (X = swPrep() of daily candles)
function paperStep(S0, data, nowMs) {
  const S = JSON.parse(JSON.stringify(S0)), ev = [], W = S.weekly, fee = PP.fee;
  const note = (type, text, extra) => ev.push(Object.assign({ type, text, at: nowMs }, extra || {}));
  // 1 ── weekly deposits (every Monday-week since the account started; missed weeks are credited and bought at that week's real open)
  for (let m = ppMonday(S.start); m <= nowMs; m += 7 * 86400000) {
    const k = ppDay(m); if (S.weeks.includes(k)) continue;
    const E = data.etf && data.etf.X;
    if (!E) { note('wait', 'ETF prices not available yet: this week’s deposit waits'); break; }   // credit both accounts together or neither
    const first = k === ppWeekKey(S.start), i = first ? -1 : ppFirstAtOrAfter(E.t, m / 1000), px = i >= 0 ? E.o[i] : (data.etf.live || E.c[E.c.length - 1]), est = i < 0 && !first;   // the first week buys at the price when the account is started, never at an earlier open
    S.weeks.push(k); S.dep += W; S.trend.cash += W;
    const units = W * (1 - fee) / px; S.etf.units += units; S.etf.buys.unshift({ week: k, price: px, units, est });
    note('deposit', `Week of ${k}: ${W} added to both accounts; ETF buy at ${px.toFixed(2)}${est ? ' (estimated: that week is before the price history)' : ''}`);
  }
  S.etf.buys = S.etf.buys.slice(0, 120);
  // 2 ── trend account: pending buys fill at the next open
  const by = {}; (data.stocks || []).forEach(s => { by[s.sym] = s; });
  S.trend.pending = S.trend.pending.filter(p => {
    const s = by[p.sym]; if (!s) return true;
    const X = s.X, j = ppFirstAfter(X.t, p.signalT); if (j < 0) return true;                       // next session has not started: stay pending
    const open = X.o[j];
    if (open > p.ceiling) { note('cancel', `${p.name}: order cancelled, it opened at ${open.toFixed(2)}, above the entry ceiling ${p.ceiling.toFixed(2)} (price ran away)`); return false; }
    if (open <= p.stop) { note('cancel', `${p.name}: order cancelled, it opened through the stop`); return false; }
    if (S.trend.cash < W - 1e-9) { note('cancel', `${p.name}: order cancelled, not enough fake cash`); return false; }
    S.trend.cash -= W; S.trend.pos.push({ sym: p.sym, name: p.name, entry: open, qty: W * (1 - fee) / open, entryT: X.t[j], signalT: p.signalT, checkedT: X.t[j] - 1, exitPending: null });
    note('buy', `Bought ${p.name} at ${open.toFixed(2)} (signal ${ppDay(p.signalT * 1000)}, filled at the next open)`); return false;
  });
  // 3 ── trend account: exits (stop checked on every bar; the 50-day and time exits are read on COMPLETED closes and fill at the next open)
  S.trend.pos = S.trend.pos.filter(pos => {
    const s = by[pos.sym]; if (!s) return true; const X = s.X, n = X.c.length, ei = X.t.indexOf(pos.entryT), stopP = pos.entry * (1 - PP.stopPct);
    const j0 = ppFirstAfter(X.t, pos.checkedT); if (j0 < 0) return true;                                // nothing new since the last update
    for (let j = j0; j < n; j++) {
      const partial = !!s.sessionOpen && j === n - 1; let px = null, why = null;
      if (pos.exitPending) { px = X.o[j]; why = pos.exitPending; }
      else if (X.l[j] <= stopP) { px = X.o[j] < stopP ? X.o[j] : stopP; why = `stop (down ${Math.round(PP.stopPct * 100)}%)`; }
      if (px !== null) {
        const proceeds = pos.qty * px * (1 - fee), pnl = proceeds - W;
        S.trend.cash += proceeds; S.trend.closed.unshift({ sym: pos.sym, name: pos.name, entry: pos.entry, exit: px, entryT: pos.entryT, exitT: X.t[j], pnl, ret: proceeds / W - 1, why });
        note('sell', `Sold ${pos.name} at ${px.toFixed(2)}: ${why} (${pnl >= 0 ? '+' : '−'}${ppGbp(Math.abs(pnl))})`); return false;
      }
      if (partial) break;
      const m = PPS.swSma(X.c, PP.smaN, j + 1);
      if (m !== null && X.c[j] < m) pos.exitPending = 'closed below its 50-day average';
      else if (j - ei + 1 >= PP.maxHold) pos.exitPending = `${PP.maxHold}-day limit`;
      pos.checkedT = X.t[j];
    }
    return true;
  });
  S.trend.closed = S.trend.closed.slice(0, PP.keepTrades);
  // 4 ── trend account: new signals on the last COMPLETED bar become pending orders (never executed on the same bar)
  for (const s of data.stocks || []) {
    if (S.trend.pos.length + S.trend.pending.length >= PP.maxPos) break;
    if (S.trend.cash - S.trend.pending.length * W < W - 1e-9) break;
    if (S.trend.pos.some(p => p.sym === s.sym) || S.trend.pending.some(p => p.sym === s.sym)) continue;
    const X = s.X, i = X.c.length - 1 - (s.sessionOpen ? 1 : 0); if (i < 0) continue;
    const key = s.sym + ':' + X.t[i]; if (S.seen.includes(key)) continue;
    const sig = PPS.swStratSignal(X, i, PP.strat, PP.exit); if (!sig.entry) continue;
    S.seen.push(key); S.trend.pending.push({ sym: s.sym, name: s.name || s.sym, signalT: X.t[i], ceiling: sig.ceiling, stop: sig.stop, close: sig.trigger });
    note('signal', `${s.name || s.sym}: trend-template breakout on ${ppDay(X.t[i] * 1000)}, order queued for the next open`);
  }
  S.seen = S.seen.slice(-PP.keepSeen);
  // 5 ── value both accounts at the latest price and keep one point per day
  const last = d => d ? (d.live || d.X.c[d.X.c.length - 1]) : null;
  const tv = S.trend.cash + S.trend.pos.reduce((a, p) => { const d = by[p.sym], px = last(d); return a + p.qty * (px === null ? p.entry : px); }, 0);
  const ep = last(data.etf), ev2 = ep === null ? null : S.etf.units * ep;
  const day = ppDay(nowMs), pt = { d: day, trend: tv, etf: ev2, dep: S.dep }, k = S.equity.findIndex(e => e.d === day);
  if (S.dep > 0) { if (k >= 0) S.equity[k] = pt; else S.equity.push(pt); S.equity = S.equity.slice(-PP.keepEquity); }
  S.run = nowMs;
  return { state: S, events: ev };
}

// ── The card ──────────────────────────────────────────────────
const _pp = { state: null, loaded: false, busy: false, events: [], err: '', confirm: false, missing: [] };
async function ppReady() { for (let i = 0; i < 50; i++) { if (typeof ClPrefs === 'undefined' || ClPrefs.ready()) return; await new Promise(r => setTimeout(r, 200)); } }
function ppSave() { try { if (typeof ClPrefs !== 'undefined') ClPrefs.set('__paper', _pp.state); } catch (e) {} }

async function loadPaper() {
  const el = document.getElementById('paper-content'); if (!el) return;
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) { el.innerHTML = ''; return; }
  await ppReady(); try { _pp.state = (typeof ClPrefs !== 'undefined' && ClPrefs.get('__paper')) || null; } catch (e) { _pp.state = null; }
  _pp.loaded = true; renderPaper();
  if (_pp.state) paperRun();
}
function paperStart() {
  const i = document.getElementById('pp-weekly'); try { _pp.state = paperInit(i ? i.value : 0, Date.now()); _pp.err = ''; } catch (e) { _pp.err = e.message; renderPaper(); return; }
  ppSave(); renderPaper(); paperRun();
}
function paperResetAsk() { _pp.confirm = true; renderPaper(); }
function paperResetNo() { _pp.confirm = false; renderPaper(); }
function paperResetYes() { _pp.state = null; _pp.confirm = false; _pp.events = []; try { if (typeof ClPrefs !== 'undefined') ClPrefs.set('__paper', null); } catch (e) {} renderPaper(); }

async function paperRun() {
  if (_pp.busy || !_pp.state) return; _pp.busy = true; _pp.err = ''; renderPaper();
  try {
    const u = await swUniverse(), fetchOne = async (sym, name) => {
      const d = await swFetchCandles(sym, '2y'), X = swPrep(d.candles), meta = d.meta || {}, now = Date.now() / 1000, ss = meta.session;
      return { sym, name, X, live: swNum(meta.price), sessionOpen: !!(ss && now >= ss.start && now <= ss.end) };
    };
    let etf = null; try { etf = await fetchOne(PP.etf, 'World ETF'); } catch (e) { _pp.err = 'World ETF prices unavailable (' + (e.message || 'no data') + '): deposits wait.'; }
    const stocks = [], missing = [];
    for (const s of u.list) { try { stocks.push(await fetchOne(s.symbol, s.name)); } catch (e) { missing.push(s.name + ': ' + (e.message || 'no data')); } }
    const r = paperStep(_pp.state, { etf, stocks }, Date.now()); _pp.state = r.state; _pp.events = r.events.concat(_pp.events).slice(0, 12); _pp.missing = missing; _pp.scanned = stocks.length; ppSave();
  } catch (e) { _pp.err = e.message || String(e); }
  _pp.busy = false; renderPaper();
}

function ppSpark(eq) {
  const pts = eq.filter(e => e.trend !== null && e.etf !== null); if (pts.length < 2) return '<div style="font-size:11px;color:var(--muted)">The chart appears after the second day of data.</div>';
  const W = 320, H = 90, all = pts.flatMap(p => [p.trend, p.etf, p.dep]), lo = Math.min(...all), hi = Math.max(...all), sx = i => 4 + i * (W - 8) / (pts.length - 1), sy = v => H - 6 - (v - lo) / ((hi - lo) || 1) * (H - 12);
  const line = (k, c, dash) => `<polyline fill="none" stroke="${c}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ''} points="${pts.map((p, i) => sx(i).toFixed(1) + ',' + sy(p[k]).toFixed(1)).join(' ')}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:110px" role="img" aria-label="Paper account value over time">${line('dep', 'var(--muted)', true)}${line('etf', 'var(--accent)')}${line('trend', 'var(--green)')}</svg>
    <div style="font-size:10px;color:var(--muted)"><span style="color:var(--green)">━</span> Trend account · <span style="color:var(--accent)">━</span> World ETF · <span>┅</span> money put in</div>`;
}

function renderPaper() {
  const el = document.getElementById('paper-content'); if (!el || !_pp.loaded) return; const S = _pp.state;
  const head = '<h3>🧪 Paper trading (fake money)</h3>', note = '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">A forward test, not a recommendation: two fake accounts get the same deposit every week. No real money and no orders are ever sent.</div>';
  if (!S) { el.innerHTML = `<div class="card" id="paper-card">${head}${note}
      <div style="font-size:12px;line-height:1.6;margin-bottom:10px">Start a fake account to see, week by week, whether the trend-template strategy really beats just buying a world index ETF with the same money. Type the weekly amount you would invest.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="pp-weekly" type="number" inputmode="decimal" min="1" step="1" placeholder="Weekly amount in £" style="flex:1 1 150px;min-width:0;min-height:44px;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:16px">
      <button type="button" onclick="paperStart()" style="min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">Start paper account</button></div>
      ${_pp.err ? `<div style="color:var(--red);font-size:12px;margin-top:8px">${ppEsc(_pp.err)}</div>` : ''}</div>`; return; }
  const T = S.trend, last = S.equity[S.equity.length - 1] || { trend: T.cash, etf: null, dep: S.dep }, dep = S.dep || 0;
  const tv = last.trend, ev = last.etf, row = (a, b, c) => `<div class="stat-card"><div class="label">${a}</div><div class="value">${b}</div><div class="sub">${c}</div></div>`;
  const pnl = (v) => dep > 0 && v !== null ? `${v - dep >= 0 ? '+' : '−'}${ppGbp(Math.abs(v - dep))} (${ppPct(v / dep - 1)})` : '—';
  const days = Math.max(0, Math.floor((Date.now() - S.start) / 86400000)), thin = S.equity.length < 2 || days < 28;
  const cls = v => (v - dep >= 0 ? 'green' : 'red');
  const ahead = tv !== null && ev !== null ? tv - ev : null;
  const posHtml = T.pos.length ? T.pos.map(p => { const s = null; return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><b>${ppEsc(p.name)}</b> <span style="color:var(--muted)">bought ${ppDay(p.entryT * 1000)} at ${p.entry.toFixed(2)}${p.exitPending ? ' · <span style="color:var(--yellow)">exit queued: ' + ppEsc(p.exitPending) + '</span>' : ''}</span></div>`; }).join('') : '<div style="font-size:12px;color:var(--muted)">No open paper positions. No signal, no trade: cash waits.</div>';
  const pendHtml = T.pending.length ? `<div style="font-size:12px;margin-top:6px">⏳ Queued for the next open: ${T.pending.map(p => ppEsc(p.name)).join(', ')}</div>` : '';
  const closed = T.closed.slice(0, 8).map(c => `<div style="padding:5px 0;border-bottom:1px solid var(--border);font-size:11px"><b>${ppEsc(c.name)}</b> ${ppDay(c.entryT * 1000)} → ${ppDay(c.exitT * 1000)} <span class="${c.pnl >= 0 ? 'green' : 'red'}">${ppPct(c.ret)}</span> <span style="color:var(--muted)">${ppEsc(c.why)}</span></div>`).join('');
  const wins = T.closed.filter(c => c.pnl > 0).length;
  el.innerHTML = `<div class="card" id="paper-card">${head}${note}
    <div class="stats-strip" style="margin-bottom:8px">
      ${row('Put in', ppGbp(dep), `${ppGbp(S.weekly)} a week · ${S.weeks.length} week${S.weeks.length === 1 ? '' : 's'}`)}
      ${row('Trend account', tv === null ? '—' : `<span class="${cls(tv)}">${ppGbp(tv)}</span>`, pnl(tv))}
      ${row('World ETF', ev === null ? '—' : `<span class="${cls(ev)}">${ppGbp(ev)}</span>`, pnl(ev))}</div>
    <div style="font-size:12px;margin-bottom:8px">${ahead === null ? '' : ahead >= 0 ? `Trend account is <b class="green">${ppGbp(ahead)} ahead</b> of the ETF.` : `Trend account is <b class="red">${ppGbp(-ahead)} behind</b> the ETF.`} ${thin ? '<span style="color:var(--yellow)">Too early to mean anything: judge after 8–12 weeks and 20+ closed trades.</span>' : ''}</div>
    ${ppSpark(S.equity)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button type="button" onclick="paperRun()" style="min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">${_pp.busy ? 'Updating…' : '↻ Update now'}</button>
      ${_pp.confirm ? `<button type="button" onclick="paperResetYes()" style="min-height:44px;padding:8px 14px;border:1px solid var(--red);border-radius:8px;background:transparent;color:var(--red);font-size:13px;cursor:pointer">Yes, delete this paper account</button><button type="button" onclick="paperResetNo()" style="min-height:44px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-size:13px;cursor:pointer">Keep it</button>`
        : `<button type="button" onclick="paperResetAsk()" style="min-height:44px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--muted);font-size:13px;cursor:pointer">Reset</button>`}</div>
    ${_pp.err ? `<div style="color:var(--red);font-size:12px;margin-bottom:8px">${ppEsc(_pp.err)}</div>` : ''}
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px">Trend account · cash ${ppGbp(T.cash)}</div>${posHtml}${pendHtml}
    ${T.closed.length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px">Closed (${T.closed.length}, ${wins} winners)</div>${closed}` : ''}
    ${_pp.events.length ? `<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px">Latest activity</div><div style="font-size:11px;color:var(--muted);line-height:1.6">${_pp.events.map(e => ppEsc(e.text)).join('<br>')}</div>` : ''}
    <details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted);min-height:40px;display:flex;align-items:center">How this is simulated</summary><div style="font-size:11px;color:var(--muted);line-height:1.7;padding:6px 2px">
      <b>Deposits:</b> each Monday-week both accounts get your weekly amount. The ETF account buys the world ETF (${PP.etf}) at that week's open. <b>Trend account:</b> buys your weekly amount of a stock when the Minervini trend template and a 20-day breakout on 1.5× volume fire on a completed day, at the next open, up to ${PP.maxPos} at a time. It sells at the next open after the stock closes under its 50-day average, immediately on a ${Math.round(PP.stopPct * 100)}% fall, or after ${PP.maxHold} days.<br>
      <b>Universe:</b> the stocks the Swing tab scans (your holdings outside pies and your Good-quality watchlist stocks), ${_pp.scanned === undefined ? 'not scanned yet' : _pp.scanned + ' scanned this time'}. Add more stocks to your watchlist to widen it.${_pp.missing.length ? '<br><b>No data for:</b> ' + _pp.missing.map(ppEsc).join('; ') : ''}<br>
      <b>Costs:</b> ${PP.fee * 100}% on every buy and sell. Prices are Yahoo daily data. The account only updates when this tab is open. <b>Why:</b> the back-test of this strategy did not hold up on stocks it had not seen, so this tests it on real future prices before any real money is considered.</div></details></div>`;
}

if (typeof module !== 'undefined') module.exports = { PP, paperInit, paperStep, ppMonday, ppWeekKey };

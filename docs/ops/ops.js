// Internal platform operations page. Access is enforced in Postgres (ops_* functions: listed in platform_admins AND signed in with a
// second factor); this page only displays what those functions return. Nothing is stored in the browser: the session lives in memory.
(function (root) {
  'use strict';
  const BASE = 'https://ggprfdetivzekjxlpvyq.supabase.co', KEY = 'sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK';
  const REPO = 'cilangovan/CapitalLens';

  // ── pure helpers (unit tested) ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + ' ' + u[i]; };
  // growth = latest vs the earliest snapshot, per day; null when there are fewer than two days (never invent a trend)
  function growth(daily) {
    const d = (daily || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day)));
    if (d.length < 2) return null;
    const a = d[0], b = d[d.length - 1], days = Math.max(1, Math.round((new Date(b.day) - new Date(a.day)) / 864e5));
    return { days, perDayBytes: (b.db_bytes - a.db_bytes) / days, from: a.day, to: b.day };
  }
  function runSummary(runs) {
    const r = (runs || []).filter(x => x && x.status === 'completed');
    const failed = r.filter(x => x.conclusion === 'failure' || x.conclusion === 'timed_out');
    return { total: r.length, failed: failed.length, last: r[0] || null };
  }
  const api = { esc, bytes, growth, runSummary };
  if (typeof module !== 'undefined') module.exports = api;
  root.OPS = api;
  if (typeof document === 'undefined') return;

  // ── session (memory only) ──
  let tok = null;
  const $ = id => document.getElementById(id), show = (id, on) => $(id).classList.toggle('hide', !on), say = (id, m) => { $(id).textContent = m || ''; };
  async function call(path, opts = {}) {
    const h = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}, opts.headers || {});
    const r = await fetch(BASE + path, Object.assign({}, opts, { headers: h }));
    let d = null; try { d = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, d };
  }
  async function login() {
    say('login-err', ''); const email = $('em').value.trim(), password = $('pw').value; if (!email || !password) return say('login-err', 'Enter email and password');
    $('btn-login').disabled = true;
    try {
      const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (!r.ok) return say('login-err', 'Sign-in failed');
      tok = r.d.access_token; $('pw').value = '';
      const u = await call('/auth/v1/user'); const f = ((u.d && u.d.factors) || []).find(x => x.factor_type === 'totp' && x.status === 'verified');
      if (f) return askCode(f.id, false);
      const e = await call('/auth/v1/factors', { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'ops-' + Date.now() }) });
      if (!e.ok) return say('login-err', 'Could not start second-factor setup');
      $('mfa-secret').textContent = (e.d.totp && e.d.totp.secret) || ''; askCode(e.d.id, true);
    } catch (x) { say('login-err', 'Network error'); } finally { $('btn-login').disabled = false; }
  }
  let factorId = null;
  function askCode(id, enrol) { factorId = id; show('login', false); show('mfa', true); show('mfa-enrol', enrol); $('mfa-code').value = ''; $('mfa-code').focus(); }
  async function verify() {
    say('mfa-err', ''); const code = $('mfa-code').value.trim(); if (!/^\d{6}$/.test(code)) return say('mfa-err', 'Enter the 6-digit code');
    $('btn-mfa').disabled = true;
    try {
      const c = await call('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', body: '{}' }); if (!c.ok) return say('mfa-err', 'Challenge failed');
      const v = await call('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', body: JSON.stringify({ challenge_id: c.d.id, code }) });
      if (!v.ok) return say('mfa-err', 'Wrong code');
      tok = v.d.access_token; show('mfa', false); show('app', true); await load();
    } catch (x) { say('mfa-err', 'Network error'); } finally { $('btn-mfa').disabled = false; }
  }
  function signOut() { if (tok) call('/auth/v1/logout', { method: 'POST' }).catch(() => {}); tok = null; location.reload(); }

  // ── render ──
  const tile = (l, v, s) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s || '')}</div></div>`;
  const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="dim">Nothing yet</td></tr>`}</tbody></table>`;
  async function load() {
    $('stamp').textContent = 'loading…';
    const mine = await call('/rest/v1/rpc/ops_is_admin', { method: 'POST', body: '{}' });
    if (!mine.ok || mine.d !== true) {
      const listed = await call('/rest/v1/rpc/ops_has_admin_row', { method: 'POST', body: '{}' });
      show('denied', true); $('denied').textContent = listed.d === true ? 'Listed as staff, but the second factor is missing for this session.' : 'This account is not platform staff.';
      $('stamp').textContent = ''; return;
    }
    show('denied', false);
    await call('/rest/v1/rpc/ops_record_daily', { method: 'POST', body: '{}' });
    const o = await call('/rest/v1/rpc/ops_overview', { method: 'POST', body: '{}' });
    if (!o.ok) { $('stamp').textContent = ''; show('denied', true); $('denied').textContent = 'Could not load (' + o.status + ').'; return; }
    const d = o.d, g = growth(d.daily), topB = Math.max(1, ...(d.tables || []).map(t => +t.bytes || 0));
    $('stats').innerHTML = tile('Database size', bytes(d.db_bytes), g ? `${bytes(Math.max(0, g.perDayBytes))}/day since ${g.from}` : 'growth shows after 2 days of snapshots')
      + tile('Users', d.users, 'sign-ups in 30 days: ' + (d.signups_by_day || []).reduce((a, x) => a + x.n, 0))
      + tile('Active 24h / 7d / 30d', `${d.active_1d} / ${d.active_7d} / ${d.active_30d}`, 'by last sign-in')
      + tile('Encrypted records', d.enc_rows, 'counts only');
    $('growth').innerHTML = table(['Day', 'DB size', 'Records', 'Users', 'Active 7d', 'Sign-ups'], (d.daily || []).slice().reverse().slice(0, 30).map(x => [esc(x.day), esc(bytes(x.db_bytes)), esc(x.enc_rows), esc(x.users), esc(x.active_7d), esc(x.signups)]));
    $('tables').innerHTML = table(['Table', 'Size', 'Rows (estimate)', ''], (d.tables || []).slice(0, 15).map(t => [esc(t.name), esc(bytes(t.bytes)), esc(t.rows), `<div class="bar" style="width:${Math.max(2, Math.round((+t.bytes || 0) / topB * 120))}px"></div>`]));
    $('kinds').innerHTML = table(['Kind', 'Records'], Object.entries(d.enc_by_kind || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => [esc(k), esc(n)]));
    $('signups').innerHTML = table(['Day', 'New users'], (d.signups_by_day || []).map(x => [esc(x.day), esc(x.n)]));
    $('audit').innerHTML = table(['Actor', 'Table', 'Operation', 'Events'], (d.audit_7d || []).map(x => [esc(x.actor), esc(x.table), esc(x.op), esc(x.n)]));
    $('stamp').textContent = 'Updated ' + new Date(d.generated_at).toLocaleString('en-GB');
    loadRuns();
  }
  async function loadRuns() {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(r.status); const runs = (await r.json()).workflow_runs || [], s = runSummary(runs);
      $('runs').innerHTML = `<div class="dim">${s.failed} failed of the last ${s.total} finished runs (public GitHub data).</div>` + table(['Workflow', 'Result', 'Branch', 'When'],
        runs.slice(0, 15).map(x => [esc(x.name), `<span class="${x.conclusion === 'success' ? 'ok' : x.status !== 'completed' ? 'warn' : 'bad'}">${esc(x.conclusion || x.status)}</span>`, esc(x.head_branch), esc(new Date(x.created_at).toLocaleString('en-GB'))]));
    } catch (e) { $('runs').innerHTML = '<span class="dim">GitHub run data is unavailable right now (rate limit or network). Nothing is assumed.</span>'; }
  }
  $('btn-login').onclick = login; $('btn-mfa').onclick = verify; $('btn-refresh').onclick = load; $('btn-out').onclick = signOut;
  $('pw').onkeydown = e => { if (e.key === 'Enter') login(); }; $('mfa-code').onkeydown = e => { if (e.key === 'Enter') verify(); };
})(typeof window !== 'undefined' ? window : globalThis);

// ── HELP ASSISTANT (epic #54, every dashboard) ─────────────────────────────
// A ❓ button (bottom-left) that opens a chat sheet. It answers how-to / documentation questions only, from the published help pages, through the
// separate capitallens-help worker (free open-source model on Cloudflare Workers AI). It never sees holdings, ciphertext, keys or Trading 212 credentials:
// the only thing sent is the question typed here (plus the last few turns of this chat, kept in the browser only) and the sign-in token, so the worker can
// confirm you are signed in. Messages that look like a key, password or card number are blocked here and again on the server.
// Pure helpers first (tested in tests/zk_helpbot_test.mjs), then the widget. CSS-only loading animation (.loading.busy), theme variables only, no inline scripts.

const HB_URL = 'https://capitallens-help.itsme-daf.workers.dev/help/ask';
const HB_MAX = 500, HB_HISTORY = 4;

function hbLuhn(d) { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; }
function hbLooksSensitive(text) {                       // same rules as the worker: key/secret, card number, "my password is ..."
  const t = String(text || '');
  if (/[A-Za-z0-9+/_=-]{32,}/.test(t)) return true;
  for (const m of t.matchAll(/(?:\d[ -]?){13,19}/g)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 13 && d.length <= 19 && hbLuhn(d)) return true; }
  return /\b(my|the)?\s*(password|passphrase|recovery (key|phrase)|api[ _-]?secret|secret key)\s*(is|:|=)/i.test(t);
}
function hbPortalBase(doc) {                            // the footer 📘 link already points at the portal from every dashboard (help/ or ../help/)
  const a = doc && doc.querySelector ? doc.querySelector('a[href$="help/"]') : null;
  return a && a.href ? a.href : 'https://cilangovan.github.io/CapitalLens/help/';
}
function hbSourceUrl(base, rel) { return /^[a-z]+:|^\/\//i.test(String(rel)) ? null : base + String(rel).replace(/^\/+/, ''); }
function hbHistory(msgs) { return msgs.filter(m => (m.role === 'user' || m.role === 'assistant') && m.text && !m.err).slice(-HB_HISTORY).map(m => ({ role: m.role, content: String(m.text).slice(0, 600) })); }
function hbErrorText(status, body) {                    // plain, honest messages; never an internal detail
  if (status === 401) return 'Please sign in again to use Help.';
  if (status === 429) return 'Too many questions for now. Please try again later or open the Documentation (footer link).';
  if (status === 503) return 'The help assistant is switched off right now. Please use the Documentation (footer link).';
  if (status === 400 && body && body.error === 'sensitive') return body.message || 'Please do not type keys, passwords or card numbers here.';
  if (status === 400 || status === 413) return 'Please ask a shorter question (up to ' + HB_MAX + ' characters).';
  return 'The help assistant is unavailable right now. Please use the Documentation (footer link).';
}

function hbToken() { return (typeof SESSION_TOKEN !== 'undefined' && SESSION_TOKEN) ? SESSION_TOKEN : null; }

async function hbAsk(question, history, fetchImpl) {   // -> {ok, answer, sources, found} | {ok:false, text}
  const token = hbToken(); if (!token) return { ok: false, text: hbErrorText(401) };
  try {
    const r = await (fetchImpl || fetch)(HB_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ question, history }) });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || typeof body.answer !== 'string') return { ok: false, text: hbErrorText(r.status, body) };
    return { ok: true, answer: body.answer, sources: Array.isArray(body.sources) ? body.sources.slice(0, 3) : [], found: body.found !== false };
  } catch (e) { return { ok: false, text: hbErrorText(0) }; }
}

// ── widget ──
const HB = { msgs: [], busy: false, open: false, built: false };
function hbEl(tag, props, kids) { const e = document.createElement(tag); Object.assign(e, props || {}); (kids || []).forEach(k => e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k)); return e; }
function hbBuild() {
  if (HB.built || typeof document === 'undefined' || !document.body) return; HB.built = true;
  const st = document.createElement('style');
  st.textContent = `
  #hb-btn{position:fixed;left:14px;bottom:14px;z-index:45;width:48px;height:48px;border-radius:50%;border:1px solid var(--border);background:var(--accent);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 18px #0006;display:none;align-items:center;justify-content:center}
  #hb-sheet{position:fixed;left:0;bottom:0;z-index:60;width:min(100vw,460px);height:min(78vh,560px);display:none;flex-direction:column;background:var(--bg2);border:1px solid var(--border);border-radius:14px 14px 0 0;box-shadow:0 -6px 30px #0008;color:var(--text);font-size:14px}
  #hb-sheet.open{display:flex}
  #hb-head{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--border)}
  #hb-head b{flex:1}
  #hb-head button,#hb-send{min-height:40px;min-width:40px;border:1px solid var(--border);background:var(--bg3);color:var(--text);border-radius:8px;cursor:pointer;font-size:13px;padding:0 10px}
  #hb-log{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  .hb-m{max-width:92%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-word;line-height:1.4}
  .hb-u{align-self:flex-end;background:var(--accent);color:#fff}
  .hb-a{align-self:flex-start;background:var(--bg3);border:1px solid var(--border)}
  .hb-e{align-self:flex-start;background:var(--bg3);border:1px solid var(--red);color:var(--text)}
  .hb-src{margin-top:6px;font-size:12px;color:var(--muted);white-space:normal}
  .hb-src a{color:var(--accent);display:inline-block;padding:6px 0;margin-right:10px;min-height:24px}
  #hb-note{padding:4px 12px;font-size:11px;color:var(--muted)}
  #hb-form{display:flex;gap:6px;padding:8px 12px 12px}
  #hb-in{flex:1;min-width:0;min-height:40px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;padding:0 10px;font-size:16px}
  #hb-send{background:var(--accent);color:#fff}`;
  document.head.appendChild(st);
  const btn = hbEl('button', { id: 'hb-btn', type: 'button', title: 'Help', textContent: '❓' }); btn.setAttribute('aria-label', 'Open the help assistant');
  const log = hbEl('div', { id: 'hb-log' }); log.setAttribute('aria-live', 'polite');
  const input = hbEl('input', { id: 'hb-in', type: 'text', maxLength: HB_MAX, placeholder: 'Ask how something works…' }); input.setAttribute('aria-label', 'Your question'); input.setAttribute('autocomplete', 'off');
  const send = hbEl('button', { id: 'hb-send', type: 'submit', textContent: 'Ask' });
  const clear = hbEl('button', { type: 'button', textContent: 'Clear' }), close = hbEl('button', { type: 'button', textContent: '✕' }); close.setAttribute('aria-label', 'Close help');
  const form = hbEl('form', { id: 'hb-form' }, [input, send]);
  const sheet = hbEl('div', { id: 'hb-sheet' }, [hbEl('div', { id: 'hb-head' }, [hbEl('b', { textContent: '❓ Help' }), clear, close]), log,
    hbEl('div', { id: 'hb-note', textContent: 'AI can be wrong: check the linked page. Help answers how CapitalLens works, never what to buy or sell. Do not type keys or passwords.' }), form]);
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Help assistant');
  document.body.appendChild(btn); document.body.appendChild(sheet);
  HB.btn = btn; HB.sheet = sheet; HB.log = log; HB.input = input; HB.send = send;
  btn.addEventListener('click', () => hbOpen(!HB.open)); close.addEventListener('click', () => hbOpen(false));
  clear.addEventListener('click', () => { HB.msgs = []; hbRender(); });
  form.addEventListener('submit', ev => { ev.preventDefault(); hbSubmit(); });
  hbRender();
}
function hbOpen(on) { HB.open = !!on; if (HB.sheet) HB.sheet.classList.toggle('open', HB.open); if (HB.open && HB.input) HB.input.focus(); }
function hbRender() {
  const log = HB.log; if (!log) return; log.textContent = '';
  if (!HB.msgs.length) log.appendChild(hbEl('div', { className: 'hb-m hb-a', textContent: 'Hi! Ask me how something in CapitalLens works, for example "How do I turn on the live feed?" or "What is the Dip Planner?".' }));
  const base = hbPortalBase(document);
  for (const m of HB.msgs) {
    const d = hbEl('div', { className: 'hb-m ' + (m.role === 'user' ? 'hb-u' : m.err ? 'hb-e' : 'hb-a'), textContent: m.text });          // textContent: never HTML
    if (m.sources && m.sources.length) {
      const s = hbEl('div', { className: 'hb-src' }, ['Sources: ']);
      for (const x of m.sources) { const u = hbSourceUrl(base, x.url); if (!u) continue; const a = hbEl('a', { href: u, target: '_blank', rel: 'noopener', textContent: String(x.title || 'Help page').slice(0, 80) }); s.appendChild(a); }
      d.appendChild(s);
    }
    log.appendChild(d);
  }
  if (HB.busy) log.appendChild(hbEl('div', { className: 'loading busy', textContent: 'Looking it up…' }));
  log.scrollTop = log.scrollHeight;
}
async function hbSubmit() {
  if (HB.busy) return; const q = HB.input.value.trim(); if (!q) return;
  if (q.length > HB_MAX) { HB.msgs.push({ role: 'assistant', text: hbErrorText(400), err: true }); hbRender(); return; }
  if (hbLooksSensitive(q)) { HB.msgs.push({ role: 'assistant', text: 'Please do not type keys, passwords or card numbers here. I never need them. (Nothing was sent.)', err: true }); HB.input.value = ''; hbRender(); return; }
  const history = hbHistory(HB.msgs); HB.msgs.push({ role: 'user', text: q }); HB.input.value = ''; HB.busy = true; HB.send.disabled = true; hbRender();
  const r = await hbAsk(q, history);
  HB.busy = false; HB.send.disabled = false;
  HB.msgs.push(r.ok ? { role: 'assistant', text: r.answer, sources: r.sources } : { role: 'assistant', text: r.text, err: true }); hbRender();
}
function hbSync() { hbBuild(); if (!HB.btn) return; const on = !!hbToken(); HB.btn.style.display = on ? 'flex' : 'none'; if (!on) { hbOpen(false); if (HB.msgs.length) { HB.msgs = []; hbRender(); } } }   // only while signed in; chat is wiped on sign-out

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => { hbSync(); setInterval(hbSync, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
if (typeof module !== 'undefined') module.exports = { hbLooksSensitive, hbPortalBase, hbSourceUrl, hbHistory, hbErrorText, hbAsk, HB_URL };

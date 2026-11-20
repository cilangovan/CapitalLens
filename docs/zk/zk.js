// Prototype page for zero-knowledge sign-up / login / password change / recovery (demo project only).
// All secrets (password, data key, recovery key) stay in this browser. The server receives a derived login secret,
// salts, wrapped keys and ciphertext.
(() => {
  'use strict';
  const BASE = 'https://ggprfdetivzekjxlpvyq.supabase.co', KEY = 'sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK';
  const $ = id => document.getElementById(id);
  const VIEWS = ['auth', 'upgrade', 'recovery', 'reset', 'app'];
  const show = v => VIEWS.forEach(n => { const el = $('v-' + n); if (el) el.classList.toggle('hide', n !== v); });
  const S = { token: null, uid: null, email: null, dk: null, keys: null };
  const say = (id, msg) => { $(id).textContent = msg || ''; };
  const MIN_PW = 10;

  async function call(path, opt, token) {
    const r = await fetch(BASE + path, Object.assign({}, opt, {
      headers: Object.assign({ apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || KEY) }, (opt && opt.headers) || {}),
    }));
    let d = null; try { d = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, d };
  }
  const uidOf = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) { return null; } };
  const errOf = r => (r.d && (r.d.msg || r.d.error_description || r.d.message || r.d.error)) || ('Error ' + r.status);
  const pendKey = email => 'zk_pending:' + email.toLowerCase();
  const keyRow = st => ({ kdf: st.kdf, pw_salt: st.pw_salt, rec_salt: st.rec_salt, wrapped_dk_pw: st.wrapped_dk_pw, wrapped_dk_rec: st.wrapped_dk_rec, key_version: st.key_version });

  async function exportDk(dk) { return ZK.b64(new Uint8Array(await crypto.subtle.exportKey('raw', dk))); }
  const importDk = b => crypto.subtle.importKey('raw', ZK.unb64(b), 'AES-GCM', true, ['encrypt', 'decrypt']);
  async function remember() {
    try { sessionStorage.setItem('zk_token', S.token); sessionStorage.setItem('zk_email', S.email || ''); sessionStorage.setItem('zk_dk', await exportDk(S.dk)); } catch (e) {}
  }
  const uploadKeys = (store, token) => call('/rest/v1/user_keys', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(keyRow(store)) }, token);
  const fetchKeys = token => call('/rest/v1/user_keys?select=*', {}, token);

  // ── sign up ──
  async function signup() {
    say('su-err', '');
    const email = $('su-email').value.trim(), pw = $('su-pw').value;
    if (!email) return say('su-err', 'Enter your email');
    if (pw.length < MIN_PW) return say('su-err', 'Password must be at least ' + MIN_PW + ' characters');
    if (pw !== $('su-pw2').value) return say('su-err', 'Passwords do not match');
    $('btn-signup').disabled = true;
    try {
      const acct = await ZK.createAccount(pw);
      const r = await call('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password: acct.authSecret }) });
      if (!r.ok) return say('su-err', errOf(r));
      const ids = r.d && (Array.isArray(r.d.identities) ? r.d.identities : (r.d.user && r.d.user.identities));
      if (Array.isArray(ids) && ids.length === 0) return say('su-err', 'An account with this email already exists, so no new account was made and NO recovery key was created. Log in, or use "Forgot password".');
      S.email = email; S.dk = acct.dk; S.keys = acct.store;
      $('rec-key').textContent = acct.recoveryKey;
      if (r.d && r.d.access_token) {
        S.token = r.d.access_token; S.uid = uidOf(S.token);
        const k = await uploadKeys(acct.store, S.token);
        if (!k.ok) return say('su-err', 'Could not save your keys: ' + errOf(k));
        say('rec-msg', 'Account created.');
      } else {                       // email confirmation required: keep the (encrypted) key material here until first login
        try { localStorage.setItem(pendKey(email), JSON.stringify(acct.store)); } catch (e) {}
        say('rec-msg', 'Check your email to confirm, then log in on this browser.');
      }
      show('recovery');
    } catch (e) { say('su-err', 'Something went wrong: ' + e.message); }
    finally { $('btn-signup').disabled = false; }
  }
  $('rec-ok').onchange = () => { $('btn-rec-continue').disabled = !$('rec-ok').checked; };
  $('btn-rec-continue').onclick = async () => {
    $('rec-key').textContent = '';
    if (S.pendingUpgrade) await finishUpgrade();
    else if (S.token) { await remember(); enterApp(); } else { S.dk = null; show('auth'); }
  };

  // ── log in ──
  async function loginParams(email) {
    try { const p = JSON.parse(localStorage.getItem(pendKey(email)) || 'null'); if (p) return { pw_salt: p.pw_salt, kdf: p.kdf }; } catch (e) {}
    const r = await call('/rest/v1/rpc/zk_login_params', { method: 'POST', body: JSON.stringify({ p_email: email }) });
    return r.ok ? r.d : null;
  }
  async function login() {
    say('li-err', '');
    const email = $('li-email').value.trim(), pw = $('li-pw').value;
    if (!email || !pw) return say('li-err', 'Enter email and password');
    $('btn-login').disabled = true;
    try {
      const prm = await loginParams(email);
      if (!prm) return say('li-err', 'Could not reach the server');
      const { authSecret } = await ZK.deriveKeys(pw, prm.pw_salt, prm.kdf && prm.kdf.iterations);
      const t = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: authSecret }) });
      if (!t.ok || !t.d.access_token) return say('li-err', 'Invalid email or password');
      let keys = null; const kr = await fetchKeys(t.d.access_token);
      if (kr.ok && kr.d.length) keys = kr.d[0];
      else {
        let pend = null; try { pend = JSON.parse(localStorage.getItem(pendKey(email)) || 'null'); } catch (e) {}
        if (pend && (await uploadKeys(pend, t.d.access_token)).ok) { keys = pend; try { localStorage.removeItem(pendKey(email)); } catch (e) {} }
      }
      if (!keys) return say('li-err', 'This account has no encryption keys yet.');
      const u = await ZK.unlockWithPassword(pw, keys);
      S.token = t.d.access_token; S.uid = uidOf(S.token); S.email = email; S.dk = u.dk; S.keys = keys;
      await remember(); enterApp();
    } catch (e) { say('li-err', 'Could not unlock: ' + e.message); }
    finally { $('btn-login').disabled = false; }
  }


  // ── upgrade an existing (plaintext) account ──
  const ulog = m => { $('up-log').textContent += m + '\n'; };
  async function upgrade() {
    say('up-err', ''); $('up-log').textContent = '';
    const email = $('up-email').value.trim(), oldPw = $('up-old').value, newPw = $('up-new').value;
    if (!email || !oldPw) return say('up-err', 'Enter your email and current password');
    if (newPw.length < MIN_PW) return say('up-err', 'New password must be at least ' + MIN_PW + ' characters');
    if ($('up-new2') && $('up-new2').value !== newPw) return say('up-err', 'The two NEW passwords do not match');
    if (newPw.toLowerCase() === oldPw.toLowerCase()) return say('up-err', 'The new password must be different from the old one');
    $('btn-upgrade').disabled = true;
    try {
      const t = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: oldPw }) });
      if (!t.ok || !t.d.access_token) return say('up-err', 'Invalid email or current password');
      const token = t.d.access_token, uid = uidOf(token);
      const existing = await fetchKeys(token);
      if (existing.ok && existing.d.length) return say('up-err', 'This account is already private. Log in normally.');
      ulog('Creating your keys…');
      const acct = await ZK.createAccount(newPw);
      const k = await uploadKeys(acct.store, token);
      if (!k.ok) return say('up-err', 'Could not save keys: ' + errOf(k));
      const ctx = { call, token, uid, dk: acct.dk };
      await ZKMigrate.encryptAll(ctx, ulog);
      const rep = await ZKMigrate.verify(ctx, ulog);
      const bad = rep.filter(x => !x.same);
      ulog(rep.map(x => `${x.table}: ${x.plain} → ${x.enc} ${x.same ? 'OK' : 'MISMATCH'}`).join('\n'));
      if (bad.length) return say('up-err', 'Verification failed for: ' + bad.map(x => x.table).join(', ') + '. Nothing was changed; your old password still works.');
      S.pendingUpgrade = { token, uid, acct, email };
      $('rec-key').textContent = acct.recoveryKey; say('rec-msg', 'Your data is encrypted and verified. Save this key, then continue to finish switching your password.');
      $('rec-ok').checked = false; $('btn-rec-continue').disabled = true; show('recovery');
    } catch (e) { say('up-err', 'Something went wrong (nothing was deleted, old password still works): ' + e.message); }
    finally { $('btn-upgrade').disabled = false; }
  }
  async function finishUpgrade() {
    const u = S.pendingUpgrade; S.pendingUpgrade = null;
    const a = await call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: u.acct.authSecret }) }, u.token);
    if (!a.ok) { show('upgrade'); return say('up-err', 'Could not switch the password: ' + errOf(a) + ' (your old password still works; run the upgrade again)'); }
    Object.assign(S, { token: u.token, uid: u.uid, email: u.email, dk: u.acct.dk, keys: u.acct.store, upgraded: true });
    await remember(); enterApp();
  }
  if ($('btn-to-upgrade')) $('btn-to-upgrade').onclick = () => { show('upgrade'); };
  if ($('btn-up-back')) $('btn-up-back').onclick = () => { show('auth'); };
  if ($('btn-upgrade')) $('btn-upgrade').onclick = upgrade;
  $('btn-summary').onclick = async () => { $('summary-out').textContent = JSON.stringify(await ZKMigrate.summary({ call, token: S.token, uid: S.uid, dk: S.dk }), null, 1); ($('purge-box') && $('purge-box').classList.remove('hide')); };
  if ($('btn-purge')) $('btn-purge').onclick = async () => {
    if ($('purge-confirm').value !== 'DELETE') return say('purge-msg', 'Type DELETE first');
    const ctx = { call, token: S.token, uid: S.uid, dk: S.dk };
    const rep = await ZKMigrate.verify(ctx);
    if (rep.some(x => x.enc !== x.plain && x.plain > 0)) return say('purge-msg', 'Refusing: encrypted copy does not match. Nothing deleted.');
    await ZKMigrate.purgePlaintext(ctx); say('purge-msg', 'Plaintext copy deleted. Only encrypted data remains.');
  };

  // ── Trading 212 sync ──
  const RELAY = 'https://capitallens-relay.itsme-daf.workers.dev';
  async function t212run(kind, full) {
    say('t2-err', ''); const k = $('t2-key').value.trim(), sec = $('t2-sec').value.trim();
    if (!k || !sec) return say('t2-err', 'Enter your Trading 212 API key and secret');
    const btns = ['btn-t2', 'btn-t2-full', 'btn-t2-snap'].map($); btns.forEach(b => { b.disabled = true; }); $('t2-log').textContent = '';
    try {
      const store = ZKStore.create({ call, token: S.token, uid: S.uid, dk: S.dk });
      const log = m => { $('t2-log').textContent += m + '\n'; };
      let r;
      if (kind === 'snap') {
        r = await ZKMonitor.create({ store, log, client: ZKT212.client({ relayUrl: RELAY, log }), supportLevels: () => ZKMonitor.fetchSupportLevels(call, S.token) }).run(k, sec);
        if (!r.saved) say('t2-err', 'Nothing saved: ' + r.reason);
        r = { failed: [] };
      } else r = await ZKT212.create({ store, relayUrl: RELAY, log }).run(k, sec, { full });
      $('t2-sec').value = ''; $('t2-key').value = '';
      if (r.failed.length) say('t2-err', 'Incomplete for: ' + r.failed.join(', ') + '. Stored pages are kept; run again to resume.');
    } catch (e) { say('t2-err', 'Sync failed: ' + (e.message || e)); }
    btns.forEach(b => { b.disabled = false; });
  }
  $('btn-t2').onclick = () => t212run('sync', false);
  $('btn-t2-full').onclick = () => t212run('sync', true);
  $('btn-t2-snap').onclick = () => t212run('snap');

  // ── forgot / reset ──
  $('btn-forgot').onclick = async () => {
    const email = $('li-email').value.trim(); if (!email) return say('li-err', 'Enter your email first');
    await call('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { method: 'POST', body: JSON.stringify({ email }) });
    say('li-err', 'If that account exists, a reset link has been emailed.');
  };
  async function reset() {
    say('rs-err', '');
    const rk = $('rs-key').value.trim(), pw = $('rs-pw').value;
    if (!rk) return say('rs-err', 'Enter your recovery key');
    if (pw.length < MIN_PW) return say('rs-err', 'Password must be at least ' + MIN_PW + ' characters');
    $('btn-reset').disabled = true;
    try {
      const kr = await fetchKeys(S.token);
      if (!kr.ok || !kr.d.length) return say('rs-err', 'No keys found for this account');
      let dk; try { dk = await ZK.unlockWithRecovery(rk, kr.d[0]); } catch (e) { return say('rs-err', 'That recovery key does not match this account'); }
      const rw = await ZK.rewrapForNewPassword(dk, pw, kr.d[0]);
      const a = await call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: rw.authSecret }) }, S.token);
      if (!a.ok) return say('rs-err', errOf(a));
      const k = await call('/rest/v1/user_keys?user_id=eq.' + S.uid, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pw_salt: rw.store.pw_salt, wrapped_dk_pw: rw.store.wrapped_dk_pw, updated_at: new Date().toISOString() }) }, S.token);
      if (!k.ok) return say('rs-err', 'Password changed but keys not saved; run reset again with your recovery key. ' + errOf(k));
      S.token = null; show('auth'); say('li-err', 'Password reset. Log in with your new password.');
    } catch (e) { say('rs-err', 'Something went wrong: ' + e.message); }
    finally { $('btn-reset').disabled = false; }
  }

  // ── app: change password + encrypted notes ──
  async function changePw() {
    say('cp-err', ''); say('cp-msg', '');
    const pw = $('cp-pw').value; if (pw.length < MIN_PW) return say('cp-err', 'Password must be at least ' + MIN_PW + ' characters');
    $('btn-cp').disabled = true;
    try {
      const rw = await ZK.rewrapForNewPassword(S.dk, pw, S.keys);
      const a = await call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: rw.authSecret }) }, S.token);
      if (!a.ok) return say('cp-err', errOf(a));
      const k = await call('/rest/v1/user_keys?user_id=eq.' + S.uid, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pw_salt: rw.store.pw_salt, wrapped_dk_pw: rw.store.wrapped_dk_pw, updated_at: new Date().toISOString() }) }, S.token);
      if (!k.ok) return say('cp-err', 'Keys not saved; use your recovery key to reset. ' + errOf(k));
      S.keys = rw.store; $('cp-pw').value = ''; say('cp-msg', 'Password changed. Your data stays readable.');
    } catch (e) { say('cp-err', 'Something went wrong: ' + e.message); }
    finally { $('btn-cp').disabled = false; }
  }
  async function loadNotes() {
    if (!$('notes-plain')) { const k = await call('/rest/v1/user_keys?select=user_id&limit=1', {}, S.token); return k.status !== 401; }   // production page has no demo probe: just check the session is alive
    const r = await call('/rest/v1/zk_probe?select=id,nonce,ct,created_at&order=created_at.desc&limit=20', {}, S.token);
    if (r.status === 401) return false;
    const rows = r.ok ? r.d : [];
    const plain = [];
    for (const row of rows) { try { plain.push((await ZK.decryptRow(S.dk, row, 'zk_probe', row.id, S.uid)).text); } catch (e) { plain.push('[cannot decrypt]'); } }
    $('notes-plain').textContent = plain.join('\n') || '(none yet)';
    $('notes-raw').textContent = rows.length ? JSON.stringify(rows.map(x => ({ id: x.id, nonce: x.nonce, ct: x.ct })), null, 1) : '(none yet)';
    return true;
  }
  async function addNote() {
    say('note-err', ''); const text = $('note-in').value.trim(); if (!text) return;
    const id = crypto.randomUUID(), box = await ZK.encryptRow(S.dk, { text }, 'zk_probe', id, S.uid);
    const r = await call('/rest/v1/zk_probe', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, nonce: box.nonce, ct: box.ct }) }, S.token);
    if (!r.ok) return say('note-err', errOf(r));
    $('note-in').value = ''; loadNotes();
  }
  async function enterApp() { $('who').textContent = S.email || ''; show('app'); await loadNotes(); }
  async function logout() {
    try { if (S.token) await call('/auth/v1/logout', { method: 'POST' }, S.token); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    Object.assign(S, { token: null, uid: null, email: null, dk: null, keys: null });
    $('li-pw').value = ''; show('auth');
  }

  if ($('btn-signup')) $('btn-signup').onclick = signup; $('btn-login').onclick = login; $('btn-reset').onclick = reset;
  $('btn-cp').onclick = changePw; if ($('btn-note')) $('btn-note').onclick = addNote; $('btn-logout').onclick = logout;

  // ── start-up: password-reset link, or restore this tab's unlocked session ──
  (async () => {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('type') === 'recovery' && h.get('access_token')) {
      S.token = h.get('access_token'); S.uid = uidOf(S.token); history.replaceState(null, '', location.pathname); show('reset'); return;
    }
    try {
      const t = sessionStorage.getItem('zk_token'), d = sessionStorage.getItem('zk_dk');
      if (t && d) {
        S.token = t; S.uid = uidOf(t); S.email = sessionStorage.getItem('zk_email'); S.dk = await importDk(d);
        const kr = await fetchKeys(t); if (kr.ok && kr.d.length) S.keys = kr.d[0];
        if (!(await loadNotes()) || !S.keys) throw new Error('expired');
        $('who').textContent = S.email || ''; show('app');
      }
    } catch (e) { try { sessionStorage.clear(); } catch (x) {} show('auth'); }
  })();
})();

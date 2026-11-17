/**
 * T212 Monitor — Cloudflare Worker
 * Routes:
 *   /auth/login            POST {username, password}  → {ok, token} or 401
 *   /auth/change-password  POST {token, newPassword}  → {ok} or 401
 *   /auth/reset-request    POST {username}             → {ok} (triggers GH Actions email)
 *   /auth/reset-confirm    POST {resetToken, newPassword} → {ok} or 400
 *   /alerts/action         POST {token, ids:[..], action} → {ok, updated}  (read|unread|archive|dismiss|restore)
 *   /[table]               → proxy to Supabase (existing behaviour)
 *
 * Env vars (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (service role key — NOT anon),
 *   GH_PAT (GitHub PAT with repo dispatch permission),
 *   GH_REPO (e.g. "cilangovan/t212-monitor")
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,apikey,Prefer',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function randomToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
async function sbGet(env, table, query) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY;
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`sbGet ${r.status}`);
  return r.json();
}

async function sbPatch(env, table, query, data) {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`sbPatch ${r.status}: ${await r.text()}`);
  return true;
}

// ── Session tokens (simple signed tokens stored in Supabase) ─────────────────
// We store a session_token alongside password_hash — good enough for single user
async function issueSession(env) {
  const token = await randomToken();
  const hash = await sha256hex(token);
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  await sbPatch(env, 'dashboard_auth', 'username=eq.admin', {
    session_token: hash,
    session_expiry: expiry,
    updated_at: new Date().toISOString(),
  });
  return token;
}

async function verifySession(env, token) {
  if (!token) return false;
  const hash = await sha256hex(token);
  const rows = await sbGet(env, 'dashboard_auth', 'username=eq.admin&select=session_token,session_expiry');
  if (!rows.length) return false;
  const { session_token, session_expiry } = rows[0];
  if (session_token !== hash) return false;
  if (new Date(session_expiry) < new Date()) return false;
  return true;
}

// ── Auth route handlers ───────────────────────────────────────────────────────
async function handleLogin(req, env) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return json({ error: 'Missing fields' }, 400);

  const rows = await sbGet(env, 'dashboard_auth', `username=eq.${encodeURIComponent(username)}&select=password_hash`);
  if (!rows.length) return json({ error: 'Invalid credentials' }, 401);

  const hash = await sha256hex(password);
  if (hash !== rows[0].password_hash) return json({ error: 'Invalid credentials' }, 401);

  const token = await issueSession(env);
  return json({ ok: true, token });
}

async function handleChangePassword(req, env) {
  const { token, newPassword } = await req.json().catch(() => ({}));
  if (!token || !newPassword) return json({ error: 'Missing fields' }, 400);
  if (newPassword.length < 8) return json({ error: 'Password too short (min 8)' }, 400);

  const valid = await verifySession(env, token);
  if (!valid) return json({ error: 'Invalid or expired session' }, 401);

  const hash = await sha256hex(newPassword);
  await sbPatch(env, 'dashboard_auth', 'username=eq.admin', {
    password_hash: hash,
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
}

async function handleResetRequest(req, env) {
  // Always return ok to avoid username enumeration
  const { username } = await req.json().catch(() => ({}));
  if (!username) return json({ ok: true }); // silent

  const rows = await sbGet(env, 'dashboard_auth', `username=eq.${encodeURIComponent(username)}&select=id`);
  if (!rows.length) return json({ ok: true }); // silent

  const token = await randomToken();
  const hash = await sha256hex(token);
  const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  await sbPatch(env, 'dashboard_auth', 'username=eq.admin', {
    reset_token: hash,
    reset_expiry: expiry,
    updated_at: new Date().toISOString(),
  });

  // Trigger GitHub Actions workflow to send reset email
  const ghRes = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'T212-Worker',
    },
    body: JSON.stringify({
      event_type: 'send_reset_email',
      client_payload: { reset_token: token },
    }),
  });

  if (!ghRes.ok) console.error('GH dispatch failed:', await ghRes.text());
  return json({ ok: true });
}

async function handleResetConfirm(req, env) {
  const { resetToken, newPassword } = await req.json().catch(() => ({}));
  if (!resetToken || !newPassword) return json({ error: 'Missing fields' }, 400);
  if (newPassword.length < 8) return json({ error: 'Password too short (min 8)' }, 400);

  const hash = await sha256hex(resetToken);
  const rows = await sbGet(env, 'dashboard_auth', 'username=eq.admin&select=reset_token,reset_expiry');
  if (!rows.length) return json({ error: 'Invalid token' }, 400);

  const { reset_token, reset_expiry } = rows[0];
  if (reset_token !== hash) return json({ error: 'Invalid token' }, 400);
  if (new Date(reset_expiry) < new Date()) return json({ error: 'Token expired' }, 400);

  const pwHash = await sha256hex(newPassword);
  await sbPatch(env, 'dashboard_auth', 'username=eq.admin', {
    password_hash: pwHash,
    reset_token: null,
    reset_expiry: null,
    updated_at: new Date().toISOString(),
  });
  return json({ ok: true });
}

// ── Alert inbox actions (authenticated) ──────────────────────────────────────
const ALERT_ACTIONS = {
  read:    now => ({ read_at: now }),
  unread:  ()  => ({ read_at: null }),
  archive: now => ({ archived_at: now, dismissed_at: null, read_at: now }),
  dismiss: now => ({ dismissed_at: now, archived_at: null, read_at: now }),
  restore: ()  => ({ archived_at: null, dismissed_at: null }),
};

async function handleAlertAction(req, env) {
  const { token, ids, action } = await req.json().catch(() => ({}));
  if (!(await verifySession(env, token))) return json({ error: 'Invalid or expired session' }, 401);
  const make = ALERT_ACTIONS[action];
  if (!make) return json({ error: 'Unknown action' }, 400);
  const clean = Array.isArray(ids) ? [...new Set(ids.map(Number))].filter(n => Number.isInteger(n) && n > 0) : [];
  if (!clean.length || clean.length > 500) return json({ error: 'Provide 1–500 alert ids' }, 400);
  await sbPatch(env, 'alerts', `id=in.(${clean.join(',')})`, make(new Date().toISOString()));
  return json({ ok: true, updated: clean.length, action });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Auth routes
    if (path === '/auth/login')           return handleLogin(request, env).catch(e => json({ error: e.message }, 500));
    if (path === '/auth/change-password') return handleChangePassword(request, env).catch(e => json({ error: e.message }, 500));
    if (path === '/auth/reset-request')   return handleResetRequest(request, env).catch(e => json({ error: e.message }, 500));
    if (path === '/auth/reset-confirm')   return handleResetConfirm(request, env).catch(e => json({ error: e.message }, 500));
    if (path === '/alerts/action' && request.method === 'POST') return handleAlertAction(request, env).catch(e => json({ error: e.message }, 500));
    if (path === '/auth/debug') return json({
      has_supabase_url: !!env.SUPABASE_URL,
      supabase_url_prefix: env.SUPABASE_URL ? env.SUPABASE_URL.substring(0, 30) : null,
      has_service_key: !!env.SUPABASE_SERVICE_KEY,
      has_supabase_key: !!env.SUPABASE_KEY,
      has_gh_pat: !!env.GH_PAT,
      gh_repo: env.GH_REPO || null,
    });

    // ── Read-only Supabase proxy ─────────────────────────────────────────────
    // Dashboard only reads. Block writes, RPC/nested paths and the auth table.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405);
    }
    const table = path.replace(/^\//, '');
    if (!/^[a-z_]+$/.test(table) || table === 'dashboard_auth') {
      return json({ error: 'Not found' }, 404);
    }
    const supaUrl = `${env.SUPABASE_URL}/rest/v1/${table}${url.search}`;
    const headers = new Headers(request.headers);
    headers.set('apikey', env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY);
    headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY}`);

    const resp = await fetch(supaUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    const body = await resp.arrayBuffer();
    // Build response headers: take upstream headers, strip any ACAO headers
    // from Supabase, then apply our own CORS headers on top.
    const respHeaders = Object.fromEntries(resp.headers);
    delete respHeaders['access-control-allow-origin'];
    delete respHeaders['access-control-allow-headers'];
    delete respHeaders['access-control-allow-methods'];
    delete respHeaders['set-cookie']; // don't forward Supabase cookies to browser
    return new Response(body, {
      status: resp.status,
      headers: { ...respHeaders, ...CORS },
    });
  },
};

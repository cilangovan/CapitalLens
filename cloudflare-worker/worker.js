/**
 * CapitalLens — Cloudflare Worker
 * Routes:
 *   /auth/login            POST {username, password}  → {ok, token} or 401
 *   /auth/change-password  POST {token, newPassword}  → {ok} or 401
 *   /auth/reset-request    POST {username}             → {ok} (triggers GH Actions email)
 *   /auth/reset-confirm    POST {resetToken, newPassword} → {ok} or 400
 *   /search                POST {token, q, category} → {results:[…]}  stock: Yahoo global · crypto: Yahoo + T212 crypto ETPs · commodity: T212 ETCs + Yahoo futures
 *   /watchlist/add         POST {token, symbol, category} → {ok}  (bookmarks + triggers analysis)
 *   /watchlist/remove      POST {token, symbol} → {ok}  (stops tracking, deletes analysis)
 *   /chart                 POST {token, symbol, range} → {meta, points}  live Yahoo chart (1d|5d|1mo|6mo|1y|5y)
 *   /settings/set          POST {token, key, value} → {ok}  (whitelisted keys only)
 *   /alerts/action         POST {token, ids:[..], action} → {ok, updated}  (read|unread|archive|dismiss|restore)
 *   /[table]               → proxy to Supabase (existing behaviour)
 *
 * Env vars (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (service role key — NOT anon),
 *   GH_PAT (GitHub PAT with repo dispatch permission),
 *   GH_REPO (e.g. "cilangovan/CapitalLens")
 */

// Only the dashboard's own site may call this worker from a browser (override with the ALLOWED_ORIGINS env var).
const DEFAULT_ORIGINS = ['https://cilangovan.github.io'];
const CORS = {
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '600',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};
function finalize(resp, request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ORIGINS).map(s => s.trim());
  const h = new Headers(resp.headers);
  ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'set-cookie'].forEach(k => h.delete(k));
  for (const [k, v] of Object.entries({ ...CORS, ...SECURITY_HEADERS })) h.set(k, v);   // our own CORS rules, re-applied after the strip
  if (origin && allowed.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  return new Response(resp.body, { status: resp.status, headers: h });
}

// Tables the dashboard may read — everything else (login table, raw Trading 212 history) is never served.
const READABLE = new Set(['alerts', 'analyst_ratings', 'app_settings', 'dividends', 'holding_decisions', 'institutional_flow_reports', 'instrument_exposure', 'instrument_country_weights', 'instrument_sector_weights',
  'pie_history', 'portfolio_snapshots', 'portfolio_snapshots_all', 'positions', 'positions_all', 'profit_booking',
  'profit_booking_summary', 'realised_pnl', 'returns_summary', 'strategy_recommendations', 'value_buy_scores',
  'watchlist', 'watchlist_analysis', 'ipo_calendar', 'support_levels']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
const bearer = req => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string compare (hex hashes) — no early exit that leaks how many characters matched
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Passwords: salted PBKDF2-SHA256, stored as pbkdf2$<iter>$<salt>$<hash>. Old unsalted SHA-256 hashes still
// verify once and are upgraded on that sign-in. Iterations are sized for the Workers CPU budget (a worker that runs
// too long is killed, and the browser just sees "Failed to fetch"); the per-user salt, the 5-attempt lockout and a
// database no outsider can read are what stop guessing. Raise PBKDF2_ITER on a paid Workers plan.
const PBKDF2_ITER = 5000;
const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ITER}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITER)}`;
}
async function verifyPassword(password, stored) {
  if (String(stored || '').startsWith('pbkdf2$')) {
    const [, iter, salt, h] = stored.split('$');
    return { ok: safeEqual(await pbkdf2(password, salt, +iter), h), upgrade: +iter < PBKDF2_ITER };
  }
  return { ok: safeEqual(await sha256hex(password), stored), upgrade: true };   // legacy
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

// Verified sessions are cached for 60s per worker instance, so each page load isn't ~15 database lookups.
const SESSION_CACHE = new Map();
async function verifySession(env, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return false;
  const hash = await sha256hex(token);
  const hit = SESSION_CACHE.get(hash);
  if (hit && hit > Date.now()) return true;
  const rows = await sbGet(env, 'dashboard_auth', 'username=eq.admin&select=session_token,session_expiry');
  if (!rows.length) return false;
  const { session_token, session_expiry } = rows[0];
  if (!session_token || !safeEqual(session_token, hash)) return false;
  const exp = new Date(session_expiry).getTime();
  if (!(exp > Date.now())) return false;
  SESSION_CACHE.set(hash, Math.min(exp, Date.now() + 60_000));
  if (SESSION_CACHE.size > 50) SESSION_CACHE.delete(SESSION_CACHE.keys().next().value);
  return true;
}

// ── Auth route handlers ───────────────────────────────────────────────────────
async function handleLogin(req, env) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return json({ error: 'Missing fields' }, 400);

  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256)
    return json({ error: 'Invalid credentials' }, 401);
  const rows = await sbGet(env, 'dashboard_auth', `username=eq.${encodeURIComponent(username)}&select=username,password_hash,failed_logins,locked_until`);
  if (!rows.length) { await sha256hex(password); return json({ error: 'Invalid credentials' }, 401); }
  const u = rows[0], who = `username=eq.${encodeURIComponent(u.username)}`;
  if (u.locked_until && new Date(u.locked_until) > new Date())
    return json({ error: 'Too many attempts — try again in 15 minutes' }, 429);

  const { ok, upgrade } = await verifyPassword(password, u.password_hash);
  if (!ok) {
    const n = (u.failed_logins || 0) + 1;
    await sbPatch(env, 'dashboard_auth', who, n >= 5
      ? { failed_logins: 0, locked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString() }
      : { failed_logins: n });
    return json({ error: n >= 5 ? 'Too many attempts — try again in 15 minutes' : 'Invalid credentials' }, n >= 5 ? 429 : 401);
  }
  const patch = { failed_logins: 0, locked_until: null };
  if (upgrade) patch.password_hash = await hashPassword(password);   // move old SHA-256 hash to PBKDF2
  await sbPatch(env, 'dashboard_auth', who, patch);

  const token = await issueSession(env);
  return json({ ok: true, token });
}

async function handleChangePassword(req, env) {
  const { token, newPassword } = await req.json().catch(() => ({}));
  if (!token || !newPassword) return json({ error: 'Missing fields' }, 400);
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) return json({ error: 'Password must be 8–256 characters' }, 400);

  const valid = await verifySession(env, token);
  if (!valid) return json({ error: 'Invalid or expired session' }, 401);

  const hash = await hashPassword(newPassword);
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
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) return json({ error: 'Password must be 8–256 characters' }, 400);
  if (typeof resetToken !== 'string' || resetToken.length > 200) return json({ error: 'Invalid token' }, 400);

  const hash = await sha256hex(resetToken);
  const rows = await sbGet(env, 'dashboard_auth', 'username=eq.admin&select=reset_token,reset_expiry');
  if (!rows.length) return json({ error: 'Invalid token' }, 400);

  const { reset_token, reset_expiry } = rows[0];
  if (!reset_token || !safeEqual(reset_token, hash)) return json({ error: 'Invalid token' }, 400);
  if (new Date(reset_expiry) < new Date()) return json({ error: 'Token expired' }, 400);

  const pwHash = await hashPassword(newPassword);
  await sbPatch(env, 'dashboard_auth', 'username=eq.admin', {
    password_hash: pwHash,
    reset_token: null,
    reset_expiry: null,
    failed_logins: 0,
    locked_until: null,
    session_token: null,          // a reset signs out every existing session
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

// ── Watchlist (authenticated) ────────────────────────────────────────────────
async function sbWrite(env, method, table, query, data) {
  const key = env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
               Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${await r.text()}`);
  return true;
}

async function triggerWatchlistRun(env, ticker) {
  if (!env.GH_PAT || !env.GH_REPO) return false;
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_PAT}`, Accept: 'application/vnd.github.v3+json',
               'Content-Type': 'application/json', 'User-Agent': 'T212-Worker' },
    body: JSON.stringify({ event_type: 'watchlist_refresh', client_payload: { ticker } }),
  });
  return r.ok;
}

const SYMBOL_RE = /^[A-Za-z0-9.\-^=&]{1,24}$/;

// Yahoo symbol → candidate Trading 212 tickers (exchanges T212 lists that we sync)
function t212Candidates(sym) {
  const m = sym.match(/^([A-Z0-9\-]+)(?:\.([A-Z]+))?$/i);
  if (!m) return [];
  const base = m[1].toUpperCase(), suf = (m[2] || '').toUpperCase();
  if (!suf) return [...new Set([`${base}_US_EQ`, `${base.replace(/-/g, '_')}_US_EQ`, `${base.replace(/-/g, '/')}_US_EQ`, `${base.replace(/-/g, '.')}_US_EQ`])];
  const map = { L: 'l', DE: 'd', AS: 'a' };
  return map[suf] ? [`${base}${map[suf]}_EQ`] : [];
}

const YTYPES = { stock: ['EQUITY', 'ETF'], crypto: ['CRYPTOCURRENCY'], commodity: ['FUTURE'] };
const ALL_YTYPES = ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'FUTURE'];
const COMMODITY_RE = /\b(gold|silver|platinum|palladium|oil|crude|brent|wti|natural gas|gas|copper|nickel|alumin(i)?um|zinc|lithium|uranium|wheat|corn|soy\w*|sugar|coffee|cocoa|cotton|livestock|cattle|commodit\w*|metals?|agricultur\w*|energy|carbon)\b/i;
const CRYPTO_RE = /\b(bitcoin|ethereum|ether|solana|xrp|ripple|cardano|polkadot|litecoin|crypto\w*|digital assets?|blockchain)\b/i;
const LEVERAGED_RE = /\b(\d+x|leveraged|short|inverse|daily)\b/i;
const MINERS_RE = /\b(min(ing|ers?)|producers?|equit(y|ies))\b/i;   // company shares, not the asset itself

async function yahooSearch(q, types = YTYPES.stock) {
  const u = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
            `&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; T212-Watchlist/1.0)', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Yahoo search ${r.status}`);
  const d = await r.json();
  const typeName = { EQUITY: 'Stock', ETF: 'ETF', CRYPTOCURRENCY: 'Crypto', FUTURE: 'Futures' };
  return (d.quotes || [])
    .filter(x => x.symbol && types.includes(x.quoteType))
    .map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol,
                 exchange: x.exchDisp || x.exchange || '', type: typeName[x.quoteType] || x.quoteType }));
}

async function attachT212(env, rows) {
  const cands = [...new Set(rows.flatMap(r => t212Candidates(r.symbol)))];
  if (!cands.length) return rows;
  const found = await sbGet(env, 'instruments',
    `ticker=in.(${cands.map(c => `"${c}"`).map(encodeURIComponent).join(',')})&select=ticker`).catch(() => []);
  const have = new Set(found.map(f => f.ticker));
  return rows.map(r => ({ ...r, t212_ticker: t212Candidates(r.symbol).find(c => have.has(c)) || null }));
}

const toYahoo = t => t.endsWith('_US_EQ') ? t.slice(0, -6) : t.replace(/l_EQ$/, '.L').replace(/d_EQ$/, '.DE').replace(/a_EQ$/, '.AS');

// T212 ETPs/ETCs matching a word and a theme (commodity or crypto)
async function t212Products(env, word, themeRe, limit = 20) {
  const pat = encodeURIComponent(`"*${String(word).replace(/[*,()"]/g, ' ').trim()}*"`);
  const rows = await sbGet(env, 'instruments',
    `select=ticker,name,short_name,currency,type,exchange&type=eq.ETF&or=(name.ilike.${pat},short_name.ilike.${pat})&limit=80`).catch(() => []);
  return rows.filter(r => themeRe.test(r.name || '')).slice(0, limit).map(r => ({
    symbol: toYahoo(r.ticker), name: r.name || r.short_name, exchange: r.exchange, currency: r.currency,
    type: MINERS_RE.test(r.name || '') ? 'Miners/equity ETF' : CRYPTO_RE.test(r.name || '') ? 'Crypto ETP' : 'ETC', t212_ticker: r.ticker,
    leveraged: LEVERAGED_RE.test(r.name || ''), miners: MINERS_RE.test(r.name || ''),
  }));
}

function cryptoGbpVariants(rows) {
  const out = [...rows];
  rows.forEach(r => {
    const m = r.symbol.match(/^([A-Z0-9]+)-USD$/);
    if (m && !rows.some(x => x.symbol === `${m[1]}-GBP`))
      out.push({ ...r, symbol: `${m[1]}-GBP`, name: r.name.replace(/\bUSD\b/, 'GBP'), exchange: r.exchange });
  });
  return out;
}

async function handleSearch(req, env) {
  const { token, q, category = 'stock' } = await req.json().catch(() => ({}));
  if (!(await verifySession(env, token))) return json({ error: 'Invalid or expired session' }, 401);
  if (!YTYPES[category]) return json({ error: 'Unknown category' }, 400);
  const query = String(q || '').trim().slice(0, 60);
  if (query.length < 2) return json({ results: [] });
  let market = [], note = null;
  try { market = await yahooSearch(query, YTYPES[category]); }
  catch (e) { note = `Market search unavailable (${e.message})`; }

  if (category === 'stock') {
    if (!market.length && note) {   // fallback: Trading 212's own universe
      const pat = encodeURIComponent(`"*${query.replace(/[*,()"]/g, ' ')}*"`);
      const rows = await sbGet(env, 'instruments', `select=ticker,name,short_name,type,exchange&or=(short_name.ilike.${pat},name.ilike.${pat})&limit=20`);
      return json({ source: 'trading212', note: note + ' — showing Trading 212 matches',
        results: rows.map(r => ({ symbol: toYahoo(r.ticker), name: r.name || r.short_name, exchange: r.exchange,
          type: r.type === 'ETF' ? 'ETF' : 'Stock', t212_ticker: r.ticker, group: 't212' })) });
    }
    return json({ source: 'yahoo', note, results: (await attachT212(env, market)).map(r => ({ ...r, group: 'market' })) });
  }
  const theme = category === 'crypto' ? CRYPTO_RE : COMMODITY_RE;
  const t212 = await t212Products(env, query, theme);
  if (category === 'crypto') market = cryptoGbpVariants(market);
  return json({ source: 'yahoo+trading212', note, results: [
    ...t212.map(r => ({ ...r, group: 't212' })),
    ...market.map(r => ({ ...r, t212_ticker: null, group: 'market' })),
  ] });
}

async function handleWatchlist(req, env, op) {
  const { token, symbol, category = 'stock' } = await req.json().catch(() => ({}));
  if (!(await verifySession(env, token))) return json({ error: 'Invalid or expired session' }, 401);
  if (!symbol || !SYMBOL_RE.test(symbol)) return json({ error: 'Invalid symbol' }, 400);
  if (!YTYPES[category]) return json({ error: 'Unknown category' }, 400);
  const t = encodeURIComponent(symbol);
  if (op === 'remove') {
    await sbWrite(env, 'DELETE', 'watchlist_analysis', `ticker=eq.${t}`);
    await sbWrite(env, 'DELETE', 'watchlist', `ticker=eq.${t}`);
    return json({ ok: true, removed: symbol });
  }
  // Confirm the symbol server-side (don't trust client-supplied name/exchange)
  let hit = null;
  try { hit = (await yahooSearch(symbol, ALL_YTYPES)).find(r => r.symbol.toUpperCase() === symbol.toUpperCase()); } catch (e) {}
  const pair = symbol.toUpperCase().match(/^([A-Z0-9]{2,12})-(USD|GBP|EUR|USDT)$/);
  if (!hit && category === 'crypto' && pair) {
    // Yahoo search often only returns the USD pair — take the coin's name from it
    let base = null;
    try { base = (await yahooSearch(`${pair[1]}-USD`, YTYPES.crypto)).find(r => r.symbol.toUpperCase() === `${pair[1]}-USD`); } catch (e) {}
    hit = { symbol: symbol.toUpperCase(), name: base ? base.name.replace(/\bUSD\b/, pair[2]) : `${pair[1]} ${pair[2]}`, exchange: 'CCC', type: 'Crypto' };
  }
  if (!hit) {
    const cand = t212Candidates(symbol);
    const inst = cand.length ? await sbGet(env, 'instruments', `ticker=in.(${cand.map(c => encodeURIComponent(`"${c}"`)).join(',')})&select=ticker,name,type,exchange`) : [];
    if (inst.length) hit = { symbol, name: inst[0].name, exchange: inst[0].exchange, type: inst[0].type === 'ETF' ? 'ETF' : 'Stock' };
    else return json({ error: 'Symbol not found on Yahoo Finance' }, 404);
  }
  const [withT212] = hit.type === 'Crypto' || hit.type === 'Futures' ? [{ t212_ticker: null }] : await attachT212(env, [hit]);
  // For crypto coins and commodity futures: list the Trading 212 products that give that exposure
  let alternatives = null;
  if (!withT212.t212_ticker && (category === 'crypto' || category === 'commodity')) {
    const theme = category === 'crypto' ? CRYPTO_RE : COMMODITY_RE;
    const word = (hit.name.match(theme) || [hit.name.split(/[\s-]/)[0]])[0];
    alternatives = (await t212Products(env, word, theme, 20)).filter(a => !a.leveraged && !a.miners).slice(0, 4)
      .map(a => ({ ticker: a.t212_ticker, symbol: a.symbol, name: a.name, currency: a.currency }));
  }
  if (hit.type === 'Futures') hit.name = hit.name.replace(/\s+[A-Z][a-z]{2}\s+\d{2,4}$/, '') + ' (futures)';
  await sbWrite(env, 'POST', 'watchlist', 'on_conflict=ticker',
    { ticker: hit.symbol, name: hit.name, exchange: hit.exchange, type: hit.type, category,
      t212_ticker: withT212.t212_ticker, alternatives });
  const queued = await triggerWatchlistRun(env, hit.symbol);
  return json({ ok: true, added: hit.symbol, category, t212_ticker: withT212.t212_ticker, alternatives, analysis_queued: queued });
}

// ── Live chart for the watchlist drill-down (authenticated) ─────────────────
const CHART_RANGES = { '1d': '5m', '5d': '30m', '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' };
const SUBUNIT = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };

async function handleChart(req, env) {
  const { token, symbol, range = '1d' } = await req.json().catch(() => ({}));
  if (!(await verifySession(env, token))) return json({ error: 'Invalid or expired session' }, 401);
  if (!symbol || !SYMBOL_RE.test(symbol)) return json({ error: 'Invalid symbol' }, 400);
  const interval = CHART_RANGES[range];
  if (!interval) return json({ error: 'Invalid range' }, 400);
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; T212-Watchlist/1.0)', Accept: 'application/json' },
                             cf: { cacheTtl: range === '1d' ? 60 : 900, cacheEverything: true } });
  if (!r.ok) return json({ error: `Yahoo chart ${r.status}` }, 502);
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) return json({ error: 'No chart data' }, 404);
  const m = res.meta || {};
  const [ccy, k] = SUBUNIT[m.currency] || [m.currency, 1];
  const closes = res.indicators?.quote?.[0]?.close || [];
  const points = (res.timestamp || []).map((t, i) => closes[i] == null ? null : [t, +(closes[i] * k).toFixed(6)]).filter(Boolean);
  const n = v => (typeof v === 'number' ? +(v * k).toFixed(6) : null);
  return json({
    symbol, range, interval,
    meta: { currency: ccy, quote_currency: m.currency, exchange: m.fullExchangeName || m.exchangeName,
            timezone: m.exchangeTimezoneName, gmtoffset: m.gmtoffset,
            price: n(m.regularMarketPrice), prev_close: n(m.chartPreviousClose ?? m.previousClose),
            day_high: n(m.regularMarketDayHigh), day_low: n(m.regularMarketDayLow),
            high52: n(m.fiftyTwoWeekHigh), low52: n(m.fiftyTwoWeekLow), volume: m.regularMarketVolume ?? null,
            market_time: m.regularMarketTime ?? null,
            session: m.currentTradingPeriod?.regular ? { start: m.currentTradingPeriod.regular.start, end: m.currentTradingPeriod.regular.end } : null },
    points,
  });
}

// ── Settings (authenticated, whitelisted) ────────────────────────────────────
function budgetCheck(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : undefined; }
const SETTINGS = {
  watchlist_weekly_budget: budgetCheck,
  commodity_weekly_budget: budgetCheck,
  crypto_weekly_budget:    budgetCheck,
};
async function handleSetting(req, env) {
  const { token, key, value } = await req.json().catch(() => ({}));
  if (!(await verifySession(env, token))) return json({ error: 'Invalid or expired session' }, 401);
  const check = SETTINGS[key];
  if (!check) return json({ error: 'Unknown setting' }, 400);
  const v = check(value);
  if (v === undefined) return json({ error: 'Invalid value' }, 400);
  const k = env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, { method: 'POST',
    headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: v, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`settings ${r.status}: ${await r.text()}`);
  if (key.endsWith('_weekly_budget')) await triggerWatchlistRun(env, '');
  return json({ ok: true, key, value: v });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const resp = await route(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    return finalize(resp, request, env);
  },
};

async function route(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Auth routes
    if (path === '/auth/login')           return handleLogin(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/auth/change-password') return handleChangePassword(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/auth/reset-request')   return handleResetRequest(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/auth/reset-confirm')   return handleResetConfirm(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/search' && request.method === 'POST')           return handleSearch(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/watchlist/add' && request.method === 'POST')    return handleWatchlist(request, env, 'add').catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/watchlist/remove' && request.method === 'POST') return handleWatchlist(request, env, 'remove').catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/chart' && request.method === 'POST')            return handleChart(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/settings/set' && request.method === 'POST')     return handleSetting(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });
    if (path === '/alerts/action' && request.method === 'POST') return handleAlertAction(request, env).catch(e => { console.error(e); return json({ error: 'Server error' }, 500); });

    // ── Read-only Supabase proxy (signed-in only, allowlisted tables) ─────────
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405);
    }
    const table = path.replace(/^\//, '');
    if (!READABLE.has(table)) return json({ error: 'Not found' }, 404);
    if (!(await verifySession(env, bearer(request)))) return json({ error: 'Sign in required' }, 401);
    if (url.search.length > 2000) return json({ error: 'Query too long' }, 414);

    const key = env.SUPABASE_SERVICE_KEY;
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${url.search}`, {
      method: request.method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },   // nothing from the client is forwarded
    });
    return new Response(await resp.arrayBuffer(), {
      status: resp.status,
      headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json', ...CORS },
    });
}

// Issues a temporary demo login (epic #32, requirement BR-1..BR-11 in documentation/demo-requirements.md).
// POST {} -> { email, password, expires_at, ttl_minutes, idle_minutes }  or  { error: 'disabled'|'busy'|'rate'|'failed' }.
// Public (verify_jwt = false): the abuse limits live in Postgres (demo_can_issue). The service key never leaves this function.
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ORIGINS = ['https://cilangovan.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000'];

const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rpc = async (fn: string, args: unknown) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rand = (n: number, alphabet: string) => {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
};
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method' }, 405);
  let userId: string | null = null;
  try {
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
    const ipHash = (await sha(`${ip}|${KEY.slice(-12)}`)).slice(0, 32);   // never store the address itself
    const gate = await rpc('demo_can_issue', { p_ip_hash: ipHash });
    if (!gate?.ok) return json(req, { error: gate?.code || 'failed' }, gate?.code === 'rate' ? 429 : 503);

    const email = `demo-${rand(10, 'abcdefghjkmnpqrstuvwxyz23456789')}@demo.invalid`;
    const password = `${rand(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ')}-${rand(4, 'abcdefghjkmnpqrstuvwxyz')}-${rand(4, '23456789')}-${rand(4, 'abcdefghjkmnpqrstuvwxyz')}`;
    const cu = await fetch(`${URL_}/auth/v1/admin/users`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { demo_visitor: true } }),
    });
    const created = await cu.json();
    if (!cu.ok || !created?.id) throw new Error(`create user: ${cu.status}`);
    userId = created.id;
    const reg = await rpc('demo_register_session', { p_user: userId, p_ip_hash: ipHash });
    return json(req, { email, password, expires_at: reg.expires_at, ttl_minutes: reg.ttl_minutes, idle_minutes: reg.idle_minutes });
  } catch (e) {
    console.error('demo-access failed', String(e));
    if (userId) await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: H }).catch(() => {});
    return json(req, { error: 'failed' }, 500);
  }
});

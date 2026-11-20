// Guards epic #32 (temporary demo login) client side: refusal messages, credentials card, countdown/ended handling, sign-out ends the demo.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../docs/demo/demo-session.js', import.meta.url), 'utf8');
let pass = 0; const ok = (n, c) => { assert.ok(c, n); pass++; console.log('ok -', n); };

function sandbox(fetchImpl) {
  const els = {}; const store = {};
  const el = id => els[id] ||= { id, style: {}, textContent: '', value: '', className: '', disabled: false, classList: { toggle() {}, remove() {}, add() {} } };
  const calls = []; const base = { n: 0 };
  const ctx = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k', PROXY: 'https://x.supabase.co/rest/v1', SESSION_TOKEN: 'tok',
    document: { getElementById: el, addEventListener() {} },
    window: { addEventListener() {} }, navigator: { clipboard: { writeText: async () => {} } },
    sessionStorage: { setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] ?? null, removeItem: k => { delete store[k]; } },
    fetch: async (u, o) => { calls.push({ u, o }); return fetchImpl(u, o); },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, console, Date, Math, JSON, Promise, String,
    doLogin: async () => { ctx.loggedIn = true; },
    logout: () => { base.n++; },
  };
  ctx.window = { addEventListener() {} };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { ctx, el, store, calls, base };
}
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });

// 1. formatting
{ const { ctx } = sandbox(() => res(200, {})); ok('countdown formats mm:ss', ctx.demoFmt(3599) === '59:59' && ctx.demoFmt(65) === '01:05' && ctx.demoFmt(-4) === '00:00'); }

// 2. refusals map to plain messages and re-enable the button
for (const code of ['disabled', 'busy', 'rate', 'failed']) {
  const { ctx, el } = sandbox(() => res(code === 'rate' ? 429 : 503, { error: code }));
  await ctx.demoStart();
  ok(`refusal "${code}" shows its message`, el('demo-try-msg').textContent === vm.runInContext('DEMO_REFUSALS', ctx)[code] && el('demo-try-btn').disabled === false);
}

// 3. success shows the credentials once, hides the login form, never writes the password to storage
{
  const { ctx, el, store, calls } = sandbox(() => res(200, { email: 'demo-abc@demo.invalid', password: 'ABCD-efgh-2345-jkmn', expires_at: 'x', ttl_minutes: 60, idle_minutes: 45 }));
  await ctx.demoStart();
  ok('credentials card shows email + password + limits', el('demo-cred-email').textContent === 'demo-abc@demo.invalid' && el('demo-cred-pw').textContent === 'ABCD-efgh-2345-jkmn' && el('demo-cred-mins').textContent === 60 && el('demo-cred-idle').textContent === 45);
  ok('sign-in form hidden, card visible', el('demo-creds').style.display === 'block' && el('login-form').style.display === 'none');
  ok('the password is never put in browser storage', !JSON.stringify(store).includes('ABCD-efgh'));
  ok('function is called without the owner login or any secret', calls[0].u.endsWith('/functions/v1/demo-access') && !JSON.stringify(calls[0].o).includes('Bearer'));
  await ctx.demoOpen();
  ok('"Open the demo" fills the form and signs in', el('login-user').value === 'demo-abc@demo.invalid' && ctx.loggedIn === true);
}

// 4. ended sessions: message kept for the sign-in screen, local logout without a second server call
for (const [reason, word] of [['time', 'one-hour'], ['idle', '45 minutes'], ['closed', 'closed']]) {
  const { ctx, store, base, calls } = sandbox(() => res(200, {}));
  ctx.demoEnded(reason);
  ok(`ended (${reason}) stores a clear message`, store.demo_msg.includes(word));
  ok(`ended (${reason}) logs out locally`, base.n === 1 && calls.length === 0);
}

// 5. demoInit: the owner's master login gets no timer; expired/idle sessions are ended
{
  const { ctx, el } = sandbox(() => res(200, { demo: false }));
  await ctx.demoInit(); ok('master login: no badge, no banner', !el('demo-badge').style.display && !el('demo-banner').style.display);
}
{
  const { ctx, store, base } = sandbox(() => res(200, { demo: true, active: false, reason: 'idle' }));
  await ctx.demoInit(); ok('server says idle → ended with the idle message', store.demo_msg.includes('45 minutes') && base.n === 1);
}
{
  const { ctx, el } = sandbox(() => res(200, { demo: true, active: true, seconds_left: 3000 }));
  await ctx.demoInit(); ok('active demo shows the countdown badge and the banner', el('demo-badge').style.display === 'inline-flex' && el('demo-banner').style.display === 'flex');
}

// 6. sign-out ends the demo server-side (hard end, no grace) before reloading
{
  const { ctx, base, calls } = sandbox(() => res(200, { demo: true, active: true, seconds_left: 3000 }));
  await ctx.demoInit(); calls.length = 0; ctx.logout();
  await new Promise(r => setTimeout(r, 20));
  const c = calls.find(x => x.u.endsWith('/rpc/demo_end'));
  ok('sign-out calls demo_end(grace=false) then logs out', c && JSON.parse(c.o.body).p_grace === false && base.n === 1);
}
console.log(`\n${pass} passed`);

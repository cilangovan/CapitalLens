// CapitalLens broker function.
//   POST /connect  (signed-in user)  validate a Trading 212 key, store it encrypted in Vault, queue the first sync
//   POST /tick     (scheduler only)  run due sync jobs, paced to Trading 212's rate limits
// Credentials are only ever read here, with the service role, and are never logged or returned.
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const ORIGINS = ["https://cilangovan.github.io", "http://localhost:3000"];
const HOSTS: Record<string, string> = { live: "https://live.trading212.com", demo: "https://demo.trading212.com" };
const PACE_MS = 10_500;            // T212: 6 requests / minute / endpoint
const PAGES_PER_TICK = 4;
const TICK_BUDGET_MS = 100_000;
const MAX_CONNECTIONS = 5;

const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || !Number.isFinite(n) ? null : n; };

// ── Trading 212 client ──────────────────────────────────────────────────────
class T212Error extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
type Creds = { api_key: string; api_secret: string; environment: "live" | "demo" };

async function t212(c: Creds, path: string): Promise<any> {
  const url = path.startsWith("http") ? path : HOSTS[c.environment] + path;
  const r = await fetch(url, {
    headers: { Authorization: "Basic " + btoa(`${c.api_key}:${c.api_secret}`), Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) { await r.body?.cancel(); throw new T212Error(r.status, `Trading 212 returned ${r.status}`); }
  return await r.json();
}

// ── /connect ────────────────────────────────────────────────────────────────
async function connect(req: Request): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await ADMIN.auth.getUser(token);
  if (!u?.user) return json(req, 401, { error: "Please sign in again." });
  const userId = u.user.id;

  let b: any;
  try { b = await req.json(); } catch { return json(req, 400, { error: "Invalid request." }); }
  if (b.broker !== "trading212") return json(req, 400, { error: "Only Trading 212 is supported right now." });
  const environment = b.environment === "demo" ? "demo" : "live";
  const api_key = String(b.api_key ?? "").trim(), api_secret = String(b.api_secret ?? "").trim();
  if (api_key.length < 8 || api_secret.length < 8) return json(req, 400, { error: "Enter both the API key and the API secret." });
  const label = String(b.label ?? "").trim().slice(0, 60) || (environment === "demo" ? "Trading 212 (practice)" : "Trading 212");

  const { count } = await ADMIN.from("broker_connections").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= MAX_CONNECTIONS) return json(req, 400, { error: `You can connect up to ${MAX_CONNECTIONS} accounts.` });
  const { data: dup } = await ADMIN.from("broker_connections").select("id").eq("user_id", userId)
    .eq("broker", "trading212").eq("environment", environment).limit(1);
  if (dup?.length) return json(req, 409, { error: "You already connected a Trading 212 " + (environment === "demo" ? "practice " : "") + "account. Disconnect it first to replace the key." });

  const creds: Creds = { api_key, api_secret, environment };
  let currency = "GBP";
  try {
    await t212(creds, "/api/v0/equity/account/cash");
  } catch (e) {
    if (e instanceof T212Error && (e.status === 401 || e.status === 403))
      return json(req, 400, { error: "Trading 212 rejected this key. Check the key and secret, that the key was created for the " + (environment === "demo" ? "practice" : "live") + " account, and that it has Portfolio, History and Orders read permissions." });
    if (e instanceof T212Error && e.status === 429) return json(req, 429, { error: "Trading 212 is rate limiting requests. Wait a minute and try again." });
    return json(req, 502, { error: "Could not reach Trading 212. Try again shortly." });
  }
  try { const info = await t212(creds, "/api/v0/equity/account/info"); if (info?.currencyCode) currency = String(info.currencyCode); } catch { /* optional */ }

  const { data: conn, error } = await ADMIN.from("broker_connections").insert({
    user_id: userId, broker: "trading212", label, environment, native_currency: currency, status: "pending",
  }).select("id").single();
  if (error || !conn) return json(req, 500, { error: "Could not save the connection." });

  const { error: se } = await ADMIN.rpc("store_broker_secret", { p_connection: conn.id, p_payload: JSON.stringify(creds) });
  if (se) { await ADMIN.from("broker_connections").delete().eq("id", conn.id); return json(req, 500, { error: "Could not store the key securely." }); }

  await ADMIN.from("sync_jobs").insert([{ connection_id: conn.id, kind: "snapshot" }, { connection_id: conn.id, kind: "history" }]);
  // Start syncing straight away instead of waiting for the next scheduled tick.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(tick());
  return json(req, 200, { connection_id: conn.id, status: "pending", label, currency });
}

// ── sync jobs ───────────────────────────────────────────────────────────────
type Job = { id: number; connection_id: string; kind: string; attempts: number };

async function loadCreds(connId: string): Promise<Creds | null> {
  const { data } = await ADMIN.rpc("read_broker_secret", { p_connection: connId });
  try { return data ? JSON.parse(data) : null; } catch { return null; }
}

async function snapshot(conn: any, c: Creds) {
  const cash = await t212(c, "/api/v0/equity/account/cash");
  const portfolio = (await t212(c, "/api/v0/equity/portfolio")) ?? [];
  const st = conn.sync_state ?? {};
  const highs: Record<string, number> = st.highs ?? {};

  const rows = [];
  for (const p of portfolio) {
    const cur = num(p.currentPrice) ?? 0, avg = num(p.averagePrice) ?? 0;
    if (!p.ticker || cur === 0 || avg === 0) continue;
    highs[p.ticker] = Math.max(highs[p.ticker] ?? cur, cur);
    const high = highs[p.ticker];
    rows.push({
      user_id: conn.user_id, ticker: p.ticker, display: baseSymbol(p.ticker),
      current_price: cur, avg_price: avg,
      gain_pct: Math.round(((cur - avg) / avg) * 10000) / 100,
      dip_from_high: high > 0 ? Math.round(((high - cur) / high) * 10000) / 100 : 0,
      ppl: num(p.ppl) ?? 0, quantity: num(p.quantity), broker: "trading212", native_currency: conn.native_currency,
    });
  }
  const total = num(cash.total) ?? 0, free = num(cash.free) ?? 0;
  const { data: snap, error } = await ADMIN.from("portfolio_snapshots").insert({
    user_id: conn.user_id, connection_id: conn.id, total_value: total, cash: free, invested: total - free,
    total_ppl: rows.reduce((s, r) => s + r.ppl, 0), run_count: (st.runs ?? 0) + 1, raw: { account: cash, highs },
  }).select("id").single();
  if (error || !snap) throw new Error("snapshot insert failed");
  if (rows.length) {
    const { error: pe } = await ADMIN.from("positions").insert(rows.map((r) => ({ ...r, snapshot_id: snap.id })));
    if (pe) throw new Error("positions insert failed");
  }
  const lastAlerts = await alerts(conn, rows, st.last_alerts ?? {});
  await ADMIN.from("broker_connections").update({
    status: "active", last_ok_at: new Date().toISOString(), last_error: null,
    sync_state: { ...st, highs, last_alerts: lastAlerts, runs: (st.runs ?? 0) + 1, snapshot_at: new Date().toISOString(), positions: rows.length },
  }).eq("id", conn.id);
}

// ── alerts ──────────────────────────────────────────────────────────────────
// Same thresholds and cooldowns as the original single-user monitor.
const DIP_PCT = 8, BUY_PCT = 12, TRIM_PCT = 40;
const COOLDOWN_H = { buy: 6, dip: 6, trim: 24 } as const;
const SYMBOL: Record<string, string> = { GBP: "£", USD: "$", EUR: "€" };

// ITWNl_EQ → ITWN, AAPL_US_EQ → AAPL
function baseSymbol(t: string): string {
  let core = t.replace(/_EQ$/, "");
  if (core.endsWith("_US")) return core.slice(0, -3);
  return core.replace(/[a-z]+$/, "") || core;
}
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

// deno-lint-ignore no-explicit-any
async function alerts(conn: any, rows: any[], last: Record<string, number>): Promise<Record<string, number>> {
  const now = Date.now();
  const sym = SYMBOL[conn.native_currency] ?? "";
  const out: { type: "buy" | "dip" | "trim"; ticker: string; title: string; body: string; key: string }[] = [];
  for (const r of rows) {
    const name = baseSymbol(r.ticker);
    const high = r.dip_from_high < 100 ? r.current_price / (1 - r.dip_from_high / 100) : r.current_price;
    const lines = [
      `Price now         ${sym}${r.current_price.toFixed(2)}`,
      `Tracked high      ${sym}${high.toFixed(2)}`,
      `Your avg cost     ${sym}${r.avg_price.toFixed(2)}`,
      `Gain on cost      ${pct(r.gain_pct)}`,
      `Drop from high    ${r.dip_from_high.toFixed(1)}%`,
    ].join("\n");
    const add = (type: "buy" | "dip" | "trim", title: string, note: string) => {
      const key = `${type}_${r.ticker}`;
      if (now - (last[key] ?? 0) < COOLDOWN_H[type] * 3_600_000) return;
      out.push({ type, ticker: name, title, key, body: `${lines}\n\n${note}` });
    };
    if (r.dip_from_high >= BUY_PCT)
      add("buy", `🔴 ${name} — down ${r.dip_from_high.toFixed(1)}% from tracked high`,
        "Deep-dip threshold crossed. A large fall is not automatically a good entry: check its weight against your plan first.");
    else if (r.dip_from_high >= DIP_PCT)
      add("dip", `🟡 ${name} — down ${r.dip_from_high.toFixed(1)}% from tracked high`,
        "Dip threshold crossed. Watch only for now; review the news and analyst view before acting.");
    if (r.gain_pct >= TRIM_PCT)
      add("trim", `💰 ${name} — up ${r.gain_pct.toFixed(1)}% on your cost`,
        "Profit target crossed. Consider whether to book part of the profit.");
  }
  if (!out.length) return last;

  const { error } = await ADMIN.from("alerts").insert(out.map((a) => ({
    user_id: conn.user_id, type: a.type, alert_type: a.type, ticker: a.ticker, title: a.title, body: a.body,
  })));
  if (error) return last;               // do not start the cooldown if the alert was not saved
  const next = { ...last };
  for (const a of out) next[a.key] = now;

  // Optional phone push via the user's own ntfy topic.
  const { data: prof } = await ADMIN.from("profiles").select("ntfy_topic").eq("user_id", conn.user_id).maybeSingle();
  const topic = String(prof?.ntfy_topic ?? "").trim();
  if (/^[A-Za-z0-9_-]{6,64}$/.test(topic)) {
    for (const a of out.slice(0, 5)) {
      try {
        await fetch(`https://ntfy.sh/${topic}`, {
          method: "POST", body: a.body, signal: AbortSignal.timeout(8_000),
          headers: { Title: "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(a.title))) + "?=", Priority: a.type === "buy" ? "urgent" : "default" },
        });
      } catch { /* push is best-effort */ }
    }
  }
  await sendEmail(conn.user_id, out);
  return next;
}

// ── email ───────────────────────────────────────────────────────────────────
// Needs two function secrets: RESEND_API_KEY and ALERT_FROM_EMAIL (an address on a domain verified with Resend).
// Without them this does nothing, so alerts still work in the app and via push.
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sendEmail(userId: string, items: { type: string; title: string; body: string }[]) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("ALERT_FROM_EMAIL");
  if (!key || !from || !items.length) return;
  try {
    const { data: prof } = await ADMIN.from("profiles").select("email_alerts").eq("user_id", userId).maybeSingle();
    if (prof && prof.email_alerts === false) return;
    const { data: u } = await ADMIN.auth.admin.getUserById(userId);
    const to = u?.user?.email;
    if (!to) return;
    const shown = items.slice(0, 10);
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#111">
<h2 style="margin:0 0 12px">CapitalLens alerts</h2>
${shown.map((i) => `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:12px">
<div style="font-weight:600;margin-bottom:6px">${esc(i.title)}</div>
<pre style="margin:0;font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;color:#333">${esc(i.body)}</pre></div>`).join("")}
${items.length > shown.length ? `<p>and ${items.length - shown.length} more in the app.</p>` : ""}
<p style="font-size:12px;color:#666">These are signals from your own positions, not financial advice.
Turn email alerts off any time under Accounts → Alert notifications.</p></div>`;
    const text = shown.map((i) => `${i.title}\n${i.body}`).join("\n\n") + "\n\nNot financial advice. Turn email alerts off under Accounts → Alert notifications.";
    await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], text, html,
        subject: items.length === 1 ? items[0].title.slice(0, 120) : `CapitalLens: ${items.length} alerts`,
      }),
    });
  } catch { /* email is best-effort */ }
}

const STAGES = [
  { name: "orders", path: "/api/v0/equity/history/orders?limit=50", table: "t212_orders", key: "id", map: mapOrder },
  { name: "dividends", path: "/api/v0/history/dividends?limit=50", table: "t212_dividends", key: "reference", map: mapDividend },
  { name: "transactions", path: "/api/v0/history/transactions?limit=50", table: "t212_transactions", key: "reference", map: mapTxn },
];
// deno-lint-ignore no-explicit-any
function mapOrder(it: any) {
  const fill = it.fill ?? {}, order = it.order ?? {}, wi = fill.walletImpact ?? {};
  const oid = String(order.id ?? "");
  return {
    id: fill.id != null ? String(fill.id) : `order:${oid}`, order_id: oid,
    ticker: order.ticker ?? order.instrument?.ticker ?? null, side: order.side ?? null, status: order.status ?? null,
    filled_at: fill.filledAt ?? order.createdAt ?? null, quantity: num(fill.quantity ?? order.filledQuantity),
    price: num(fill.price), net_value: num(wi.netValue), realised_pnl: num(wi.realisedProfitLoss), fx_rate: num(wi.fxRate), raw: it,
  };
}
// deno-lint-ignore no-explicit-any
function mapDividend(it: any) {
  return { reference: String(it.reference), ticker: it.ticker ?? null, paid_on: it.paidOn ?? null, amount: num(it.amount),
    quantity: num(it.quantity), type: it.type ?? null, raw: it };
}
// deno-lint-ignore no-explicit-any
function mapTxn(it: any) {
  return { reference: String(it.reference), type: it.type ?? null, amount: num(it.amount), date_time: it.dateTime ?? null, raw: it };
}

// Walk history a few pages at a time. State lives on the connection so work resumes on the next tick.
// Returns true when the whole walk is finished.
async function history(conn: any, c: Creds): Promise<boolean> {
  const st = conn.sync_state ?? {};
  const h = st.history ?? { stage: 0, next: null, full: true, pages: 0 };
  const stage = STAGES[h.stage];
  let next: string | null = h.next ?? stage.path;
  let pages = 0, last = 0;
  while (next && pages < PAGES_PER_TICK) {
    const wait = PACE_MS - (Date.now() - last);
    if (last && wait > 0) await sleep(wait);
    last = Date.now();
    const resp = await t212(c, next);
    const items = Array.isArray(resp) ? resp : (resp?.items ?? []);
    const rows = items.map(stage.map).filter((r: any) => r[stage.key] && r[stage.key] !== "undefined" && r[stage.key] !== "null");
    if (rows.length) {
      const { error } = await ADMIN.from(stage.table).upsert(
        rows.map((r: any) => ({ ...r, user_id: conn.user_id, connection_id: conn.id, last_seen: new Date().toISOString() })),
        { onConflict: `user_id,${stage.key}` });
      if (error) throw new Error(`${stage.name} upsert failed`);
    }
    pages++; h.pages = (h.pages ?? 0) + 1;
    next = Array.isArray(resp) ? null : (resp?.nextPagePath ?? null);
  }
  let done = false;
  if (next) { h.next = next; }
  else if (h.stage + 1 < STAGES.length) { h.stage += 1; h.next = null; }
  else { done = true; }
  const { data: cur } = await ADMIN.from("broker_connections").select("sync_state").eq("id", conn.id).single();
  const merged = { ...(cur?.sync_state ?? {}), history: done ? { stage: 0, next: null, full: false, pages: 0 } : h };
  if (done) merged.history_done_at = new Date().toISOString();
  await ADMIN.from("broker_connections").update({ sync_state: merged }).eq("id", conn.id);
  return done;
}

async function runJob(job: Job) {
  const finish = (state: string, extra: Record<string, unknown> = {}) =>
    ADMIN.from("sync_jobs").update({ state, ...extra }).eq("id", job.id);
  const requeue = async (mins: number, err?: string) => {
    await ADMIN.from("sync_jobs").update({ state: "queued", next_run_at: new Date(Date.now() + mins * 60_000).toISOString(), last_error: err ?? null }).eq("id", job.id);
  };
  const next = (kind: string, mins: number) =>
    ADMIN.from("sync_jobs").insert({ connection_id: job.connection_id, kind, next_run_at: new Date(Date.now() + mins * 60_000).toISOString() });

  const { data: conn } = await ADMIN.from("broker_connections").select("*").eq("id", job.connection_id).maybeSingle();
  if (!conn || conn.status === "disabled") { await finish("done"); return; }
  const creds = await loadCreds(conn.id);
  if (!creds) {
    await ADMIN.from("broker_connections").update({ status: "error", last_error: "Stored key is missing. Reconnect your account." }).eq("id", conn.id);
    await finish("failed", { last_error: "no credentials" }); return;
  }
  try {
    if (job.kind === "snapshot") { await snapshot(conn, creds); await finish("done"); await next("snapshot", 15); }
    else if (job.kind === "history") {
      const done = await history(conn, creds);
      await finish("done");
      await next("history", done ? 24 * 60 : 1);
    } else { await finish("failed", { last_error: "unknown job kind" }); }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (e instanceof T212Error && (e.status === 401 || e.status === 403)) {
      await ADMIN.from("broker_connections").update({ status: "needs_login", last_error: "Trading 212 rejected the stored key. Reconnect your account with a new key." }).eq("id", conn.id);
      await finish("failed", { last_error: msg });
    } else if (job.attempts >= 5) {
      await ADMIN.from("broker_connections").update({ status: "error", last_error: "Sync keeps failing. We will retry later." }).eq("id", conn.id);
      await finish("failed", { last_error: msg });
      await next(job.kind, 60);
    } else {
      await requeue(e instanceof T212Error && e.status === 429 ? 2 : 1, msg);
    }
  }
}

let ticking = false;
async function tick(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  const started = Date.now();
  let n = 0;
  try {
    while (Date.now() - started < TICK_BUDGET_MS) {
      const { data } = await ADMIN.rpc("claim_sync_job");
      const job = Array.isArray(data) ? data[0] : data;
      if (!job) break;
      await runJob(job as Job);
      n++;
    }
  } finally { ticking = false; }
  return n;
}

// ── router ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (path.endsWith("/connect")) return await connect(req);
    if (path.endsWith("/tick")) {
      const { data: ok } = await ADMIN.rpc("check_cron_secret", { p: req.headers.get("x-cron-secret") ?? "" });
      if (!ok) return json(req, 401, { error: "Unauthorised" });
      return json(req, 200, { jobs: await tick() });
    }
    return json(req, 404, { error: "Not found" });
  } catch (_e) {
    return json(req, 500, { error: "Unexpected error" });
  }
});

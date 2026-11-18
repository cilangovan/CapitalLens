// Central job: cache PUBLIC Yahoo market data for the curated popular symbols in the shared market_cache table.
// Reuses the relay's own handler so parsing/limits are identical. Touches no customer data and no customer tables.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.   Run: node scripts/public_market_job.mjs
import relay from '../cloudflare-worker/relay.js';
import { readFileSync } from 'node:fs';
const ORIGIN = 'https://cilangovan.github.io';
export async function run({ config, relayFetch, save, log = console.log, sleep = ms => new Promise(r => setTimeout(r, ms)), pause = 250 }) {
  const jobs = [];
  for (const s of config.symbols) { for (const r of config.ranges) jobs.push([`chart:${s}:${r}`, `/yahoo?s=${encodeURIComponent(s)}&range=${r}`]); if (!/^[\^]|=/.test(s)) { jobs.push([`info:${s}`, `/yahoo-info?s=${encodeURIComponent(s)}`]); jobs.push([`detail:${s}`, `/yahoo-detail?s=${encodeURIComponent(s)}`]); } }
  let ok = 0, failed = [];
  for (const [key, path] of jobs) {
    try {
      const r = await relayFetch(new Request('https://relay.local' + path, { headers: { Origin: ORIGIN } }));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const payload = await r.json();
      if (key.startsWith('chart:') && !(payload && payload.chart && payload.chart.result && payload.chart.result[0])) throw new Error('empty chart');
      if (key.startsWith('info:') && !payload.currency && !payload.shortName && !payload.longName) throw new Error('empty info');
      await save({ key, payload, fetched_at: new Date().toISOString() }); ok++;
    } catch (e) { failed.push(`${key}: ${e.message}`); }
    await sleep(pause);
  }
  log(`cached ${ok}/${jobs.length}` + (failed.length ? `; ${failed.length} failed (kept previous values): ${failed.slice(0, 10).join(' | ')}` : ''));
  return { ok, failed };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env; if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required'); process.exit(1); }
  const config = JSON.parse(readFileSync(new URL('../config/popular_tickers.json', import.meta.url)));
  const save = async row => { const r = await fetch(`${SUPABASE_URL}/rest/v1/market_cache?on_conflict=key`, { method: 'POST', headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) }); if (!r.ok) throw new Error('save HTTP ' + r.status); };
  const res = await run({ config, relayFetch: r => relay.fetch(r), save });
  process.exit(res.ok === 0 ? 1 : 0);
}

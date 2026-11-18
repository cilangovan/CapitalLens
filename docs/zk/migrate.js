// Moves an account's existing plaintext rows into encrypted storage (public.enc_rows), entirely in the browser.
// Order of safety: read -> encrypt -> upload -> VERIFY by downloading and decrypting -> (separate, explicit) delete plaintext.
(function (root) {
  'use strict';
  // Customer data tables (children before parents so deletes never hit foreign keys). Public market data is not touched.
  const TABLES = ['positions', 'positions_archive', 'portfolio_snapshots', 'portfolio_snapshots_archive', 't212_orders', 't212_transactions',
    't212_dividends', 'dividends', 'realised_pnl', 'watchlist', 'watchlist_analysis', 'pie_history', 'profit_booking', 'profit_booking_summary',
    'returns_summary', 'holding_decisions', 'strategy_recommendations', 'value_buy_scores', 'alerts', 'analyst_ratings'];
  const PAGE = 1000, BATCH = 200;

  async function readAll(call, token, table) {
    const out = [];
    for (let off = 0; ; off += PAGE) {
      let r = await call(`/rest/v1/${table}?select=*&order=id&limit=${PAGE}&offset=${off}`, {}, token);
      if (r.status === 400 && off === 0) r = await call(`/rest/v1/${table}?select=*&limit=${PAGE}`, {}, token);   // table without an id column (small)
      if (!r.ok) throw new Error(`read ${table}: ${r.status}`);
      out.push(...r.d);
      if (r.d.length < PAGE) break;
    }
    return out;
  }
  async function readEnc(call, token, kind) {
    const out = [];
    for (let off = 0; ; off += PAGE) {
      const r = await call(`/rest/v1/enc_rows?select=id,nonce,ct&kind=eq.${kind}&order=id&limit=${PAGE}&offset=${off}`, {}, token);
      if (!r.ok) throw new Error(`read enc ${kind}: ${r.status}`);
      out.push(...r.d);
      if (r.d.length < PAGE) break;
    }
    return out;
  }
  // Same content, same fingerprint, whatever order the rows came back in.
  async function fingerprint(rows) {
    const s = rows.map(x => JSON.stringify(x, Object.keys(x).sort())).sort().join('\n');
    return root.ZK.b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  }

  async function encryptAll(ctx, onProgress) {
    const { call, token, uid, dk } = ctx, report = [];
    for (const t of TABLES) {
      const rows = await readAll(call, token, t);
      onProgress && onProgress(`Encrypting ${t} (${rows.length})`);
      const del = await call(`/rest/v1/enc_rows?kind=eq.${t}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, token);   // re-runnable
      if (!del.ok) throw new Error(`clear ${t}: ${del.status}`);
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = [];
        for (const row of rows.slice(i, i + BATCH)) {
          const id = crypto.randomUUID(), box = await root.ZK.encryptRow(dk, row, t, id, uid);
          batch.push({ kind: t, id, nonce: box.nonce, ct: box.ct });
        }
        const up = await call('/rest/v1/enc_rows', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(batch) }, token);
        if (!up.ok) throw new Error(`upload ${t}: ${up.status}`);
      }
      report.push({ table: t, rows: rows.length });
    }
    return report;
  }

  // Download everything back, decrypt, and compare with the live plaintext. Nothing is deleted here.
  async function verify(ctx, onProgress) {
    const { call, token, uid, dk } = ctx, out = [];
    for (const t of TABLES) {
      onProgress && onProgress(`Verifying ${t}`);
      const plain = await readAll(call, token, t), enc = await readEnc(call, token, t), dec = [];
      for (const e of enc) dec.push(await root.ZK.decryptRow(dk, e, t, e.id, uid));
      out.push({ table: t, plain: plain.length, enc: dec.length, same: plain.length === dec.length && (await fingerprint(plain)) === (await fingerprint(dec)) });
    }
    return out;
  }

  // Only after a clean verify, and only when the caller explicitly asks.
  async function purgePlaintext(ctx, onProgress) {
    const { call, token, uid } = ctx;
    for (const t of TABLES) {
      onProgress && onProgress(`Deleting plaintext ${t}`);
      const r = await call(`/rest/v1/${t}?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, token);
      if (!r.ok) throw new Error(`delete ${t}: ${r.status}`);
    }
  }

  async function summary(ctx) {
    const { call, token, uid, dk } = ctx, out = {};
    for (const t of TABLES) {
      const enc = await readEnc(call, token, t); let ok = 0;
      for (const e of enc) { try { await root.ZK.decryptRow(dk, e, t, e.id, uid); ok++; } catch (x) {} }
      if (enc.length) out[t] = ok + '/' + enc.length;
    }
    return out;
  }
  root.ZKMigrate = { TABLES, encryptAll, verify, purgePlaintext, summary };
})(window);

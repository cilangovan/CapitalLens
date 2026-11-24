// Encrypted row store on top of public.enc_rows. Everything is encrypted/decrypted in the browser.
// Row ids are deterministic (HMAC of kind+natural key under a key derived from the data key), so re-syncing the same
// record updates it in place, while the server only ever sees opaque ids and ciphertext.
(function (root) {
  'use strict';
  const PAGE = 1000, BATCH = 200;
  const te = new TextEncoder();

  async function idKey(dk) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
    const material = await crypto.subtle.digest('SHA-256', new Uint8Array([...te.encode('capitallens-rowid-v1'), ...raw]));
    return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  function uuidFrom(bytes) {
    const h = [...bytes.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }

  function create(ctx) {
    const { call, token, uid, dk } = ctx, ZK = root.ZK;
    let hmac = null;
    async function id(kind, key) {
      hmac = hmac || await idKey(dk);
      return uuidFrom(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, te.encode(kind + '|' + String(key)))));
    }
    // Read cache for ONE refresh: every analysis step re-reads positions/snapshots/orders, and each read pages + decrypts every row.
    // While switched on (cache(true), by the pipeline) a kind is fetched + decrypted once and shared; put/remove of that kind drops it.
    // Callers get a copy, so a step that sorts or edits rows can't leak into another step. Off by default: normal reads are always fresh.
    let cacheOn = false; const memo = new Map();
    const clone = v => typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
    function cache(on) { cacheOn = !!on; memo.clear(); }
    async function load(kind) {
      if (!cacheOn) return loadFresh(kind);
      if (!memo.has(kind)) { const p = loadFresh(kind); memo.set(kind, p); p.catch(() => { if (memo.get(kind) === p) memo.delete(kind); }); }
      return clone(await memo.get(kind));
    }
    async function loadFresh(kind) {
      const out = []; let bad = 0;
      for (let off = 0; ; off += PAGE) {
        const r = await call(`/rest/v1/enc_rows?select=id,nonce,ct&kind=eq.${kind}&order=id&limit=${PAGE}&offset=${off}`, {}, token);
        if (!r.ok) throw new Error(`read ${kind}: ${r.status}`);
        for (const e of r.d) { try { out.push(await ZK.decryptRow(dk, e, kind, e.id, uid)); } catch (x) { bad++; } }
        if (r.d.length < PAGE) break;
      }
      if (bad) throw new Error(`${bad} ${kind} rows could not be decrypted`);
      return out;
    }
    // rows: array of objects; keyOf: natural key of a row. Existing rows with the same key are replaced.
    async function put(kind, rows, keyOf) {
      const byId = new Map();
      for (const row of rows) byId.set(await id(kind, keyOf(row)), row);
      const ids = [...byId.keys()]; memo.delete(kind);
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = await Promise.all(ids.slice(i, i + BATCH).map(async rid => {      // encrypt a batch in parallel (order kept)
          const box = await ZK.encryptRow(dk, byId.get(rid), kind, rid, uid);
          return { kind, id: rid, nonce: box.nonce, ct: box.ct, updated_at: new Date().toISOString() };
        }));
        const r = await call('/rest/v1/enc_rows?on_conflict=user_id,kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) }, token);
        if (!r.ok) throw new Error(`write ${kind}: ${r.status}`);
      }
      return ids.length;
    }
    async function get(kind, key) {
      const rid = await id(kind, key);
      const r = await call(`/rest/v1/enc_rows?select=id,nonce,ct&kind=eq.${kind}&id=eq.${rid}`, {}, token);
      if (!r.ok) throw new Error(`read ${kind}: ${r.status}`);
      return r.d.length ? ZK.decryptRow(dk, r.d[0], kind, rid, uid) : null;
    }
    async function remove(kind, key) {
      const rid = await id(kind, key); memo.delete(kind);
      const r = await call(`/rest/v1/enc_rows?kind=eq.${kind}&id=eq.${rid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, token);
      if (!r.ok) throw new Error(`delete ${kind}: ${r.status}`);
    }
    return { id, load, put, get, remove, cache };
  }
  root.ZKStore = { create };
  if (typeof module !== 'undefined') module.exports = root.ZKStore;
})(typeof window !== 'undefined' ? window : globalThis);

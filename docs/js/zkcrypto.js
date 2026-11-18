// Zero-knowledge crypto core (browser WebCrypto). Not wired into the app yet.
// Everything here runs on the customer's device; the server only ever receives ciphertext, salts and the derived auth secret.
//   password --PBKDF2--> master --HKDF("auth")--> authSecret  (sent to Supabase Auth as the "password")
//                               \--HKDF("enc") --> kek         (never leaves the browser; wraps the data key)
//   data key (DK, random) is stored only wrapped by the kek and, separately, by a one-time recovery key.
(function (root) {
  'use strict';
  const subtle = (root.crypto || require('node:crypto').webcrypto).subtle;
  const rnd = n => (root.crypto || require('node:crypto').webcrypto).getRandomValues(new Uint8Array(n));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const KDF = { name: 'PBKDF2-SHA256', iterations: 600000 };   // OWASP 2023 minimum for PBKDF2-HMAC-SHA256

  const b64 = u8 => { let s = ''; u8.forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function hkdf(masterBytes, label) {
    const k = await subtle.importKey('raw', masterBytes, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(label) }, k, 256));
  }
  // Derive the two independent values from the password (or from a recovery key).
  async function deriveKeys(secretText, saltB64, iterations) {
    const base = await subtle.importKey('raw', enc.encode(secretText.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const master = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iterations || KDF.iterations }, base, 256));
    const authBytes = await hkdf(master, 'capitallens/auth/v1');
    const kekBytes = await hkdf(master, 'capitallens/enc/v1');
    const kek = await subtle.importKey('raw', kekBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { authSecret: b64(authBytes), kek };
  }
  const newSalt = () => b64(rnd(16));

  async function newDataKey() { return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
  const aesImport = raw => subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

  async function seal(key, bytes, aad) {
    const iv = rnd(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad ? enc.encode(aad) : undefined }, key, bytes));
    return { nonce: b64(iv), ct: b64(ct) };
  }
  async function open(key, box, aad) {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.nonce), additionalData: aad ? enc.encode(aad) : undefined }, key, unb64(box.ct)));
  }

  // Wrap / unwrap the data key
  async function wrapDataKey(dk, kek, aad) { return seal(kek, new Uint8Array(await subtle.exportKey('raw', dk)), aad || 'dk'); }
  async function unwrapDataKey(box, kek, aad) { return aesImport(await open(kek, box, aad || 'dk')); }

  // One-time recovery key: 160 random bits shown as groups of 4 base32 characters
  function newRecoveryKey() {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', b = rnd(20); let bits = 0, v = 0, out = '';
    for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } }
    return out.match(/.{1,4}/g).join('-');
  }
  const cleanRecovery = s => s.replace(/[\s-]/g, '').toUpperCase();

  // Create everything needed at sign-up. `store` goes to the server (all ciphertext/salts); `recoveryKey` is shown once to the customer.
  async function createAccount(password) {
    const dk = await newDataKey();
    const pwSalt = newSalt(), recSalt = newSalt();
    const recoveryKey = newRecoveryKey();
    const pw = await deriveKeys(password, pwSalt), rec = await deriveKeys(cleanRecovery(recoveryKey), recSalt);
    return {
      dk, recoveryKey, authSecret: pw.authSecret,
      store: { kdf: KDF, pw_salt: pwSalt, rec_salt: recSalt, wrapped_dk_pw: await wrapDataKey(dk, pw.kek), wrapped_dk_rec: await wrapDataKey(dk, rec.kek), key_version: 1 },
    };
  }
  async function unlockWithPassword(password, store) {
    const { authSecret, kek } = await deriveKeys(password, store.pw_salt, store.kdf && store.kdf.iterations);
    return { dk: await unwrapDataKey(store.wrapped_dk_pw, kek), authSecret };
  }
  async function unlockWithRecovery(recoveryKey, store) {
    const { kek } = await deriveKeys(cleanRecovery(recoveryKey), store.rec_salt, store.kdf && store.kdf.iterations);
    return unwrapDataKey(store.wrapped_dk_rec, kek);
  }
  // Change password (or reset using the recovery key): re-wrap the same data key; data does not need re-encrypting.
  async function rewrapForNewPassword(dk, newPassword, store) {
    const pwSalt = newSalt(), pw = await deriveKeys(newPassword, pwSalt);
    return { authSecret: pw.authSecret, store: Object.assign({}, store, { pw_salt: pwSalt, wrapped_dk_pw: await wrapDataKey(dk, pw.kek) }) };
  }

  // Row encryption. aad binds the ciphertext to its table, row id and owner so rows can't be swapped between records or users.
  const rowAad = (table, id, userId) => `${table}|${id}|${userId}`;
  async function encryptRow(dk, obj, table, id, userId) { return seal(dk, enc.encode(JSON.stringify(obj)), rowAad(table, id, userId)); }
  async function decryptRow(dk, box, table, id, userId) { return JSON.parse(dec.decode(await open(dk, box, rowAad(table, id, userId)))); }

  root.ZK = { KDF, deriveKeys, newSalt, createAccount, unlockWithPassword, unlockWithRecovery, rewrapForNewPassword, encryptRow, decryptRow, newRecoveryKey, b64, unb64 };
  if (typeof module !== 'undefined') module.exports = root.ZK;
})(typeof window !== 'undefined' ? window : globalThis);

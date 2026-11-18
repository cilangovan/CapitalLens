// Run: node tests/zk_crypto_test.mjs
import { createRequire } from 'node:module';
const ZK = createRequire(import.meta.url)('../docs/js/zkcrypto.js');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  ✗ ') + name); };
const throws = async (f) => { try { await f(); return false; } catch (e) { return true; } };

const acct = await ZK.createAccount('correct horse battery staple');
const userId = '11111111-1111-1111-1111-111111111111';
ok('recovery key looks like XXXX-XXXX-… (32 chars + 7 dashes)', /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(acct.recoveryKey));
ok('server store has only salts + ciphertext (no raw key, password or recovery key)',
  !JSON.stringify(acct.store).includes(acct.recoveryKey) && !JSON.stringify(acct.store).includes('correct horse') && Object.keys(acct.store).sort().join() === 'kdf,key_version,pw_salt,rec_salt,wrapped_dk_pw,wrapped_dk_rec');

const u = await ZK.unlockWithPassword('correct horse battery staple', acct.store);
ok('right password unlocks the data key', !!u.dk);
ok('auth secret is stable for the same password+salt', u.authSecret === acct.authSecret);
ok('wrong password cannot unlock', await throws(() => ZK.unlockWithPassword('wrong password', acct.store)));
ok('auth secret differs from anything the server stores', !JSON.stringify(acct.store).includes(acct.authSecret));

const row = { ticker: 'SMGBl_EQ', qty: 12.5, ppl: 120.5 };
const box = await ZK.encryptRow(u.dk, row, 'positions', 'row-1', userId);
ok('ciphertext hides the plaintext', !JSON.stringify(box).includes('SMGB') && !JSON.stringify(box).includes('120'));
ok('round trip returns the same row', JSON.stringify(await ZK.decryptRow(u.dk, box, 'positions', 'row-1', userId)) === JSON.stringify(row));
ok('two encryptions of the same row differ (fresh nonce)', (await ZK.encryptRow(u.dk, row, 'positions', 'row-1', userId)).ct !== box.ct);
ok('moving a row to another id is detected', await throws(() => ZK.decryptRow(u.dk, box, 'positions', 'row-2', userId)));
ok('moving a row to another user is detected', await throws(() => ZK.decryptRow(u.dk, box, 'positions', 'row-1', '22222222-2222-2222-2222-222222222222')));
ok('moving a row to another table is detected', await throws(() => ZK.decryptRow(u.dk, box, 'orders', 'row-1', userId)));
const tampered = { nonce: box.nonce, ct: box.ct.slice(0, -4) + (box.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
ok('tampered ciphertext is rejected', await throws(() => ZK.decryptRow(u.dk, tampered, 'positions', 'row-1', userId)));

const dkViaRecovery = await ZK.unlockWithRecovery(acct.recoveryKey, acct.store);
ok('recovery key (with dashes/lowercase) unlocks the same data key',
  JSON.stringify(await ZK.decryptRow(await ZK.unlockWithRecovery(acct.recoveryKey.toLowerCase().replace(/-/g, ' '), acct.store), box, 'positions', 'row-1', userId)) === JSON.stringify(row));
ok('wrong recovery key fails', await throws(() => ZK.unlockWithRecovery('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', acct.store)));

const changed = await ZK.rewrapForNewPassword(dkViaRecovery, 'new password 123', acct.store);
const u2 = await ZK.unlockWithPassword('new password 123', changed.store);
ok('after password change/reset the new password unlocks', u2.authSecret === changed.authSecret);
ok('old data still decrypts after password change (no re-encryption needed)',
  JSON.stringify(await ZK.decryptRow(u2.dk, box, 'positions', 'row-1', userId)) === JSON.stringify(row));
ok('old password no longer works', await throws(() => ZK.unlockWithPassword('correct horse battery staple', changed.store)));
ok('new auth secret differs from the old one', changed.authSecret !== acct.authSecret);
const a2 = await ZK.createAccount('correct horse battery staple');
ok('same password on another account gives a different auth secret (per-user salt)', a2.authSecret !== acct.authSecret);

{ const nr = await ZK.rewrapRecovery(acct.dk, acct.store), st2 = Object.assign({}, acct.store, { rec_salt: nr.rec_salt, wrapped_dk_rec: nr.wrapped_dk_rec });
  const viaNew = await ZK.unlockWithRecovery(nr.recoveryKey, st2), probe = await ZK.encryptRow(acct.dk, { a: 1 }, 't', 'id1', userId);
  ok('new recovery key unlocks the same data key', (await ZK.decryptRow(viaNew, probe, 't', 'id1', userId)).a === 1);
  ok('the old recovery key stops working after rotation', await throws(() => ZK.unlockWithRecovery(acct.recoveryKey, st2)));
  ok('password login still works after rotation', !!(await ZK.unlockWithPassword('correct horse battery staple', st2)).dk); }
console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);

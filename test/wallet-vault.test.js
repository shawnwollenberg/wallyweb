const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const vault = require('../wallet/wallet');

const password = 'correct horse battery staple';
const cards = [
  { id: 'c_1', label: 'Café 東京 🎟️', color: 'indigo', value: '会员-123-✓', format: 'qrcode', createdAt: 1700000000000 },
  { id: 'c_2', label: 'Linear', color: 'teal', value: '0123456789012', format: 'ean13', createdAt: 1700000000001 },
];

test('wallet constants retain version-one compatibility parameters', () => {
  assert.equal(vault.STORAGE_KEY, 'wallyweb:wallet:v1');
  assert.equal(vault.VERSION, 1);
  assert.equal(vault.PBKDF2_ITERS, 310000);
  assert.equal(vault.SALT_LEN, 16);
  assert.equal(vault.IV_LEN, 12);
});

for (const payload of [{ cards: [] }, { cards }]) {
  test(`wallet round-trips ${payload.cards.length ? 'populated Unicode' : 'empty'} cards`, async () => {
    const record = await vault.encrypt(password, payload);
    assert.deepEqual(await vault.decrypt(password, record), payload);
  });
}

test('repeated encryption uses independent salt, IV and ciphertext', async () => {
  const a = await vault.encrypt(password, { cards });
  const b = await vault.encrypt(password, { cards });
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('wrong password and tampered ciphertext or IV fail authentication', async () => {
  const record = await vault.encrypt(password, { cards });
  await assert.rejects(vault.decrypt('wrong password', record));
  for (const field of ['ct', 'iv']) {
    const bytes = Buffer.from(record[field], 'base64'); bytes[0] ^= 1;
    await assert.rejects(vault.decrypt(password, { ...record, [field]: bytes.toString('base64') }));
  }
});

test('malformed records are rejected rather than becoming empty wallets', async () => {
  const record = await vault.encrypt(password, { cards: [] });
  const malformed = [
    {}, { ...record, v: 2 }, { ...record, salt: '***' }, { ...record, iv: 'AA==' },
    { ...record, ct: 'not base64' }, { ...record, ct: undefined }, null,
  ];
  for (const value of malformed) {
    await assert.rejects(() => vault.decrypt(password, value), vault.VaultDataError);
  }
});

test('validly encrypted invalid JSON and invalid structure are corruption', async () => {
  const salt = webcrypto.getRandomValues(new Uint8Array(vault.SALT_LEN));
  const key = await vault.deriveKey(password, salt);
  for (const plaintext of ['not-json', JSON.stringify({ nope: [] })]) {
    const iv = webcrypto.getRandomValues(new Uint8Array(vault.IV_LEN));
    const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const record = { v: 1, salt: vault.buf2b64(salt), iv: vault.buf2b64(iv), ct: vault.buf2b64(ct) };
    await assert.rejects(() => vault.decrypt(password, record), vault.VaultDataError);
  }
});

test('storage serialization round-trips and absence differs from corruption', async () => {
  const record = await vault.encrypt(password, { cards });
  assert.deepEqual(vault.deserialize(vault.serialize(record)), record);
  assert.equal(vault.deserialize(null), null);
  assert.throws(() => vault.deserialize('{bad json'), vault.VaultDataError);
  assert.throws(() => vault.deserialize(JSON.stringify({ cards: [] })), vault.VaultDataError);
});

test('fixed version-one fixture decrypts after refactor', async () => {
  const record = {
    v: 1,
    salt: 'AAECAwQFBgcICQoLDA0ODw==',
    iv: 'Dw4NDAsKCQgHBgUE',
    ct: 'dGC5iBMdINMhIOy0hKajX5aGYhd8vKqtkGWHOTgNrDwIsBXTSW2RGz1RaKTgGTbv7s3nYS1dD5yykSttWOtzsYa6eokFnryXYOcFpBSvvysryVGjBk0bc5SvoNZ4ecx44SLpWoWZpToH8MUcdIhVMqNapsRYsCOU9pKGBPLJtBuOveqzUI0=',
  };
  assert.deepEqual(await vault.decrypt('fixture-password', record), {
    cards: [{ id: 'legacy', label: 'Legacy Café', color: 'indigo', value: 'ABC-123', format: 'code128', createdAt: 1 }],
  });
});

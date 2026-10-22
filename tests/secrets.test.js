const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// secrets.js needs Electron's app and safeStorage; stub them with a reversible fake cipher.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-secrets-'));
const fakeElectron = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => b.toString().replace(/^enc:/, '')
  }
};
const originalLoad = Module._load;
Module._load = (request, ...rest) => (request === 'electron' ? fakeElectron : originalLoad(request, ...rest));
const { protectProfiles, resolveSecrets } = require('../secrets');

test('plain keys are replaced by placeholders and never written to disk in clear', () => {
  const stored = protectProfiles(JSON.stringify([{ id: 'p1', key: 'AIza-real-key', format: 'gemini' }]));
  assert.strictEqual(JSON.parse(stored)[0].key, 'secret:p1');
  assert.ok(!fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8').includes('AIza-real-key'));
});

test('resolveSecrets swaps placeholders back, including in nested payloads', () => {
  protectProfiles(JSON.stringify([{ id: 'p2', key: 'sk-abc' }]));
  const resolved = resolveSecrets({ apiKey: 'secret:p2', profile: { key: 'secret:p2', list: ['secret:p2'] }, note: 'hello' });
  assert.deepStrictEqual(resolved, { apiKey: 'sk-abc', profile: { key: 'sk-abc', list: ['sk-abc'] }, note: 'hello' });
});

test('saving a profile list again keeps existing placeholders and the stored key', () => {
  protectProfiles(JSON.stringify([{ id: 'p3', key: 'first-key' }]));
  protectProfiles(JSON.stringify([{ id: 'p3', key: 'secret:p3' }]));
  assert.strictEqual(resolveSecrets('secret:p3'), 'first-key');
});

test('keys of deleted profiles are removed from the store', () => {
  protectProfiles(JSON.stringify([{ id: 'p4', key: 'gone' }]));
  protectProfiles(JSON.stringify([]));
  assert.strictEqual(resolveSecrets('secret:p4'), 'secret:p4');
});

test('unknown placeholders and ordinary strings pass through untouched', () => {
  assert.strictEqual(resolveSecrets('secret:missing'), 'secret:missing');
  assert.strictEqual(resolveSecrets('just text'), 'just text');
});

test('an undecryptable key is reported, but ordinary text starting with "secret:" is not', () => {
  const { hasUnresolvedSecret } = require('../secrets');
  assert.strictEqual(hasUnresolvedSecret({ profile: { key: 'secret:never-stored' } }), true);
  assert.strictEqual(hasUnresolvedSecret({ apiKey: 'secret:never-stored' }), true);
  assert.strictEqual(hasUnresolvedSecret({ messages: [{ text: 'secret: my diary entry' }] }), false);
  assert.strictEqual(hasUnresolvedSecret({ profile: { key: 'sk-real' } }), false);
});

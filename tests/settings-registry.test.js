const test = require('node:test');
const assert = require('node:assert');

async function makeRegistry(initial = []) {
  const { createRegistry } = await import('../renderer/js/settings-registry.js');
  const saved = [...initial];
  const registry = createRegistry({
    getAll: async () => saved.map((row) => ({ ...row })),
    set: async (key, scope, scopeId, value) => {
      const i = saved.findIndex((r) => r.key === key && r.scope === scope && r.scopeId === scopeId);
      if (i >= 0) saved.splice(i, 1);
      saved.push({ key, scope, scopeId, value });
    },
    reset: async (key, scope, scopeId) => {
      const i = saved.findIndex((r) => r.key === key && r.scope === scope && r.scopeId === scopeId);
      if (i >= 0) saved.splice(i, 1);
    }
  });
  registry.saved = saved;
  return registry;
}

const zoom = { key: 'reading.defaultZoom', label: 'Zoom', type: 'number', min: 25, max: 500, default: 135, scopes: ['app', 'document'] };

test('values fall back to the default until set', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  await r.load();
  assert.strictEqual(r.getSetting('reading.defaultZoom'), 135);
  assert.strictEqual(r.isModified('reading.defaultZoom'), false);
});

test('the narrowest scope wins: document over app over default', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  await r.setSetting('reading.defaultZoom', 150);
  await r.setSetting('reading.defaultZoom', 200, 'document', 'doc1');
  assert.strictEqual(r.getSetting('reading.defaultZoom'), 150);
  assert.strictEqual(r.getSetting('reading.defaultZoom', { documentId: 'doc1' }), 200);
  assert.strictEqual(r.getSetting('reading.defaultZoom', { documentId: 'other' }), 150);
});

test('a scope the setting does not allow is rejected', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  await assert.rejects(() => r.setSetting('reading.defaultZoom', 150, 'workspace', 'w1'), /does not support scope/);
});

test('numbers are clamped and non-numbers rejected', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  assert.strictEqual(await r.setSetting('reading.defaultZoom', 9999), 500);
  assert.strictEqual(await r.setSetting('reading.defaultZoom', 1), 25);
  await assert.rejects(() => r.setSetting('reading.defaultZoom', 'abc'), /must be a number/);
});

test('enum values must be one of the options', async () => {
  const r = await makeRegistry();
  r.registerSetting({ key: 'ai.defaultMode', label: 'Mode', type: 'enum', default: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'document', label: 'Doc' }] });
  await r.setSetting('ai.defaultMode', 'document');
  assert.strictEqual(r.getSetting('ai.defaultMode'), 'document');
  await assert.rejects(() => r.setSetting('ai.defaultMode', 'web'), /not an allowed option/);
});

test('setting the default value clears the stored override', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  await r.setSetting('reading.defaultZoom', 150);
  assert.strictEqual(r.saved.length, 1);
  await r.setSetting('reading.defaultZoom', 135);
  assert.strictEqual(r.saved.length, 0);
  assert.strictEqual(r.isModified('reading.defaultZoom'), false);
});

test('reset removes the override and notifies listeners', async () => {
  const r = await makeRegistry();
  r.registerSetting(zoom);
  const seen = [];
  r.onChange((key) => seen.push(key));
  await r.setSetting('reading.defaultZoom', 150);
  await r.resetSetting('reading.defaultZoom');
  assert.strictEqual(r.getSetting('reading.defaultZoom'), 135);
  assert.deepStrictEqual(seen, ['reading.defaultZoom', 'reading.defaultZoom']);
});

test('stored values load, and stale or invalid ones are ignored', async () => {
  const r = await makeRegistry([
    { key: 'reading.defaultZoom', scope: 'app', scopeId: '', value: 180 },
    { key: 'removed.setting', scope: 'app', scopeId: '', value: 1 },
    { key: 'ai.defaultMode', scope: 'app', scopeId: '', value: 'nonsense' }
  ]);
  r.registerSetting(zoom);
  r.registerSetting({ key: 'ai.defaultMode', label: 'Mode', type: 'enum', default: 'auto', options: [{ value: 'auto', label: 'Auto' }] });
  await r.load();
  assert.strictEqual(r.getSetting('reading.defaultZoom'), 180);
  assert.strictEqual(r.getSetting('ai.defaultMode'), 'auto');
});

test('locked settings cannot be changed and duplicate keys are rejected', async () => {
  const r = await makeRegistry();
  r.registerSetting({ key: 'security.csp', label: 'CSP', type: 'boolean', default: true, locked: true });
  await assert.rejects(() => r.setSetting('security.csp', false), /locked/);
  assert.throws(() => r.registerSetting({ key: 'security.csp', label: 'again', type: 'boolean', default: true }), /already registered/);
});

test('the real definitions all register cleanly with valid defaults', async () => {
  global.window = { electronAPI: { getSettings: async () => [], setSetting: async () => true, resetSetting: async () => true } };
  const { registerAllSettings } = await import('../renderer/js/settings-definitions.js');
  const { listSettings, getSetting } = await import('../renderer/js/settings-registry.js');
  registerAllSettings();
  assert.ok(listSettings().length >= 6);
  assert.strictEqual(getSetting('reading.defaultViewMode'), 'single');
  assert.strictEqual(getSetting('annotation.author'), 'Thinker');
  delete global.window;
});

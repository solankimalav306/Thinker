const test = require('node:test');
const assert = require('node:assert');

function fakeDocument() {
  const props = new Map();
  global.document = {
    documentElement: {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: (k) => props.delete(k)
      }
    }
  };
  global.window = { electronAPI: { getItem: () => null, setItem() {}, removeItem() {}, setTitleBarTheme() {} } };
  return props;
}

test('a dark accent gets light text and a light accent gets dark text', async () => {
  const props = fakeDocument();
  const { applyAccent } = await import('../renderer/js/theme.js');
  applyAccent('#4f46e5');
  assert.strictEqual(props.get('--primary'), '#4f46e5');
  assert.strictEqual(props.get('--on-primary'), '#ffffff');
  applyAccent('#2fbf9b');
  assert.strictEqual(props.get('--on-primary'), '#1c1b2e');
});

test('the brand default or an invalid colour clears the override', async () => {
  const props = fakeDocument();
  const { applyAccent } = await import('../renderer/js/theme.js');
  applyAccent('#ff6b57');
  assert.ok(props.has('--primary'));
  applyAccent('#FFD23F');
  assert.strictEqual(props.size, 0);
  applyAccent('#ff6b57');
  applyAccent('not-a-colour');
  assert.strictEqual(props.size, 0);
});

test('every accent preset is a valid, readable choice', async () => {
  fakeDocument();
  const { ACCENT_PRESETS } = await import('../renderer/js/theme.js');
  assert.ok(ACCENT_PRESETS.length >= 4);
  for (const preset of ACCENT_PRESETS) assert.match(preset.value, /^#[0-9a-f]{6}$/i);
});

test('every preset and a spread of custom colours end up with readable button text (4.5:1)', async () => {
  fakeDocument();
  const { accentColors, contrastRatio, ACCENT_PRESETS } = await import('../renderer/js/theme.js');
  const samples = [...ACCENT_PRESETS.map((p) => p.value), '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#7a7a7a', '#a0a0a0', '#e91e63', '#795548'];
  for (const color of samples) {
    const { fill, text } = accentColors(color);
    assert.ok(contrastRatio(fill, text) >= 4.5, `${color} -> ${fill} with ${text} is ${contrastRatio(fill, text).toFixed(2)}`);
  }
});

test('colours that already read well are left untouched', async () => {
  fakeDocument();
  const { accentColors } = await import('../renderer/js/theme.js');
  assert.strictEqual(accentColors('#4f46e5').fill, '#4f46e5');
  assert.strictEqual(accentColors('#ffd23f').fill, '#ffd23f');
});

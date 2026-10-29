const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/js/page-geometry.js');

test('a quick flick across a line erases it even when no sampled point is near', async () => {
  const { strokeTouchedBy } = await load();
  const line = [{ x: 0, y: 100 }, { x: 200, y: 100 }]; // two points 200px apart
  assert.strictEqual(strokeTouchedBy(line, { x: 100, y: 60 }, { x: 100, y: 140 }, 12), true);
  assert.strictEqual(strokeTouchedBy(line, { x: 100, y: 20 }, { x: 100, y: 60 }, 12), false);
});

test('erasing a single dot and a miss', async () => {
  const { strokeTouchedBy } = await load();
  assert.strictEqual(strokeTouchedBy([{ x: 50, y: 50 }], { x: 55, y: 52 }, null, 12), true);
  assert.strictEqual(strokeTouchedBy([{ x: 50, y: 50 }], { x: 90, y: 90 }, null, 12), false);
  assert.strictEqual(strokeTouchedBy([], { x: 1, y: 1 }, null, 12), false);
});

test('the most visible page wins, and gaps between pages are handled', async () => {
  const { mostVisiblePage } = await load();
  const cards = [{ page: 1, top: 0, height: 1000 }, { page: 2, top: 1016, height: 1000 }, { page: 3, top: 2032, height: 1000 }];
  assert.strictEqual(mostVisiblePage(cards, 0, 800), 1);
  assert.strictEqual(mostVisiblePage(cards, 600, 800), 1); // 400px of page 1, 384px of page 2
  assert.strictEqual(mostVisiblePage(cards, 700, 800), 2);
  assert.strictEqual(mostVisiblePage(cards, 2900, 800), 3);
  assert.strictEqual(mostVisiblePage([], 0, 800), null);
});

test('pinch zoom is smooth, directional and clamped', async () => {
  const { scaleAfterWheel, MIN_SCALE, MAX_SCALE } = await load();
  assert.ok(scaleAfterWheel(1, -4) > 1 && scaleAfterWheel(1, -4) < 1.02);
  assert.ok(scaleAfterWheel(1, 4) < 1);
  assert.ok(scaleAfterWheel(1, -100) > 1.15 && scaleAfterWheel(1, -100) < 1.25);
  assert.strictEqual(scaleAfterWheel(MAX_SCALE, -120), MAX_SCALE);
  assert.strictEqual(scaleAfterWheel(MIN_SCALE, 120), MIN_SCALE);
});

test('the page turns only after a deliberate push at the edge', async () => {
  const { createWheelTurner } = await load();
  const turn = createWheelTurner();
  let t = 0;
  const push = (deltaY, edge) => turn({ deltaY, atTop: edge === 'top', atBottom: edge === 'bottom', now: (t += 16) });
  // scrolling in the middle of a page never turns it
  for (let i = 0; i < 30; i += 1) assert.strictEqual(push(40, 'none'), null);
  // one small nudge at the bottom is not enough
  assert.strictEqual(push(30, 'bottom'), null);
  // a sustained push is
  let result = null;
  for (let i = 0; i < 10 && !result; i += 1) result = push(40, 'bottom');
  assert.strictEqual(result, 'next');
});

test('inertia after a turn does not turn a second page, a fresh swipe does', async () => {
  const { createWheelTurner } = await load();
  const turn = createWheelTurner();
  let t = 0;
  const push = (deltaY, edge) => turn({ deltaY, atTop: edge === 'top', atBottom: edge === 'bottom', now: (t += 16) });
  let first = null;
  for (let i = 0; i < 12 && !first; i += 1) first = push(60, 'bottom');
  assert.strictEqual(first, 'next');
  for (let i = 0; i < 40; i += 1) assert.strictEqual(push(60, 'bottom'), null); // momentum tail, still one gesture
  t += 400; // fingers lifted
  let second = null;
  for (let i = 0; i < 12 && !second; i += 1) second = push(-60, 'top');
  assert.strictEqual(second, 'prev');
});

test('the same spot stays under the viewport after a re-layout', async () => {
  const { anchorFromScroll, scrollFromAnchor } = await load();
  const before = [{ page: 1, top: 0, height: 1000 }, { page: 2, top: 1016, height: 1000 }];
  const anchor = anchorFromScroll(before, 1516); // halfway down page 2
  assert.strictEqual(anchor.page, 2);
  assert.ok(Math.abs(anchor.fraction - 0.5) < 0.001);
  const after = [{ page: 1, top: 0, height: 1400 }, { page: 2, top: 1416, height: 1400 }]; // zoomed in
  assert.strictEqual(scrollFromAnchor(after, anchor), 2116);
  assert.strictEqual(scrollFromAnchor(after, null), 0);
});

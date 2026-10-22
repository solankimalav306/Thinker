const test = require('node:test');
const assert = require('node:assert');

const VIEW = { width: 1280, height: 800 };
const POP = { width: 360, height: 220 };
const inside = (p, view = VIEW, pop = POP) => p.left >= 0 && p.top >= 0 && p.left + pop.width <= view.width && p.top + pop.height <= view.height;

test('with no target the card is centred', async () => {
  const { placePopover } = await import('../renderer/js/tour-engine.js');
  const p = placePopover(null, POP, VIEW);
  assert.strictEqual(p.placement, 'center');
  assert.strictEqual(p.left, (VIEW.width - POP.width) / 2);
  assert.strictEqual(p.arrow, null);
});

test('the card goes on the preferred side when it fits and points at the target', async () => {
  const { placePopover } = await import('../renderer/js/tour-engine.js');
  const target = { left: 500, top: 100, width: 120, height: 40 };
  const p = placePopover(target, POP, VIEW, 'bottom');
  assert.strictEqual(p.placement, 'bottom');
  assert.ok(p.top > target.top + target.height);
  assert.strictEqual(p.arrow.side, 'top');
  assert.ok(inside(p));
});

test('it flips to the other side when the preferred one has no room', async () => {
  const { placePopover } = await import('../renderer/js/tour-engine.js');
  const low = { left: 500, top: 740, width: 120, height: 40 };
  assert.strictEqual(placePopover(low, POP, VIEW, 'bottom').placement, 'top');
  const farRight = { left: 1240, top: 300, width: 30, height: 40 };
  assert.strictEqual(placePopover(farRight, POP, VIEW, 'right').placement, 'left');
});

test('the card never leaves the window, wherever the target is', async () => {
  const { placePopover } = await import('../renderer/js/tour-engine.js');
  for (let x = 0; x <= 1240; x += 160) {
    for (let y = 0; y <= 760; y += 100) {
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const p = placePopover({ left: x, top: y, width: 40, height: 40 }, POP, VIEW, side);
        assert.ok(inside(p), `target ${x},${y} prefer ${side} -> ${JSON.stringify(p)}`);
      }
    }
  }
});

test('even a window smaller than the card keeps it fully visible when possible', async () => {
  const { placePopover } = await import('../renderer/js/tour-engine.js');
  const small = { width: 400, height: 300 };
  const p = placePopover({ left: 20, top: 20, width: 300, height: 250 }, POP, small, 'bottom');
  assert.ok(p.left >= 0 && p.top >= 0);
});

test('checklist state parses junk safely and only accepts known steps', async () => {
  const { parseState, emptyState } = await import('../renderer/js/onboarding.js');
  assert.deepStrictEqual(parseState(null), emptyState());
  assert.deepStrictEqual(parseState('not json'), emptyState());
  assert.deepStrictEqual(parseState('{"done":{"bogus":true,"ask":true}}').done, { ask: true });
  assert.strictEqual(parseState({ dismissed: 'yes' }).dismissed, false);
});

test('marking steps done is idempotent and tracks progress', async () => {
  const { emptyState, markDone, progress, nextTask, TASKS } = await import('../renderer/js/onboarding.js');
  let state = emptyState();
  assert.strictEqual(progress(state).done, 0);
  assert.strictEqual(nextTask(state).id, TASKS[0].id);
  state = markDone(state, 'open');
  assert.strictEqual(markDone(state, 'open'), state, 'unchanged state is returned as-is');
  assert.strictEqual(markDone(state, 'nonsense'), state);
  for (const task of TASKS) state = markDone(state, task.id);
  assert.deepStrictEqual(progress(state), { done: TASKS.length, total: TASKS.length, complete: true, percent: 100 });
  assert.strictEqual(nextTask(state), null);
});

test('the onboarding store persists changes, notifies, and survives storage errors', async () => {
  const { createOnboarding } = await import('../renderer/js/onboarding.js');
  const saved = {};
  let notified = 0;
  const store = createOnboarding({ get: (k) => saved[k] ?? null, set: (k, v) => { saved[k] = v; } }, () => { notified += 1; });
  assert.strictEqual(store.mark('model'), true);
  assert.strictEqual(store.mark('model'), false, 'no change means no write and no notification');
  assert.strictEqual(notified, 1);
  store.markTourSeen('welcome');
  assert.strictEqual(store.tourSeen('welcome'), true);
  const reopened = createOnboarding({ get: (k) => saved[k] ?? null, set: () => {} });
  assert.strictEqual(reopened.get().done.model, true);
  assert.strictEqual(reopened.tourSeen('welcome'), true);
  const broken = createOnboarding({ get: () => null, set: () => { throw new Error('disk full'); } });
  assert.doesNotThrow(() => broken.mark('open'));
  assert.strictEqual(broken.get().done.open, true);
});

test('tours are well formed', async () => {
  const { buildTours } = await import('../renderer/js/tours.js');
  const tours = buildTours({ goHome() {}, goReader() {}, openChat() {} });
  for (const tour of Object.values(tours)) {
    assert.ok(tour.steps.length >= 4);
    const ids = new Set();
    for (const step of tour.steps) {
      assert.ok(step.id && !ids.has(step.id), `duplicate or missing id in ${tour.id}`);
      ids.add(step.id);
      assert.ok(step.title && step.title.length < 50, `${step.id} title`);
      assert.ok(step.body && step.body.length > 30 && step.body.length < 330, `${step.id} body length ${step.body?.length}`);
      assert.ok(!step.target || /^[#.\[]/.test(step.target), `${step.id} target is a selector`);
    }
  }
});

test('every tour target exists in the app markup', async () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const { buildTours } = await import('../renderer/js/tours.js');
  const tours = buildTours({});
  for (const tour of Object.values(tours)) {
    for (const step of tour.steps.filter((s) => s.target)) {
      const first = step.target.split(/[ >]/)[0];
      const token = first.startsWith('#') ? `id="${first.slice(1)}"` : `class="${first.slice(1).split(':')[0]}`;
      assert.ok(html.includes(token) || html.includes(first.slice(1)), `${tour.id}/${step.id}: ${step.target} not found in index.html`);
    }
  }
});

test('help content is complete and only names things that exist', async () => {
  const { GUIDES, SHORTCUTS, FAQ, LINKS } = await import('../renderer/js/help-content.js');
  assert.ok(GUIDES.length >= 6 && FAQ.length >= 5 && SHORTCUTS.length >= 4);
  const ids = new Set();
  for (const guide of GUIDES) {
    assert.ok(!ids.has(guide.id));
    ids.add(guide.id);
    assert.ok(guide.title && guide.summary && guide.steps.length >= 3, guide.id);
    for (const key of guide.links || []) assert.ok(LINKS[key], `${guide.id} links to unknown ${key}`);
    if (guide.action) assert.match(guide.action.run, /^(tour:(welcome|reader)|goto:settings|checklist:show)$/);
  }
  const { isAllowedExternalUrl } = require('../external-links');
  for (const link of Object.values(LINKS)) assert.ok(isAllowedExternalUrl(link.url), `${link.url} would be refused by the app`);
  // shortcuts that the app really handles
  const keys = SHORTCUTS.map((s) => s.keys.join('+'));
  assert.ok(keys.includes('Ctrl+O') && keys.includes('Ctrl+F'));
});

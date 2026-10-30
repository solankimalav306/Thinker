const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, currentVersion, MIGRATIONS } = require('../database');
const { createStore } = require('../store');
const { createWorkspaces } = require('../workspaces');
const { createArtifacts } = require('../artifacts');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-art-'));
  const store = createStore(openDatabase(dir));
  return { store, art: createArtifacts(store), ws: createWorkspaces(store) };
}

test('the artifacts table is created by the latest migration', () => {
  const { store } = fresh();
  assert.strictEqual(currentVersion(store.db), MIGRATIONS[MIGRATIONS.length - 1].version);
  assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'artifacts'").get());
});

test('saving, reading back and listing newest first', async () => {
  const { art } = fresh();
  const a = art.create({ title: '  Rules   table ', html: '<table></table>', kind: 'table', sources: [{ doc: 'Guide', page: 3 }, { doc: '' }] });
  assert.strictEqual(a.title, 'Rules table');
  assert.deepStrictEqual(a.sources, [{ doc: 'Guide', page: 3 }]);
  await new Promise((r) => setTimeout(r, 5));
  const b = art.create({ title: 'Plan', html: '<p>x</p>', kind: 'nonsense' });
  assert.strictEqual(b.kind, 'page');
  assert.deepStrictEqual(art.list().map((x) => x.id), [b.id, a.id]);
  assert.strictEqual(art.list()[0].html, undefined, 'the list does not carry the page bodies');
  assert.strictEqual(art.get(a.id).html, '<table></table>');
});

test('empty and oversized artifacts are refused', () => {
  const { art } = fresh();
  assert.throws(() => art.create({ title: 'x', html: '   ' }), /empty/);
  assert.throws(() => art.create({ title: 'x', html: 'a'.repeat(200001) }), /too large/);
});

test('search and kind filters; wildcard characters are taken literally', () => {
  const { art } = fresh();
  art.create({ title: '100% done', html: '<p>1</p>', kind: 'chart' });
  art.create({ title: 'Other', html: '<p>2</p>', kind: 'slides' });
  assert.deepStrictEqual(art.list({ search: '100%' }).map((x) => x.title), ['100% done']);
  assert.strictEqual(art.list({ search: '%' }).length, 1);
  assert.deepStrictEqual(art.list({ kind: 'slides' }).map((x) => x.title), ['Other']);
});

test('rename, link to a Thinkspace; deleting the Thinkspace keeps the artifact', () => {
  const { art, ws } = fresh();
  const space = ws.createWorkspace({ name: 'Thesis' });
  const a = art.create({ title: 'A', html: '<p>1</p>', workspaceId: space.id });
  assert.strictEqual(a.workspaceId, space.id);
  assert.strictEqual(art.update(a.id, { title: 'Renamed' }).title, 'Renamed');
  assert.strictEqual(art.update(a.id, { workspaceId: 'missing' }).workspaceId, null);
  art.update(a.id, { workspaceId: space.id });
  ws.deleteWorkspace(space.id);
  assert.strictEqual(art.get(a.id).workspaceId, null);
  assert.strictEqual(art.remove(a.id), true);
  assert.strictEqual(art.get(a.id), null);
  assert.throws(() => art.update('nope', { title: 'x' }), /no longer exists/);
});

test('an interactive artifact is kept as data with the person\'s progress', () => {
  const { art } = fresh();
  const spec = { groups: [{ title: '', items: [{ text: 'Read the brief' }, { text: 'Pick data' }] }] };
  const a = art.create({ title: 'Assignment', kind: 'checklist', spec, state: { done: { '0.0': true } } });
  assert.deepStrictEqual(a.spec, spec);
  assert.deepStrictEqual(a.state, { done: { '0.0': true } });
  assert.strictEqual(a.html, '');
  assert.strictEqual(art.list()[0].spec, undefined, 'the list does not carry the data');
  // ticking a task saves progress and leaves the order of the list alone
  const before = art.get(a.id).updatedAt;
  const saved = art.update(a.id, { state: { done: { '0.0': true, '0.1': true } } });
  assert.deepStrictEqual(saved.state.done, { '0.0': true, '0.1': true });
  assert.strictEqual(saved.updatedAt, before);
  // a state that is far too big, or not an object, is replaced by an empty one
  assert.deepStrictEqual(art.update(a.id, { state: 'nope' }).state, {});
  assert.deepStrictEqual(art.update(a.id, { state: { x: 'y'.repeat(30000) } }).state, {});
  assert.throws(() => art.create({ title: 'x', spec: {}, html: '' }), /nothing to save/);
});

test('the kinds are a short fixed list, and anything else becomes a page', () => {
  const { art } = fresh();
  for (const kind of ['quiz', 'diagram', 'flashcards', 'steps']) assert.strictEqual(art.create({ title: kind, html: '<p>x</p>', kind }).kind, kind);
  assert.strictEqual(art.create({ title: 'odd', html: '<p>x</p>', kind: 'spreadsheet' }).kind, 'page');
});

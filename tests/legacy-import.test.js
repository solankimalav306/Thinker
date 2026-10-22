const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase } = require('../database');
const { createStore } = require('../store');
const { importLegacyData } = require('../legacy-import');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-legacy-'));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const lines = (items) => items.map((e) => JSON.stringify(e)).join('\n') + '\n';

function buildLegacyUserData() {
  const userData = tmp();
  const pdfDir = tmp();
  const pdf = path.join(pdfDir, 'paper.pdf');
  fs.writeFileSync(pdf, 'legacy-doc');

  const kvDir = path.join(userData, 'local-storage-jsonl');
  fs.mkdirSync(kvDir);
  const kv = (key, ...values) => fs.writeFileSync(
    path.join(kvDir, `${encodeURIComponent(key)}.jsonl`),
    lines(values.map((value) => ({ timestamp: 1, value })))
  );
  kv('smartpdf.theme', 'dark', 'light');
  kv('smartpdf.recents', JSON.stringify([pdf]));
  kv(`pdf-annotations:${pdf}:page-1`, '{"paths":[]}');
  fs.writeFileSync(
    path.join(kvDir, `${encodeURIComponent('smartpdf.tokenUsage')}.jsonl`),
    lines([{ timestamp: 5, total: 10 }, { timestamp: 6, total: 20 }])
  );

  const chatDir = path.join(userData, 'chat-history');
  fs.mkdirSync(chatDir);
  fs.writeFileSync(
    path.join(chatDir, `${sha(pdf)}.jsonl`),
    lines([{ role: 'user', text: '', question: 'hello there', ts: 1 }, { role: 'assistant', text: 'hi', ts: 2 }])
  );
  fs.writeFileSync(path.join(chatDir, `${sha('/gone/unknown.pdf')}.jsonl`), lines([{ role: 'user', text: 'orphan', ts: 3 }]));

  fs.writeFileSync(path.join(userData, 'notes-paper.json'), JSON.stringify([{ id: 'n1', content: 'a note' }]));
  fs.writeFileSync(
    path.join(userData, `mindmaps-${sha(pdf)}.json`),
    JSON.stringify([{ id: 'm1', title: 'Map', createdAt: '2026-01-01T00:00:00.000Z' }])
  );
  fs.writeFileSync(
    path.join(userData, 'glossary.json'),
    JSON.stringify({ terms: [{ term: 'Entropy', definition: 'd' }], pdfGlossaries: {} })
  );
  return { userData, pdf, chatDir };
}

test('legacy import brings over keys, chats, notes, mind maps and glossary', () => {
  const { userData, pdf } = buildLegacyUserData();
  const store = createStore(openDatabase(userData));
  const result = importLegacyData(store, userData);
  assert.strictEqual(result.skipped, false);

  assert.strictEqual(store.getItem('smartpdf.theme'), 'light', 'last value of a key wins');
  assert.strictEqual(store.getItem(`pdf-annotations:${pdf}:page-1`), '{"paths":[]}');
  assert.strictEqual(store.readUsage().length, 2);

  const conversations = store.listConversations(pdf);
  assert.strictEqual(conversations.length, 1);
  assert.strictEqual(conversations[0].title, 'hello there');
  assert.deepStrictEqual(store.getMessages(conversations[0].id).map((m) => m.role), ['user', 'assistant']);

  assert.deepStrictEqual(store.loadNotes(pdf).map((n) => n.id), ['n1']);
  assert.strictEqual(store.listMindmaps(pdf).length, 1);
  assert.strictEqual(store.getGlossary().terms.length, 1);
});

test('a chat whose document is unknown is kept as an orphan, not dropped', () => {
  const { userData } = buildLegacyUserData();
  const store = createStore(openDatabase(userData));
  importLegacyData(store, userData);
  const orphans = store.db.prepare('SELECT COUNT(*) n FROM conversations WHERE doc_id IS NULL').get().n;
  assert.strictEqual(orphans, 1);
});

test('old files are left in place and a second import does nothing', () => {
  const { userData, pdf, chatDir } = buildLegacyUserData();
  const store = createStore(openDatabase(userData));
  importLegacyData(store, userData);
  assert.ok(fs.existsSync(path.join(userData, 'notes-paper.json')));
  assert.ok(fs.existsSync(path.join(chatDir, `${sha(pdf)}.jsonl`)));
  assert.strictEqual(importLegacyData(store, userData).skipped, true);
  assert.strictEqual(store.readUsage().length, 2);
  assert.strictEqual(store.listConversations(pdf).length, 1);
});

test('a failed import rolls back completely and can be retried', () => {
  const { userData } = buildLegacyUserData();
  const store = createStore(openDatabase(userData));
  const original = store.appendUsage;
  store.appendUsage = () => { throw new Error('disk full'); };
  assert.throws(() => importLegacyData(store, userData), /disk full/);
  assert.strictEqual(store.getItem('smartpdf.theme'), null, 'nothing half-imported');
  store.appendUsage = original;
  assert.strictEqual(importLegacyData(store, userData).skipped, false);
  assert.strictEqual(store.getItem('smartpdf.theme'), 'light');
});

test('legacy import is a no-op on a fresh install', () => {
  const dir = tmp();
  const store = createStore(openDatabase(dir));
  assert.strictEqual(importLegacyData(store, dir).empty, true);
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openDatabase, transaction, currentVersion, MIGRATIONS } = require('../database');
const { createStore } = require('../store');
const { importLegacyData } = require('../legacy-import');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-db-'));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function freshStore() {
  const dir = tmp();
  return { dir, store: createStore(openDatabase(dir)) };
}
function writePdf(dir, name, content = 'pdf-bytes') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('migrations apply once and are idempotent across reopen', () => {
  const dir = tmp();
  const db = openDatabase(dir);
  assert.strictEqual(currentVersion(db), MIGRATIONS[MIGRATIONS.length - 1].version);
  db.close();
  const again = openDatabase(dir);
  assert.strictEqual(currentVersion(again), MIGRATIONS[MIGRATIONS.length - 1].version);
});

test('nested transactions roll back only the inner failure', () => {
  const { store } = freshStore();
  transaction(store.db, () => {
    store.setItem('a', '1');
    assert.throws(() => transaction(store.db, () => { store.setItem('b', '2'); throw new Error('boom'); }), /boom/);
  });
  assert.strictEqual(store.getItem('a'), '1');
  assert.strictEqual(store.getItem('b'), null);
});

test('same file contents get the same document id wherever the file lives', () => {
  const { dir, store } = freshStore();
  const a = writePdf(dir, 'one.pdf', 'same-content');
  const b = writePdf(dir, 'copy.pdf', 'same-content');
  const c = writePdf(dir, 'other.pdf', 'different');
  assert.strictEqual(store.docIdForPath(a), store.docIdForPath(b));
  assert.notStrictEqual(store.docIdForPath(a), store.docIdForPath(c));
  assert.strictEqual(store.docIdForPath(a), sha('same-content'));
});

test('annotations follow the document when the file is moved or renamed', () => {
  const { dir, store } = freshStore();
  const before = writePdf(dir, 'before.pdf', 'content-x');
  store.setItem(`pdf-annotations:${before}:page-2`, '{"paths":[1]}');
  const after = path.join(dir, 'renamed.pdf');
  fs.renameSync(before, after);
  assert.strictEqual(store.getItem(`pdf-annotations:${after}:page-2`), '{"paths":[1]}');
});

test('highlights and annotations for the same page are separate', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'a.pdf');
  store.setItem(`pdf-annotations:${p}:page-1`, 'A');
  store.setItem(`pdf-highlights:${p}:page-1`, 'H');
  assert.strictEqual(store.getItem(`pdf-annotations:${p}:page-1`), 'A');
  assert.strictEqual(store.getItem(`pdf-highlights:${p}:page-1`), 'H');
  store.removeItem(`pdf-annotations:${p}:page-1`);
  assert.strictEqual(store.getItem(`pdf-annotations:${p}:page-1`), null);
  assert.strictEqual(store.getItem(`pdf-highlights:${p}:page-1`), 'H');
});

test('plain keys round-trip through kv and update in place', () => {
  const { store } = freshStore();
  store.setItem('smartpdf.theme', 'dark');
  store.setItem('smartpdf.theme', 'light');
  assert.strictEqual(store.getItem('smartpdf.theme'), 'light');
  assert.strictEqual(store.db.prepare('SELECT COUNT(*) n FROM kv').get().n, 1);
});

test('notes replace atomically and survive reopen', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'n.pdf');
  store.saveNotes(p, [{ id: 'a', content: 'one' }, { id: 'b', content: 'two' }]);
  store.saveNotes(p, [{ id: 'b', content: 'two' }]);
  assert.deepStrictEqual(store.loadNotes(p).map((n) => n.id), ['b']);
});

test('mind maps save, list and delete', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'm.pdf');
  const saved = store.saveMindmap(p, { title: 'Map', code: '# x' });
  assert.ok(saved.id);
  assert.strictEqual(store.listMindmaps(p).length, 1);
  store.deleteMindmap(p, saved.id);
  assert.strictEqual(store.listMindmaps(p).length, 0);
});

test('glossary terms are case-insensitive and count repeats', () => {
  const { store } = freshStore();
  store.addGlossaryTerm({ term: 'Entropy', definition: 'x' });
  store.addGlossaryTerm({ term: 'entropy', definition: 'y' });
  const { terms } = store.getGlossary();
  assert.strictEqual(terms.length, 1);
  assert.strictEqual(terms[0].frequency, 2);
});

test('conversations: create, auto-title from first question, list, cascade delete', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'c.pdf');
  const conv = store.createConversation(p);
  assert.strictEqual(conv.title, 'New chat');
  store.appendMessage(conv.id, { role: 'user', text: 'quoted', question: 'What is the scheduler?', ts: 1 });
  store.appendMessage(conv.id, { role: 'assistant', text: 'A timer tick.', citations: [1], ts: 2 });
  const messages = store.getMessages(conv.id);
  assert.deepStrictEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepStrictEqual(messages[1].citations, [1]);
  assert.strictEqual(store.listConversations(p)[0].title, 'What is the scheduler?');
  store.deleteConversation(conv.id);
  assert.strictEqual(store.getMessages(conv.id).length, 0);
});

test('conversations list pinned first and hide archived', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'p.pdf');
  const a = store.createConversation(p, { title: 'A' });
  const b = store.createConversation(p, { title: 'B' });
  store.updateConversation(a.id, { pinned: true });
  store.updateConversation(b.id, { archived: true });
  assert.deepStrictEqual(store.listConversations(p).map((c) => c.title), ['A']);
});

test('instructions are scoped and can be toggled', () => {
  const { store } = freshStore();
  const g = store.saveInstruction({ scope: 'global', title: 'Tone', body: 'Be brief.' });
  store.saveInstruction({ scope: 'document', scopeId: 'doc1', title: 'Doc', body: 'Cite pages.' });
  assert.strictEqual(store.listInstructions('global').length, 1);
  assert.strictEqual(store.listInstructions('document', 'doc1').length, 1);
  store.saveInstruction({ ...g, enabled: false });
  assert.strictEqual(store.listInstructions('global')[0].enabled, false);
});

test('settings are stored per scope and can be reset', () => {
  const { store } = freshStore();
  store.setSetting('reading.defaultZoom', 'app', '', 120);
  store.setSetting('reading.defaultZoom', 'document', 'doc1', 150);
  assert.strictEqual(store.getSettings().length, 2);
  store.resetSetting('reading.defaultZoom', 'document', 'doc1');
  assert.deepStrictEqual(store.getSettings().map((s) => s.scope), ['app']);
});


test('conversation list carries a message count and the last answer as a preview', () => {
  const { dir, store } = freshStore();
  const p = writePdf(dir, 'preview.pdf');
  const conv = store.createConversation(p);
  store.appendMessage(conv.id, { role: 'user', text: 'q1', question: 'What is it?' });
  store.appendMessage(conv.id, { role: 'assistant', text: 'It is a scheduler.' });
  store.appendMessage(conv.id, { role: 'user', text: 'q2', question: 'More?' });
  const [row] = store.listConversations(p);
  assert.strictEqual(row.messageCount, 3);
  assert.strictEqual(row.preview, 'It is a scheduler.');
});

test('a chat can be cut back to its first messages and forked from any message', () => {
  const { dir, store } = freshStore();
  const pdf = writePdf(dir, 'fork.pdf');
  const conv = store.createConversation(pdf, { title: 'Scheduler' });
  store.appendMessage(conv.id, { role: 'user', text: 'q1', question: 'What is it?' });
  store.appendMessage(conv.id, { role: 'assistant', text: 'a1', sources: [{ doc: '', page: 2 }] });
  store.appendMessage(conv.id, { role: 'user', text: 'q2', question: 'More?' });
  store.appendMessage(conv.id, { role: 'assistant', text: 'a2' });

  const fork = store.forkConversation(conv.id, 2);
  assert.notStrictEqual(fork.id, conv.id);
  assert.strictEqual(fork.docId, conv.docId);
  assert.match(fork.title, /^Fork of Scheduler/);
  const copied = store.getMessages(fork.id);
  assert.deepStrictEqual(copied.map((m) => m.text), ['q1', 'a1']);
  assert.deepStrictEqual(copied[1].sources, [{ doc: '', page: 2 }]);
  assert.strictEqual(store.getMessages(conv.id).length, 4, 'the original is untouched');
  assert.ok(store.listConversations(pdf).some((c) => c.id === fork.id));

  assert.strictEqual(store.truncateMessages(conv.id, 1), 3);
  assert.deepStrictEqual(store.getMessages(conv.id).map((m) => m.text), ['q1']);
  assert.strictEqual(store.truncateMessages(conv.id, 5), 0);
  assert.throws(() => store.forkConversation('chat-missing', 1), /no longer exists/);
});

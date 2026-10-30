const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { createCollab, connect, diffRange } = require('../collab-docs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// awareness keeps a timer running; stop them all when the tests end
const live = [];
test.after(() => live.forEach((a) => a.destroy()));

function project(files = { 'main.tex': 'Hello world\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-collab-'));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return dir;
}

// a participant: a Yjs document speaking the same messages a browser would
function client(entry, role = 'edit') {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  live.push(awareness);
  const inbox = [];
  const conn = connect(entry, { role, send: (m) => inbox.push(m) });
  const origin = {};
  const sendSync = (build) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0);
    build(e);
    conn.message(encoding.toUint8Array(e));
  };
  doc.on('update', (u, o) => { if (o !== origin) sendSync((e) => syncProtocol.writeUpdate(e, u)); });
  awareness.on('update', ({ added, updated, removed }, o) => {
    if (o === origin) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 1);
    encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(awareness, added.concat(updated, removed)));
    conn.message(encoding.toUint8Array(e));
  });
  const pump = () => {
    while (inbox.length) {
      const dec = decoding.createDecoder(inbox.shift());
      const type = decoding.readVarUint(dec);
      if (type === 0) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, 0);
        syncProtocol.readSyncMessage(dec, reply, doc, origin);
        if (encoding.length(reply) > 1) conn.message(encoding.toUint8Array(reply));
      } else if (type === 1) awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), origin);
    }
  };
  // the client also starts with its own step 1, as a real provider does
  sendSync((e) => syncProtocol.writeSyncStep1(e, doc));
  pump();
  return { doc, text: doc.getText('content'), awareness, conn, pump, inbox };
}
const settle = (...clients) => { for (let i = 0; i < 4; i += 1) clients.forEach((c) => c.pump()); };

test('only existing text files inside the project can be opened', () => {
  const dir = project({ 'main.tex': 'a', 'sections/intro.tex': 'b', '.secret.tex': 'x', 'image.png': 'png', 'big.tex': 'z'.repeat(1000001) });
  const collab = createCollab({ root: dir, watch: false });
  try {
    for (const bad of ['../main.tex', '/etc/passwd', 'C:\\Windows\\win.ini', 'nope.tex', 'image.png', '.secret.tex', 'sections/../../x.tex', '', null, 'a\0.tex', 'big.tex', 'sections']) {
      assert.throws(() => collab.open(bad), undefined, String(bad));
    }
    assert.strictEqual(collab.open('sections/intro.tex').ytext.toString(), 'b');
    assert.strictEqual(collab.open('main.tex').ytext.toString(), 'a');
  } finally { collab.destroy(); }
});

test('a link that points outside the project is refused', (t) => {
  const outside = project({ 'private.tex': 'secret' });
  const dir = project();
  try { fs.symlinkSync(path.join(outside, 'private.tex'), path.join(dir, 'leak.tex')); } catch { t.skip('links are not allowed here'); return; }
  const collab = createCollab({ root: dir, watch: false });
  try {
    assert.throws(() => collab.open('leak.tex'));
    assert.ok(!collab.listFiles().includes('leak.tex'));
  } finally { collab.destroy(); }
});

test('the file list shows text files only and skips hidden and build folders', () => {
  const dir = project({ 'main.tex': 'a', 'refs.bib': 'b', 'logo.png': 'p', '.git/config.tex': 'g', 'build/out.tex': 'o', 'chapters/one.tex': 'c', 'notes.txt': 'n' });
  const collab = createCollab({ root: dir, watch: false });
  try {
    assert.deepStrictEqual(collab.listFiles().sort(), ['chapters/one.tex', 'main.tex', 'notes.txt', 'refs.bib']);
  } finally { collab.destroy(); }
});

test('two editors converge, and the result reaches the file on disk', async () => {
  const dir = project();
  const collab = createCollab({ root: dir, writeDelay: 30, watch: false });
  try {
    const entry = collab.open('main.tex');
    const a = client(entry);
    const b = client(entry);
    settle(a, b);
    assert.strictEqual(a.text.toString(), 'Hello world\n');
    a.text.insert(0, 'A: ');
    settle(a, b);
    b.text.insert(b.text.length, 'B: end\n');
    settle(a, b);
    assert.strictEqual(a.text.toString(), 'A: Hello world\nB: end\n');
    assert.strictEqual(b.text.toString(), a.text.toString());
    await sleep(120);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8'), 'A: Hello world\nB: end\n');
  } finally { collab.destroy(); }
});

test('edits made at the same moment are both kept', () => {
  const dir = project({ 'main.tex': 'one two three' });
  const collab = createCollab({ root: dir, watch: false });
  try {
    const entry = collab.open('main.tex');
    const a = client(entry);
    const b = client(entry);
    settle(a, b);
    // neither has seen the other's change yet
    a.text.insert(0, 'AAA ');
    b.text.insert(b.text.length, ' BBB');
    b.text.delete(4, 4);
    settle(a, b);
    assert.strictEqual(a.text.toString(), b.text.toString());
    assert.ok(a.text.toString().includes('AAA'));
    assert.ok(a.text.toString().includes('BBB'));
    assert.ok(!a.text.toString().includes('two '));
  } finally { collab.destroy(); }
});

test('a viewer sees edits but cannot make any', () => {
  const dir = project();
  const collab = createCollab({ root: dir, watch: false });
  try {
    const entry = collab.open('main.tex');
    const editor = client(entry, 'edit');
    const viewer = client(entry, 'view');
    settle(editor, viewer);
    editor.text.insert(0, 'X');
    settle(editor, viewer);
    assert.strictEqual(viewer.text.toString(), 'Xello world\n'.replace('Xello', 'XHello'));
    viewer.text.insert(0, 'HACK');
    settle(editor, viewer);
    assert.strictEqual(entry.ytext.toString(), 'XHello world\n');
    assert.strictEqual(editor.text.toString(), 'XHello world\n');
  } finally { collab.destroy(); }
});

test('who is where is shared, and removed when someone leaves', () => {
  const dir = project();
  const collab = createCollab({ root: dir, watch: false });
  try {
    const entry = collab.open('main.tex');
    const a = client(entry);
    const b = client(entry);
    settle(a, b);
    a.awareness.setLocalState({ user: { name: 'Ana', color: '#f00' } });
    settle(a, b);
    assert.strictEqual([...b.awareness.getStates().values()].some((s) => s.user?.name === 'Ana'), true);
    a.conn.close();
    settle(b);
    assert.strictEqual([...b.awareness.getStates().values()].some((s) => s.user?.name === 'Ana'), false);
  } finally { collab.destroy(); }
});

test('broken and oversized messages from a guest are ignored', () => {
  const dir = project();
  const collab = createCollab({ root: dir, watch: false });
  try {
    const entry = collab.open('main.tex');
    const a = client(entry);
    for (const junk of [new Uint8Array([]), new Uint8Array([9, 9, 9]), new Uint8Array([0, 9, 200, 200]), new Uint8Array(3 * 1024 * 1024), new Uint8Array([1, 255, 255, 255, 255, 15])]) {
      assert.doesNotThrow(() => a.conn.message(junk));
    }
    a.text.insert(0, 'still works ');
    settle(a);
    assert.ok(entry.ytext.toString().startsWith('still works'));
  } finally { collab.destroy(); }
});

test('a change made outside Thinker is folded into the shared copy', async () => {
  const dir = project({ 'main.tex': 'line one\nline two\n' });
  const collab = createCollab({ root: dir, watch: true });
  try {
    const entry = collab.open('main.tex');
    const a = client(entry);
    settle(a);
    fs.writeFileSync(path.join(dir, 'main.tex'), 'line one\nline TWO\nline three\n');
    await sleep(700);
    settle(a);
    assert.strictEqual(entry.ytext.toString(), 'line one\nline TWO\nline three\n');
    assert.strictEqual(a.text.toString(), entry.ytext.toString());
  } finally { collab.destroy(); }
});

test('closing the last user saves and releases the file', async () => {
  const dir = project();
  const collab = createCollab({ root: dir, writeDelay: 5000, watch: false });
  const entry = collab.open('main.tex');
  entry.ytext.insert(0, 'unsaved ');
  collab.release(entry);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8'), 'unsaved Hello world\n');
  assert.strictEqual(collab.openCount, 0);
  collab.destroy();
});

test('the smallest edit between two texts is found', () => {
  assert.deepStrictEqual(diffRange('abcdef', 'abXdef'), { index: 2, remove: 1, insert: 'X' });
  assert.deepStrictEqual(diffRange('abc', 'abc'), { index: 3, remove: 0, insert: '' });
  assert.deepStrictEqual(diffRange('', 'new'), { index: 0, remove: 0, insert: 'new' });
  assert.deepStrictEqual(diffRange('gone', ''), { index: 0, remove: 4, insert: '' });
});

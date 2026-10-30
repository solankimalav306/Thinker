const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { createRemoteServer } = require('../remote-server');
const { createCollab } = require('../collab-docs');

const APP = path.join(__dirname, '..');

const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });
const auth = (url, pin) => fetch(`${url}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const until = async (fn, ms = 2500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return false;
};

async function editable({ compile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-edit-'));
  fs.writeFileSync(path.join(dir, 'main.tex'), 'Hello\n');
  fs.writeFileSync(path.join(dir, 'refs.bib'), '@book{a}\n');
  const server = createRemoteServer({ appRoot: APP });
  const { port } = await server.start({ bindHost: '127.0.0.1' });
  const collab = createCollab({ root: dir, writeDelay: 30, watch: false });
  const provider = {
    content: async () => ({ type: 'pdf', file: path.join(dir, 'none.pdf') }),
    compile: compile || (async () => ({ ok: true, problems: [] }))
  };
  const share = server.createShare({ kind: 'tex', title: 'Paper', ref: 'p1', provider, collab, allowEdit: true });
  return { dir, server, port, share, url: `http://127.0.0.1:${port}/s/${share.token}` };
}

// a guest's editor: a Yjs document over a real WebSocket, speaking what the guest page speaks
function guestEditor(port, token, cookie, file, { origin } = {}) {
  const headers = { cookie };
  if (origin) headers.origin = origin;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/s/${token}/ws/doc?file=${encodeURIComponent(file)}`, { headers });
  const doc = new Y.Doc();
  const text = doc.getText('content');
  const marker = {};
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('unexpected-response', (_q, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode })));
  });
  ws.on('message', (data) => {
    const dec = decoding.createDecoder(new Uint8Array(data));
    if (decoding.readVarUint(dec) !== 0) return;
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, 0);
    syncProtocol.readSyncMessage(dec, reply, doc, marker);
    if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply));
  });
  doc.on('update', (u, o) => {
    if (o === marker || ws.readyState !== 1) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0);
    syncProtocol.writeUpdate(e, u);
    ws.send(encoding.toUint8Array(e));
  });
  opened.then(() => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0);
    syncProtocol.writeSyncStep1(e, doc);
    ws.send(encoding.toUint8Array(e));
  }).catch(() => {});
  return { ws, doc, text, opened, close: () => ws.close() };
}

test('the edit code and the view code give different roles; a share without editing has no edit code', async () => {
  const { server, url, share } = await editable();
  try {
    assert.match(share.editPin, /^\d{6}$/);
    assert.notStrictEqual(share.editPin, share.pin);
    const viewer = await auth(url, share.pin);
    const editor = await auth(url, share.editPin);
    assert.strictEqual((await viewer.json()).role, 'view');
    assert.strictEqual((await editor.json()).role, 'edit');
    const info = await (await get(`${url}/api/info`, { cookie: cookieFrom(editor) })).json();
    assert.strictEqual(info.canEdit, true);
    assert.strictEqual(info.live, true);
  } finally { await server.stop(); }

  const server2 = createRemoteServer({ appRoot: APP });
  const { port } = await server2.start({ bindHost: '127.0.0.1' });
  const plain = server2.createShare({ kind: 'tex', title: 'x', provider: { content: async () => ({}) }, collab: createCollab({ root: os.tmpdir(), watch: false }), allowEdit: false });
  const url2 = `http://127.0.0.1:${port}/s/${plain.token}`;
  try {
    assert.strictEqual(plain.editPin, null);
    const info = await (await get(`${url2}/api/info`, { cookie: cookieFrom(await auth(url2, plain.pin)) })).json();
    assert.strictEqual(info.canEdit, false);
    assert.strictEqual((await auth(url2, '000000')).status, 401);
  } finally { await server2.stop(); }
});

test('guests can list the project text files but cannot open anything else', async () => {
  const { server, url, share, port, dir } = await editable();
  fs.writeFileSync(path.join(dir, 'logo.png'), 'x');
  try {
    const cookie = cookieFrom(await auth(url, share.editPin));
    const list = await (await get(`${url}/api/files`, { cookie })).json();
    assert.deepStrictEqual(list.files.sort(), ['main.tex', 'refs.bib']);
    for (const bad of ['../x.tex', 'logo.png', 'nope.tex', '/etc/passwd', '']) {
      await assert.rejects(guestEditor(port, share.token, cookie, bad).opened, undefined, bad);
    }
  } finally { await server.stop(); }
});

test('a live connection needs a session and an origin that is this server', async () => {
  const { server, share, port, url } = await editable();
  try {
    await assert.rejects(guestEditor(port, share.token, '', 'main.tex').opened, (e) => e.status === 401);
    const cookie = cookieFrom(await auth(url, share.editPin));
    await assert.rejects(guestEditor(port, share.token, cookie, 'main.tex', { origin: 'http://evil.example' }).opened, (e) => e.status === 403);
    const ok = guestEditor(port, share.token, cookie, 'main.tex', { origin: `http://127.0.0.1:${port}` });
    await ok.opened;
    ok.close();
  } finally { await server.stop(); }
});

test('two guests edit together and the project file follows', async () => {
  const { server, share, port, url, dir } = await editable();
  try {
    const a = guestEditor(port, share.token, cookieFrom(await auth(url, share.editPin)), 'main.tex');
    const b = guestEditor(port, share.token, cookieFrom(await auth(url, share.editPin)), 'main.tex');
    await Promise.all([a.opened, b.opened]);
    assert.ok(await until(() => a.text.toString() === 'Hello\n' && b.text.toString() === 'Hello\n'));
    a.text.insert(0, 'From A. ');
    assert.ok(await until(() => b.text.toString() === 'From A. Hello\n'));
    b.text.insert(b.text.length, 'From B.\n');
    assert.ok(await until(() => a.text.toString() === 'From A. Hello\nFrom B.\n'));
    assert.ok(await until(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8') === 'From A. Hello\nFrom B.\n'));
    a.close();
    b.close();
  } finally { await server.stop(); }
});

test('a view-only guest watches the text change but cannot change it', async () => {
  const { server, share, port, url, dir } = await editable();
  try {
    const viewer = guestEditor(port, share.token, cookieFrom(await auth(url, share.pin)), 'main.tex');
    const editor = guestEditor(port, share.token, cookieFrom(await auth(url, share.editPin)), 'main.tex');
    await Promise.all([viewer.opened, editor.opened]);
    assert.ok(await until(() => viewer.text.toString() === 'Hello\n' && editor.text.toString() === 'Hello\n'));
    editor.text.insert(0, '1 ');
    assert.ok(await until(() => viewer.text.toString() === '1 Hello\n'));
    viewer.text.insert(0, 'HACK ');
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(editor.text.toString(), '1 Hello\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8'), '1 Hello\n');
    viewer.close();
    editor.close();
  } finally { await server.stop(); }
});

test('only an editor can ask for a build, and builds are not run back to back', async () => {
  let runs = 0;
  const { server, share, url } = await editable({
    compile: async () => { runs += 1; return { ok: true, problems: [{ severity: 'warning', file: 'main.tex', line: 3, message: 'Overfull box' }] }; }
  });
  try {
    const viewer = cookieFrom(await auth(url, share.pin));
    const editor = cookieFrom(await auth(url, share.editPin));
    assert.strictEqual((await fetch(`${url}/api/compile`, { method: 'POST', headers: { cookie: viewer } })).status, 403);
    const built = await fetch(`${url}/api/compile`, { method: 'POST', headers: { cookie: editor } });
    assert.strictEqual(built.status, 200);
    assert.strictEqual((await built.json()).problems[0].line, 3);
    assert.strictEqual((await fetch(`${url}/api/compile`, { method: 'POST', headers: { cookie: editor } })).status, 429);
    assert.strictEqual(runs, 1);
  } finally { await server.stop(); }
});

test('stopping the share saves the work and closes every live connection', async () => {
  const { server, share, port, url, dir } = await editable();
  try {
    const a = guestEditor(port, share.token, cookieFrom(await auth(url, share.editPin)), 'main.tex');
    await a.opened;
    assert.ok(await until(() => a.text.toString() === 'Hello\n'));
    const closed = new Promise((resolve) => a.ws.on('close', resolve));
    a.text.insert(0, 'kept ');
    assert.ok(await until(() => server.listShares()[0].editors === 1));
    await new Promise((r) => setTimeout(r, 100));
    server.endShare(share.id);
    await closed;
    assert.strictEqual(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8'), 'kept Hello\n');
  } finally { await server.stop(); }
});

test('a guest can sign out and come back with the other code', async () => {
  const { server, share, url } = await editable();
  try {
    const edit = cookieFrom(await auth(url, share.editPin));
    assert.strictEqual((await get(`${url}/api/info`, { cookie: edit })).status, 200);
    const out = await fetch(`${url}/logout`, { method: 'POST', headers: { cookie: edit } });
    assert.strictEqual(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.strictEqual((await get(`${url}/api/info`, { cookie: edit })).status, 401, 'the old session is gone on the server too');
    const view = await (await get(`${url}/api/info`, { cookie: cookieFrom(await auth(url, share.pin)) })).json();
    assert.strictEqual(view.canEdit, false);
  } finally { await server.stop(); }
});

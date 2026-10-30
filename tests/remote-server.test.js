const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createRemoteServer } = require('../remote-server');

const APP = path.join(__dirname, '..');

async function started(extra = {}) {
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const server = createRemoteServer({ appRoot: APP, now: clock.now, ...extra });
  const { port } = await server.start({ bindHost: '127.0.0.1', bindPort: 0 });
  const share = server.createShare({ kind: 'artifact', title: 'Rules', ref: 'a1', provider: { content: async () => ({ type: 'html', html: '<p>secret page</p><script>alert(1)</script>' }) } });
  const base = `http://127.0.0.1:${port}`;
  return { server, port, share, base, clock, url: `${base}/s/${share.token}` };
}

const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });
const auth = (url, pin) => fetch(`${url}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

test('a guest needs the right code before anything is shown', async () => {
  const { server, url, share } = await started();
  try {
    assert.strictEqual((await get(`${url}/api/info`)).status, 401);
    assert.strictEqual((await get(`${url}/api/content`)).status, 401);
    const wrong = await auth(url, '000000' === share.pin ? '111111' : '000000');
    assert.strictEqual(wrong.status, 401);
    const ok = await auth(url, share.pin);
    assert.strictEqual(ok.status, 200);
    const cookie = cookieFrom(ok);
    assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
    assert.match(ok.headers.get('set-cookie'), /SameSite=Strict/);
    const info = await (await get(`${url}/api/info`, { cookie })).json();
    assert.strictEqual(info.title, 'Rules');
    assert.strictEqual(info.kind, 'artifact');
    const content = await (await get(`${url}/api/content`, { cookie })).json();
    assert.strictEqual(content.type, 'html');
  } finally { await server.stop(); }
});

test('the bare link redirects so the page can find its files', async () => {
  const { server, url, share } = await started();
  try {
    const res = await get(url);
    assert.strictEqual(res.status, 308);
    assert.strictEqual(res.headers.get('location'), `/s/${share.token}/`);
    const page = await get(`${url}/`);
    assert.strictEqual(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /Enter the code/);
  } finally { await server.stop(); }
});

test('a wrong token, a made-up path and everything outside the share are refused alike', async () => {
  const { server, base, url } = await started();
  try {
    for (const p of ['/', '/s', '/s/nope/', '/s/nope/api/info', '/etc/passwd', `/s/../package.json`]) {
      assert.strictEqual((await get(`${base}${p}`)).status, 404, p);
    }
    for (const p of ['/frame/../../package.json', '/frame/%2e%2e/package.json', '/frame/main.js', '/guest.js/../../main.js', '/..%2fmain.js']) {
      const res = await get(`${url}${p}`);
      assert.ok([404, 401].includes(res.status), `${p} -> ${res.status}`);
    }
  } finally { await server.stop(); }
});

test('five wrong codes from one address lock that address out, and 25 lock the share', async () => {
  const { server, url, share } = await started();
  try {
    const wrong = share.pin === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await auth(url, wrong)).status, 401);
    assert.strictEqual((await auth(url, wrong)).status, 429);
    assert.strictEqual((await auth(url, share.pin)).status, 429, 'even the right code waits');
  } finally { await server.stop(); }
});

test('twenty-five wrong codes in all lock the share for good, even for the right code', async () => {
  const { server, url, share, clock } = await started();
  try {
    const wrong = share.pin === '123456' ? '654321' : '123456';
    for (let batch = 0; batch < 5; batch += 1) {
      for (let i = 0; i < 5; i += 1) await auth(url, wrong);
      clock.advance(11 * 60 * 1000);
    }
    const res = await auth(url, share.pin);
    assert.strictEqual(res.status, 423);
    assert.strictEqual(server.listShares()[0].locked, true);
  } finally { await server.stop(); }
});

test('the wait ends after ten minutes', async () => {
  const { server, url, share, clock } = await started();
  try {
    const wrong = share.pin === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) await auth(url, wrong);
    assert.strictEqual((await auth(url, share.pin)).status, 429);
    clock.advance(11 * 60 * 1000);
    assert.strictEqual((await auth(url, share.pin)).status, 200);
  } finally { await server.stop(); }
});

test('codes must be six digits; odd input is just wrong', async () => {
  const { server, url } = await started();
  try {
    const junk = await fetch(`${url}/auth`, { method: 'POST', body: 'not json' });
    assert.strictEqual(junk.status, 400);
    const huge = await fetch(`${url}/auth`, { method: 'POST', body: 'x'.repeat(5000) }).catch(() => ({ status: 0 }));
    assert.ok(huge.status === 0 || huge.status >= 400);
    for (const bad of ['', 'abcdef', '12345', '1234567', null]) assert.strictEqual((await auth(url, bad)).status, 401);
  } finally { await server.stop(); }
});

test('a session works for its own share only', async () => {
  const { server, share, base } = await started();
  const other = server.createShare({ kind: 'artifact', title: 'Other', provider: { content: async () => ({ type: 'html', html: '<p>other</p>' }) } });
  try {
    const cookie = cookieFrom(await auth(`${base}/s/${share.token}`, share.pin));
    assert.strictEqual((await get(`${base}/s/${other.token}/api/info`, { cookie })).status, 401);
  } finally { await server.stop(); }
});

test('guests are shown only the frame files, with the sealed-frame policy', async () => {
  const { server, url } = await started();
  try {
    const frame = await get(`${url}/frame/artifact-frame.html`);
    assert.strictEqual(frame.status, 200);
    const csp = frame.headers.get('content-security-policy');
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /frame-src 'none'/);
    const text = await frame.text();
    assert.ok(!text.includes('thinker-artifact:'), 'the frame page points at this server, not the app protocol');
    assert.strictEqual((await get(`${url}/frame/artifact-bridge.js`)).status, 200);
    assert.strictEqual((await get(`${url}/frame/purify.min.js`)).status, 200);
    assert.strictEqual((await get(`${url}/frame/index.js`)).status, 404);
  } finally { await server.stop(); }
});

test('ending a share stops its link, its sessions and its watchers at once', async () => {
  const { server, url, share } = await started();
  try {
    const cookie = cookieFrom(await auth(url, share.pin));
    assert.strictEqual((await get(`${url}/api/info`, { cookie })).status, 200);
    assert.strictEqual(server.endShare(share.id), true);
    assert.strictEqual((await get(`${url}/api/info`, { cookie })).status, 404);
    assert.strictEqual(server.endShare(share.id), false);
  } finally { await server.stop(); }
});

test('a share expires', async () => {
  const { server, url, share, clock } = await started();
  try {
    const cookie = cookieFrom(await auth(url, share.pin));
    clock.advance(5 * 60 * 60 * 1000);
    assert.strictEqual((await get(`${url}/api/info`, { cookie })).status, 404);
  } finally { await server.stop(); }
});

test('open pages hear about changes, and stopping sharing tells them', async () => {
  const { server, port, url, share } = await started();
  try {
    const cookie = cookieFrom(await auth(url, share.pin));
    const seen = [];
    const done = new Promise((resolve) => {
      const req = http.get(`${url}/api/events`, { headers: { cookie } }, (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        res.setEncoding('utf8');
        res.on('data', (chunk) => { seen.push(chunk); if (/event: ended/.test(chunk)) resolve(); });
      });
      req.on('error', () => resolve());
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(server.listShares()[0].guests, 1);
    server.bumpRef('artifact', 'a1');
    await new Promise((r) => setTimeout(r, 100));
    server.endShare(share.id);
    await done;
    const all = seen.join('');
    assert.match(all, /event: version\ndata: 1/);
    assert.match(all, /event: version\ndata: 2/);
    assert.match(all, /event: ended/);
    assert.ok(port > 0);
  } finally { await server.stop(); }
});

test('a project share serves its built PDF and nothing from the project folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-remote-'));
  const pdf = path.join(dir, 'main.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4 shared');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'private');
  const server = createRemoteServer({ appRoot: APP });
  const { port } = await server.start({ bindHost: '127.0.0.1' });
  const share = server.createShare({ kind: 'tex', title: 'Paper', ref: 'p1', provider: { content: async () => ({ type: 'pdf', file: pdf }) } });
  const url = `http://127.0.0.1:${port}/s/${share.token}`;
  try {
    const cookie = cookieFrom(await auth(url, share.pin));
    const res = await get(`${url}/api/content`, { cookie });
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(await res.text(), '%PDF-1.4 shared');
    assert.strictEqual((await get(`${url}/secret.txt`, { cookie })).status, 404);
    assert.strictEqual((await get(`${url}/api/file?name=secret.txt`, { cookie })).status, 404);
  } finally { await server.stop(); }
});

test('a project that has not been built says so instead of failing', async () => {
  const server = createRemoteServer({ appRoot: APP });
  const { port } = await server.start({ bindHost: '127.0.0.1' });
  const share = server.createShare({ kind: 'tex', title: 'Paper', provider: { content: async () => ({ type: 'pdf', file: path.join(os.tmpdir(), 'does-not-exist.pdf') }) } });
  const url = `http://127.0.0.1:${port}/s/${share.token}`;
  try {
    const cookie = cookieFrom(await auth(url, share.pin));
    assert.strictEqual((await get(`${url}/api/content`, { cookie })).status, 404);
  } finally { await server.stop(); }
});

test('the server stops listening when it is stopped, and tokens are long and unique', async () => {
  const { server, port } = await started();
  const a = server.createShare({ kind: 'artifact', title: 'a', provider: { content: async () => ({}) } });
  const b = server.createShare({ kind: 'artifact', title: 'b', provider: { content: async () => ({}) } });
  assert.notStrictEqual(a.token, b.token);
  assert.ok(a.token.length >= 30);
  assert.match(a.pin, /^\d{6}$/);
  await server.stop();
  assert.strictEqual(server.running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});

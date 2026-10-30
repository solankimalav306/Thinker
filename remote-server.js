// Thinker Remote: share one artifact or one LaTeX project with people on the same network.
//
// What a guest can reach, and nothing else:
//   - a share is an unguessable link plus a 6-digit code the host reads out; both are needed
//   - a guest sees only that one thing, read-only; there is no way to list or open anything else
//   - the server is off until the host starts sharing, and stops when the last share ends
//   - artifacts are shown in the same sealed frame the app uses (sandboxed, no network, cleaned again)
// The connection is plain HTTP on the local network; the page tells the host so.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const WEB = {
  '/guest.html': { file: ['remote-web', 'guest.html'], type: 'text/html; charset=utf-8' },
  '/guest.js': { file: ['remote-web', 'guest.js'], type: 'text/javascript; charset=utf-8' },
  '/guest.css': { file: ['remote-web', 'guest.css'], type: 'text/css; charset=utf-8' },
  '/kit.css': { file: ['renderer', 'css', 'artifact-kit.css'], type: 'text/css; charset=utf-8' }
};
const FRAME = {
  '/artifact-frame.html': { file: ['renderer', 'artifact-frame.html'], type: 'text/html; charset=utf-8', rewrite: true },
  '/artifact-bridge.js': { file: ['renderer', 'js', 'artifact-bridge.js'], type: 'text/javascript; charset=utf-8' },
  '/purify.min.js': { file: ['renderer', 'vendor', 'dompurify', 'purify.min.js'], type: 'text/javascript; charset=utf-8' }
};

const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const FRAME_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

const MAX_BODY = 1024;
const SESSION_MS = 8 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const IP_FAILS = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;
const SHARE_FAILS = 25;

const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createRemoteServer({ appRoot, now = () => Date.now() } = {}) {
  const events = new EventEmitter();
  const shares = new Map();      // id -> share
  const byToken = new Map();     // token -> share
  const sessions = new Map();    // session id -> { shareId, expires }
  const failures = new Map();    // ip -> { count, since }
  let server = null;
  let port = 0;
  let host = '127.0.0.1';
  let sweeper = null;

  const notify = () => events.emit('change');
  const read = (parts) => fs.promises.readFile(path.join(appRoot, ...parts));

  // ---- shares -------------------------------------------------------------------------------------
  function createShare({ kind, title, ref, provider, ttlMs = DEFAULT_TTL_MS }) {
    if (!['artifact', 'tex'].includes(kind)) throw new Error('That cannot be shared.');
    if (!provider || typeof provider.content !== 'function') throw new Error('Nothing to share.');
    const share = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(24).toString('base64url'),
      pin: String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
      kind, title: String(title || 'Shared').slice(0, 120), ref: ref ?? null, provider,
      version: 1, createdAt: now(), expiresAt: now() + Math.max(60 * 1000, Math.min(ttlMs, 24 * 60 * 60 * 1000)),
      failed: 0, locked: false, watchers: new Set()
    };
    shares.set(share.id, share);
    byToken.set(share.token, share);
    notify();
    return { id: share.id, token: share.token, pin: share.pin, expiresAt: share.expiresAt };
  }

  function endShare(id) {
    const share = shares.get(String(id));
    if (!share) return false;
    for (const res of share.watchers) { try { res.write('event: ended\ndata: 1\n\n'); res.end(); } catch { /* gone */ } }
    shares.delete(share.id);
    byToken.delete(share.token);
    for (const [sid, s] of sessions) if (s.shareId === share.id) sessions.delete(sid);
    notify();
    return true;
  }

  function listShares() {
    return [...shares.values()].map((s) => ({
      id: s.id, kind: s.kind, title: s.title, ref: s.ref, token: s.token, pin: s.pin,
      expiresAt: s.expiresAt, guests: s.watchers.size, locked: s.locked
    }));
  }

  // the shared thing changed (an artifact edited, a project rebuilt): tell every open guest page
  function bump(id) {
    const share = shares.get(String(id));
    if (!share) return;
    share.version += 1;
    for (const res of share.watchers) { try { res.write(`event: version\ndata: ${share.version}\n\n`); } catch { /* gone */ } }
  }
  const bumpRef = (kind, ref) => { for (const s of shares.values()) if (s.kind === kind && s.ref === ref) bump(s.id); };

  function sweep() {
    const t = now();
    for (const s of [...shares.values()]) if (s.expiresAt <= t) endShare(s.id);
    for (const [sid, s] of sessions) if (s.expires <= t) sessions.delete(sid);
    for (const [ip, f] of failures) if (t - f.since > IP_WINDOW_MS) failures.delete(ip);
    if (!shares.size && server) stop();
  }

  // ---- http ---------------------------------------------------------------------------------------
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...SECURITY, ...headers });
    res.end(body);
  };
  const notFound = (res) => send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
  const json = (res, status, value, headers = {}) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', ...headers });

  function cookieOf(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const at = part.indexOf('=');
      if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
    }
    return '';
  }

  const sessionFor = (req, share) => {
    const s = sessions.get(cookieOf(req, 'tr_session'));
    return s && s.shareId === share.id && s.expires > now() ? s : null;
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function authenticate(req, res, share) {
    const ip = req.socket.remoteAddress || '?';
    const rec = failures.get(ip);
    if (rec && now() - rec.since > IP_WINDOW_MS) failures.delete(ip);
    const current = failures.get(ip);
    if (current && current.count >= IP_FAILS) return json(res, 429, { error: 'Too many wrong codes. Try again in a few minutes.' });
    if (share.locked) return json(res, 423, { error: 'This share is locked. Ask the host to start a new one.' });
    let pin = '';
    try { pin = String(JSON.parse(await readBody(req)).pin ?? '').trim(); } catch { return json(res, 400, { error: 'Bad request.' }); }
    if (!/^\d{6}$/.test(pin) || !sameText(pin, share.pin)) {
      const f = failures.get(ip) || { count: 0, since: now() };
      f.count += 1;
      failures.set(ip, f);
      share.failed += 1;
      if (share.failed >= SHARE_FAILS) { share.locked = true; notify(); }
      return json(res, 401, { error: 'That code is not right.' });
    }
    failures.delete(ip);
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { shareId: share.id, expires: Math.min(now() + SESSION_MS, share.expiresAt) });
    return json(res, 200, { ok: true }, { 'set-cookie': `tr_session=${sid}; Path=/s/${share.token}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS / 1000)}` });
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return notFound(res); }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 's' || parts.length < 2) return notFound(res);
    const share = byToken.get(parts[1]);
    if (!share || share.expiresAt <= now()) return notFound(res);
    if (parts.length === 2 && !url.pathname.endsWith('/')) return send(res, 308, '', { location: `/s/${share.token}/` });
    const rest = `/${parts.slice(2).join('/')}`;

    if (req.method === 'GET' && rest === '/') {
      const body = await read(WEB['/guest.html'].file).catch(() => null);
      return body ? send(res, 200, body, { 'content-type': WEB['/guest.html'].type, 'content-security-policy': PAGE_CSP }) : notFound(res);
    }
    if (req.method === 'GET' && (rest === '/guest.js' || rest === '/guest.css' || rest === '/kit.css')) {
      const entry = WEB[rest];
      const body = await read(entry.file).catch(() => null);
      return body ? send(res, 200, body, { 'content-type': entry.type, 'content-security-policy': PAGE_CSP }) : notFound(res);
    }
    if (req.method === 'GET' && rest.startsWith('/frame/')) {
      const entry = FRAME[`/${rest.slice(7)}`];
      if (!entry) return notFound(res);
      let body = await read(entry.file).catch(() => null);
      if (!body) return notFound(res);
      if (entry.rewrite) body = Buffer.from(body.toString('utf8').replace(/script-src thinker-artifact:/g, "script-src 'self'"));
      return send(res, 200, body, { 'content-type': entry.type, 'content-security-policy': FRAME_CSP });
    }
    if (req.method === 'POST' && rest === '/auth') return authenticate(req, res, share);

    const session = sessionFor(req, share);
    if (!session) return json(res, 401, { error: 'Enter the code first.' });

    if (req.method === 'GET' && rest === '/api/info') return json(res, 200, { kind: share.kind, title: share.title, version: share.version, expiresAt: share.expiresAt });
    if (req.method === 'GET' && rest === '/api/content') {
      let content;
      try { content = await share.provider.content(); } catch { return json(res, 502, { error: 'That could not be loaded right now.' }); }
      if (content?.type === 'html') return json(res, 200, { type: 'html', html: String(content.html || ''), version: share.version });
      if (content?.type === 'pdf' && content.file) {
        let data;
        try { data = await fs.promises.readFile(content.file); } catch { return json(res, 404, { error: 'Nothing has been built yet.' }); }
        return send(res, 200, data, { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="shared.pdf"', 'content-security-policy': "default-src 'none'; frame-ancestors 'self'" });
      }
      return json(res, 404, { error: 'Nothing to show yet.' });
    }
    if (req.method === 'GET' && rest === '/api/events') {
      res.writeHead(200, { ...SECURITY, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
      res.write(`event: version\ndata: ${share.version}\n\n`);
      share.watchers.add(res);
      notify();
      const beat = setInterval(() => { try { res.write(': \n\n'); } catch { /* gone */ } }, 25000);
      beat.unref?.();
      req.on('close', () => { clearInterval(beat); share.watchers.delete(res); notify(); });
      return undefined;
    }
    return notFound(res);
  }

  // ---- lifecycle ----------------------------------------------------------------------------------
  function start({ bindHost = '0.0.0.0', bindPort = 0 } = {}) {
    if (server) return Promise.resolve({ port, host });
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, 'Error', { 'content-type': 'text/plain' }); } catch { /* closed */ } }); });
      s.once('error', reject);
      s.listen(bindPort, bindHost, () => {
        server = s; port = s.address().port; host = bindHost;
        sweeper = setInterval(sweep, 15000);
        sweeper.unref?.();
        notify();
        resolve({ port, host });
      });
    });
  }

  function stop() {
    for (const id of [...shares.keys()]) endShare(id);
    sessions.clear();
    clearInterval(sweeper);
    sweeper = null;
    const s = server;
    server = null;
    notify();
    return new Promise((resolve) => {
      if (!s) return resolve();
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  }

  return {
    events, start, stop, createShare, endShare, listShares, bump, bumpRef, sweep,
    get running() { return Boolean(server); },
    get address() { return server ? { port, host } : null; }
  };
}

module.exports = { createRemoteServer, PAGE_CSP, FRAME_CSP };

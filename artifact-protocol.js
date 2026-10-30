// thinker-artifact:// serves the three files an artifact frame needs, and nothing else.
//
// A sandboxed frame (one without same-origin access) is not allowed to load file: URLs, so its page and
// scripts come from this scheme instead. The frame also gets its security policy as a response header,
// which is stronger than a meta tag: no connections, no frames, no forms, images only as data.
const fs = require('fs/promises');
const path = require('path');

const SCHEME = 'thinker-artifact';

const FRAME_CSP = [
  "default-src 'none'",
  `script-src ${SCHEME}:`,
  "style-src 'unsafe-inline'",
  'img-src data:',
  `font-src data: ${SCHEME}:`,
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ');

// URL path -> file (relative to the app folder) and type. Anything not listed is refused.
const FILES = {
  '/artifact-frame.html': { file: path.join('renderer', 'artifact-frame.html'), type: 'text/html; charset=utf-8' },
  '/artifact-bridge.js': { file: path.join('renderer', 'js', 'artifact-bridge.js'), type: 'text/javascript; charset=utf-8' },
  '/purify.min.js': { file: path.join('renderer', 'vendor', 'dompurify', 'purify.min.js'), type: 'text/javascript; charset=utf-8' },
  '/katex.min.js': { file: path.join('renderer', 'vendor', 'katex', 'katex.min.js'), type: 'text/javascript; charset=utf-8' },
  '/artifact-components.js': { file: path.join('renderer', 'js', 'artifact-components.js'), type: 'text/javascript; charset=utf-8' }
};

// Must run before the app is ready.
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

// the maths fonts: only files of that exact shape, from that one folder
const FONT_PATH = /^\/fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)$/;

function lookup(requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch { return null; }
  if (url.protocol !== `${SCHEME}:` || url.host !== 'frame') return null;
  if (FILES[url.pathname]) return FILES[url.pathname];
  const font = FONT_PATH.exec(url.pathname);
  return font ? { file: path.join('renderer', 'vendor', 'katex', 'fonts', font[1]), type: 'font/woff2' } : null;
}

// Must run once the app is ready.
function handleScheme(protocol, appRoot) {
  protocol.handle(SCHEME, async (request) => {
    const entry = lookup(request.url);
    if (!entry) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    try {
      const body = await fs.readFile(path.join(appRoot, entry.file));
      return new Response(body, {
        status: 200,
        headers: { 'content-type': entry.type, 'content-security-policy': FRAME_CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }
      });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}

module.exports = { SCHEME, FRAME_CSP, FILES, lookup, registerScheme, handleScheme };

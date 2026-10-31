const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lookup, FILES, FRAME_CSP, LIVE_CSP } = require('../artifact-protocol');

test('every file the frames load exists, and only listed files are served', () => {
  for (const [route, entry] of Object.entries(FILES)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', entry.file)), route);
  }
  assert.equal(lookup('thinker-artifact://frame/main.js'), null);
  assert.equal(lookup('thinker-artifact://frame/../main.js'), null);
  assert.equal(lookup('https://frame/artifact-frame.html'), null);
});

test('a page that runs scripts gets scripts and nothing else', () => {
  const live = lookup('thinker-artifact://frame/artifact-live.html');
  assert.equal(live.csp, LIVE_CSP);
  assert.match(LIVE_CSP, /script-src thinker-artifact: 'unsafe-inline'/);
  assert.doesNotMatch(LIVE_CSP, /unsafe-eval/);
  for (const rule of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", 'img-src data:', "default-src 'none'"]) {
    assert.ok(LIVE_CSP.includes(rule), rule);
  }
  // the static frame never allows inline scripts
  assert.doesNotMatch(FRAME_CSP, /unsafe-inline.*script|script-src[^;]*unsafe-inline/);
  assert.equal(lookup('thinker-artifact://frame/artifact-frame.html').csp, undefined);
});

test('the charts library is available to a page by a relative path', () => {
  assert.ok(lookup('thinker-artifact://frame/lib/d3.min.js'));
});

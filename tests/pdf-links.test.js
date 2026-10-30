const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/js/pdf-links.js');

test('web addresses are found in text, without the punctuation after them', async () => {
  const { findUrls } = await load();
  const hits = findUrls('See https://example.com/page, and (www.example.org/a?b=1). Also http://x.io.');
  assert.deepStrictEqual(hits.map((h) => h.text), ['https://example.com/page', 'www.example.org/a?b=1', 'http://x.io']);
  assert.strictEqual(hits[1].href, 'https://www.example.org/a?b=1');
  assert.strictEqual('See https://example.com/page, and'.slice(hits[0].start, hits[0].end), 'https://example.com/page');
  assert.deepStrictEqual(findUrls('no links here, just text'), []);
  assert.deepStrictEqual(findUrls(null), []);
});

test('only web and mail addresses are ever followed', async () => {
  const { safeHref } = await load();
  assert.strictEqual(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.strictEqual(safeHref('mailto:a@b.com'), 'mailto:a@b.com');
  for (const bad of ['javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,hi', 'ftp://x.com', 'https://user:pass@x.com', 'not a url', '', null, 'thinker-artifact://frame/x']) {
    assert.strictEqual(safeHref(bad), null, String(bad));
  }
});

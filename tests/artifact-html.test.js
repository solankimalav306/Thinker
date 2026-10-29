const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/js/artifact-html.js');

test('a plain reply has no artifact', async () => {
  const { splitArtifacts } = await load();
  assert.deepStrictEqual(splitArtifacts('Just an answer [Page 3].'), [{ type: 'text', text: 'Just an answer [Page 3].' }]);
  assert.deepStrictEqual(splitArtifacts(''), []);
  assert.deepStrictEqual(splitArtifacts(null), []);
});

test('text, one artifact, text', async () => {
  const { splitArtifacts } = await load();
  const parts = splitArtifacts('Here is a comparison.\n<artifact title="Drill rules">\n<table><tr><td>14</td></tr></table>\n</artifact>\nHope it helps.');
  assert.deepStrictEqual(parts.map((p) => p.type), ['text', 'artifact', 'text']);
  assert.strictEqual(parts[1].title, 'Drill rules');
  assert.strictEqual(parts[1].html, '<table><tr><td>14</td></tr></table>');
  assert.strictEqual(parts[1].complete, true);
});

test('several artifacts, single-quoted and missing titles, and markup in titles', async () => {
  const { splitArtifacts } = await load();
  const parts = splitArtifacts("<artifact title='One'><p>a</p></artifact><artifact><p>b</p></artifact><artifact title=\"<b>Bold</b> &amp; plain\"><p>c</p></artifact>");
  assert.deepStrictEqual(parts.map((p) => p.title), ['One', 'Artifact', 'Bold & plain']);
  assert.deepStrictEqual(parts.map((p) => p.html), ['<p>a</p>', '<p>b</p>', '<p>c</p>']);
});

test('a reply that was cut off still shows what arrived, marked incomplete', async () => {
  const { splitArtifacts } = await load();
  const parts = splitArtifacts('Intro <artifact title="Cut"><p>half');
  assert.strictEqual(parts[1].complete, false);
  assert.strictEqual(parts[1].html, '<p>half');
});

test('code fences around an artifact are dropped, and tags are matched in any case', async () => {
  const { splitArtifacts } = await load();
  const parts = splitArtifacts('```html\n<ARTIFACT title="X"><p>y</p></Artifact>\n```');
  assert.deepStrictEqual(parts.map((p) => p.type), ['artifact']);
  assert.strictEqual(parts[0].html, '<p>y</p>');
});

test('a title is trimmed and capped', async () => {
  const { cleanTitle } = await load();
  assert.strictEqual(cleanTitle('  a   b  '), 'a b');
  assert.strictEqual(cleanTitle('x'.repeat(300)).length, 80);
  assert.strictEqual(cleanTitle(''), 'Artifact');
  assert.strictEqual(cleanTitle('<img src=x onerror=alert(1)>Hi'), 'Hi');
});

test('citations to documents and pages the answer was given stay clickable', async () => {
  const { validateCitations } = await load();
  const sources = [{ doc: 'Operations Manual 2023', page: 2 }, { doc: 'Safety Bulletin 2024', page: 1 }];
  const html = '<a class="tk-cite" data-cite="Operations Manual 2023|2">a</a> <a class="tk-cite" data-cite="safety bulletin 2024|1">b</a>';
  const result = validateCitations(html, sources);
  assert.strictEqual(result.invalid, 0);
  assert.deepStrictEqual(result.valid.map((v) => v.page), [2, 1]);
  assert.strictEqual(result.html, html);
});

test('invented documents, wrong pages and malformed references are marked unverified', async () => {
  const { validateCitations } = await load();
  const sources = [{ doc: 'Manual', page: 2 }];
  const html = [
    '<a data-cite="Manual|9">wrong page</a>',
    '<a data-cite="Made Up Report|2">invented</a>',
    '<a data-cite="Manual">no page</a>',
    '<a data-cite="">empty</a>',
    '<a data-cite="Manual|2">fine</a>'
  ].join('');
  const result = validateCitations(html, sources);
  assert.strictEqual(result.invalid, 4);
  assert.strictEqual(result.valid.length, 1);
  assert.strictEqual((result.html.match(/data-cite=/g) || []).length, 1, 'only the real one keeps data-cite');
  assert.strictEqual((result.html.match(/data-cite-unverified/g) || []).length, 4);
});

test('entities in a title are understood, and no sources means nothing is verified', async () => {
  const { validateCitations } = await load();
  assert.strictEqual(validateCitations('<a data-cite="Q&amp;A Guide|3">x</a>', [{ doc: 'Q&A Guide', page: 3 }]).invalid, 0);
  assert.strictEqual(validateCitations('<a data-cite="Manual|2">x</a>', []).invalid, 1);
  assert.strictEqual(validateCitations('<a data-cite="Manual|2">x</a>', undefined).invalid, 1);
});

test('the colour tokens map onto variables the app really defines', async () => {
  const { TOKEN_MAP } = await load();
  const fs = require('fs');
  const tokens = fs.readFileSync(require('path').join(__dirname, '..', 'renderer', 'css', 'tokens.css'), 'utf8');
  for (const variable of Object.values(TOKEN_MAP)) assert.ok(tokens.includes(variable + ':'), `${variable} is defined in tokens.css`);
});

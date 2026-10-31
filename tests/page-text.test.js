const test = require('node:test');
const assert = require('node:assert/strict');

const piece = (str, x, y, extra = {}) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5, height: 10, ...extra });

test('pieces on one baseline make a line, and a move of the baseline starts the next', async () => {
  const { pageText } = await import('../renderer/js/page-text.js');
  const text = pageText({ items: [piece('Hello', 0, 100), piece('world', 40, 100), piece('Second', 0, 85), piece('line', 40, 85)] });
  assert.equal(text, 'Hello world\nSecond line');
});

test('a gap with no space in the pieces is read as a space, and touching pieces are not split', async () => {
  const { pageText } = await import('../renderer/js/page-text.js');
  assert.equal(pageText({ items: [piece('re', 0, 100), piece('trieval', 10, 100)] }), 'retrieval');
  assert.equal(pageText({ items: [piece('two', 0, 100), piece('words', 30, 100)] }), 'two words');
});

test('end-of-line marks and empty pages are handled', async () => {
  const { pageText } = await import('../renderer/js/page-text.js');
  assert.equal(pageText({ items: [piece('a', 0, 100, { hasEOL: true }), piece('b', 6, 100)] }), 'a\nb');
  assert.equal(pageText({ items: [] }), '');
  assert.equal(pageText(null), '');
});

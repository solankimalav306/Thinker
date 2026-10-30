const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { buildDocx, buildPptx, pngBuffer } = require('../artifact-export');

// a 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const isZip = (b) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
const hasText = (buffer, text) => buffer.includes(Buffer.from(text)) || zlibScan(buffer, text);
function zlibScan(buffer, text) {
  // entries written with data descriptors: try inflating from each local header
  let at = 0;
  while ((at = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), at)) !== -1) {
    const nameLen = buffer.readUInt16LE(at + 26);
    const extraLen = buffer.readUInt16LE(at + 28);
    try {
      const inflated = zlib.inflateRawSync(buffer.subarray(at + 30 + nameLen + extraLen));
      if (inflated.includes(Buffer.from(text))) return true;
    } catch { /* stored or not inflatable from here */ }
    at += 4;
  }
  return false;
}

test('a Word file holds the headings, paragraphs, lists and table it was given', async () => {
  const file = await buildDocx({
    title: 'Return rules',
    blocks: [
      { t: 'h', level: 2, runs: [{ text: 'Overview' }] },
      { t: 'p', runs: [{ text: 'Thirty days ' }, { text: 'to return', bold: true }] },
      { t: 'li', ordered: false, depth: 0, runs: [{ text: 'Keep the receipt' }] },
      { t: 'li', ordered: true, depth: 0, runs: [{ text: 'Pack it' }] },
      { t: 'table', rows: [[{ text: 'Doc', header: true }, { text: 'Window', header: true }], [{ text: 'Guide' }, { text: '30 days' }]] },
      { t: 'img', data: PNG }
    ]
  });
  assert.ok(isZip(file));
  for (const word of ['Return rules', 'Overview', 'Keep the receipt', 'Pack it', '30 days']) assert.ok(hasText(file, word), word);
});

test('a PowerPoint file has one slide per entry, with its title and bullets', async () => {
  const file = await buildPptx({
    title: 'Deck',
    slides: [{ title: 'Hello', bullets: ['One', 'Two'] }, { title: 'Chart', bullets: [], image: PNG }]
  });
  assert.ok(isZip(file));
  for (const word of ['Hello', 'One', 'Two', 'Chart', 'slide2.xml']) assert.ok(hasText(file, word), word);
});

test('bad input does not crash the builders', async () => {
  assert.ok(isZip(await buildDocx({ title: '', blocks: [null && 1, { t: 'img', data: 'not a picture' }, { t: 'table', rows: [] }].filter(Boolean) })));
  assert.ok(isZip(await buildDocx({ title: 'x', blocks: 'nonsense' })));
  assert.ok(isZip(await buildPptx({ title: 'x', slides: 'nonsense' })));
  assert.strictEqual(pngBuffer('data:image/png;base64,AAAA'), null);
});

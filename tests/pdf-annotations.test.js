const test = require('node:test');
const assert = require('node:assert');
const { PDFDocument, degrees, PDFName, PDFArray, PDFDict, PDFString } = require('pdf-lib');
const { writeRealAnnotations, makePageMapper, parseColor } = require('../pdf-annotations');

async function docWithPage({ rotation = 0, size = [600, 800] } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(size);
  if (rotation) page.setRotation(degrees(rotation));
  return { pdf, page };
}

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('unrotated page: top-left of the display is the top-left of the page', async () => {
  const { page } = await docWithPage();
  const m = makePageMapper(page);
  assert.deepStrictEqual(m.toPdf(0, 0), { x: 0, y: 800 });
  assert.deepStrictEqual(m.toPdf(1, 1), { x: 600, y: 0 });
});

test('rotation 90: displayed top-left sits at the unrotated bottom-left', async () => {
  const { page } = await docWithPage({ rotation: 90 });
  const m = makePageMapper(page);
  assert.strictEqual(m.displayWidth, 800);
  assert.strictEqual(m.displayHeight, 600);
  assert.deepStrictEqual(m.toPdf(0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(m.toPdf(1, 0), { x: 0, y: 800 });
  assert.deepStrictEqual(m.toPdf(0, 1), { x: 600, y: 0 });
});

test('rotation 180 and 270 map the displayed top-left to the right corners', async () => {
  const r180 = makePageMapper((await docWithPage({ rotation: 180 })).page);
  assert.deepStrictEqual(r180.toPdf(0, 0), { x: 600, y: 0 });
  const r270 = makePageMapper((await docWithPage({ rotation: 270 })).page);
  assert.deepStrictEqual(r270.toPdf(0, 0), { x: 600, y: 800 });
  assert.deepStrictEqual(r270.toPdf(1, 1), { x: 0, y: 0 });
});

test('crop box offset is respected', async () => {
  const { page } = await docWithPage();
  page.setCropBox(50, 100, 400, 500);
  const m = makePageMapper(page);
  assert.deepStrictEqual(m.toPdf(0, 0), { x: 50, y: 600 });
  assert.deepStrictEqual(m.toPdf(1, 1), { x: 450, y: 100 });
});

test('writes real Ink, Highlight and Text annotations that survive save and reload', async () => {
  const { pdf } = await docWithPage();
  const count = writeRealAnnotations(
    pdf,
    {
      1: {
        paths: [{ color: '#e74c3c', widthNorm: 0.005, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.1 }] }],
        stickyNotes: [{ text: 'check this claim', x: 0.5, y: 0.5 }]
      }
    },
    { 1: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }] }
  );
  assert.strictEqual(count, 3);

  const reloaded = await PDFDocument.load(await pdf.save());
  const annots = reloaded.getPage(0).node.Annots();
  assert.strictEqual(annots.size(), 3);
  const subtypes = [];
  for (let i = 0; i < annots.size(); i += 1) {
    const dict = reloaded.context.lookup(annots.get(i), PDFDict);
    subtypes.push(dict.get(PDFName.of('Subtype')).asString());
    if (dict.get(PDFName.of('Subtype')).asString() === '/Text') {
      assert.strictEqual(dict.get(PDFName.of('Contents')).decodeText(), 'check this claim');
    }
    if (dict.get(PDFName.of('Subtype')).asString() === '/Highlight') {
      assert.strictEqual(dict.get(PDFName.of('QuadPoints')).size(), 8);
    }
  }
  assert.deepStrictEqual(subtypes.sort(), ['/Highlight', '/Ink', '/Text']);
});

test('degenerate input writes nothing', async () => {
  const { pdf } = await docWithPage();
  const count = writeRealAnnotations(pdf, { 1: { paths: [{ points: [{ x: 0.1, y: 0.1 }] }] } }, { 1: [{ x: 0, y: 0, w: 0, h: 0 }] });
  assert.strictEqual(count, 0);
});

test('color parsing handles hex and rgba', () => {
  const a = parseColor('#ff0000');
  assert.deepStrictEqual(a.rgb, [1, 0, 0]);
  const b = parseColor('rgba(0, 255, 0, 0.35)');
  assert.deepStrictEqual(b.rgb, [0, 1, 0]);
  close(b.opacity, 0.35);
});

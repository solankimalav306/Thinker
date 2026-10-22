// Builds awkward PDFs for UI stress testing: node scripts/make-ui-fixtures.js <outDir>
// Long and Unicode names, symbols, corrupt and empty files, a 300-page file, mixed page sizes.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');

const out = path.resolve(process.argv[2] || 'ui-fixtures');
fs.mkdirSync(out, { recursive: true });

async function build({ pages = 3, size = [612, 792], rotations = [], sizes = [], label = 'Page', heading = 'Test document' }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pages; i += 1) {
    const pageSize = sizes[i % (sizes.length || 1)] || size;
    const page = doc.addPage(pageSize);
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
    page.drawText(heading, { x: 40, y: pageSize[1] - 60, size: 22, font: bold });
    page.drawText(`${label} ${i + 1} of ${pages}`, { x: 40, y: pageSize[1] - 90, size: 14, font });
    page.drawText('The scheduler preempts on a timer tick. Context switches save registers.', { x: 40, y: pageSize[1] - 130, size: 12, font });
  }
  return doc.save();
}

(async () => {
  const w = (name, bytes) => fs.writeFileSync(path.join(out, name), bytes);

  w('A long document title that keeps going and going after twelve renames (final) (v2) (really final).pdf', await build({ heading: 'Long name' }));
  w('मेरा दस्तावेज़ - नोट्स 📄.pdf', await build({ heading: 'Unicode name' }));
  w("Tom & Jerry's #1 (copy) [draft] 100%.pdf", await build({ heading: 'Symbols in name' }));
  w('corrupt.pdf', Buffer.from('this is not a pdf at all, just some text pretending'));
  w('empty-zero-bytes.pdf', Buffer.alloc(0));
  w('big-300-pages.pdf', await build({ pages: 300, heading: 'Big document' }));
  w('mixed-pages.pdf', await build({
    pages: 6,
    sizes: [[612, 792], [792, 612], [300, 400], [1700, 2400], [612, 792], [595, 842]],
    rotations: [0, 0, 0, 0, 90, 270],
    heading: 'Mixed sizes and rotations'
  }));
  w('single-page.pdf', await build({ pages: 1, heading: 'One page' }));
  w('tiny-page.pdf', await build({ pages: 2, size: [120, 160], heading: 'Tiny' }));
  console.log('fixtures written to', out, fs.readdirSync(out).length, 'files');
})();

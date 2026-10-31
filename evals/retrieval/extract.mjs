// Extracts every PDF in ./pdfs the way the app does (items joined by a space = "flat"), and also with line breaks
// rebuilt from the text positions ("lines"), so a smarter chunker can be compared with the same documents.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire('C:/code/SmartPDFReader/');
const pdfjs = require('C:/code/SmartPDFReader/node_modules/pdfjs-dist/legacy/build/pdf.js');
const dir = process.argv[2];
fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'pdfs')).filter((x) => x.endsWith('.pdf'))) {
  const data = new Uint8Array(fs.readFileSync(path.join(dir, 'pdfs', f)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const flat = content.items.map((it) => it.str).join(' ');
    // lines: break where the baseline moves
    let lines = []; let cur = []; let lastY = null; let lastH = 10;
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = it.transform ? it.transform[5] : 0;
      const h = it.height || lastH;
      if (lastY !== null && Math.abs(y - lastY) > h * 0.6) { lines.push(cur.join('')); cur = []; }
      cur.push(it.str); lastY = y; lastH = h;
      if (it.hasEOL) { lines.push(cur.join('')); cur = []; lastY = null; }
    }
    if (cur.length) lines.push(cur.join(''));
    pages.push({ page: i, flat, lines: lines.map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).join('\n') });
  }
  fs.writeFileSync(path.join(dir, 'docs', f.replace('.pdf', '.json')), JSON.stringify({ id: f.replace('.pdf', ''), pages }));
  console.log(f, doc.numPages, 'pages', pages.reduce((a, p) => a + p.flat.split(/\s+/).length, 0), 'words');
}

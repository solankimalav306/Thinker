// Copies renderer runtime libraries out of node_modules into renderer/vendor so the
// app never loads scripts, styles or fonts from a CDN. Run via `npm run vendor`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'renderer', 'vendor');
const nm = (...p) => path.join(root, 'node_modules', ...p);

const files = [
  ['pdfjs/pdf.min.js', nm('pdfjs-dist', 'build', 'pdf.min.js')],
  ['pdfjs/pdf.worker.min.js', nm('pdfjs-dist', 'build', 'pdf.worker.min.js')],
  ['pdfjs/pdf_viewer.min.css', nm('pdfjs-dist', 'web', 'pdf_viewer.css')],
  ['marked/marked.umd.js', nm('marked', 'lib', 'marked.umd.js')],
  ['dompurify/purify.min.js', nm('dompurify', 'dist', 'purify.min.js')],
  ['d3/d3.min.js', nm('d3', 'dist', 'd3.min.js')],
  ['markmap/markmap-view.js', nm('markmap-view', 'dist', 'browser', 'index.js')],
];

const dirs = [
  ['fontawesome/css', nm('@fortawesome', 'fontawesome-free', 'css'), (f) => f === 'all.min.css'],
  ['fontawesome/webfonts', nm('@fortawesome', 'fontawesome-free', 'webfonts'), (f) => f.endsWith('.woff2')],
  ['fonts', nm('@fontsource-variable', 'bricolage-grotesque', 'files'), (f) => f === 'bricolage-grotesque-latin-wght-normal.woff2'],
  ['fonts', nm('@fontsource-variable', 'figtree', 'files'), (f) => f === 'figtree-latin-wght-normal.woff2'],
];

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

fs.rmSync(out, { recursive: true, force: true });
for (const [dest, src] of files) copy(src, path.join(out, dest));
for (const [destDir, srcDir, keep] of dirs) {
  for (const f of fs.readdirSync(srcDir).filter(keep)) copy(path.join(srcDir, f), path.join(out, destDir, f));
}

console.log('vendor: copied to', path.relative(root, out));
require('./build-editor').buildEditor();

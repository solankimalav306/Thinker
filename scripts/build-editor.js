// Bundles the ThinkerTex code editor into renderer/vendor/code-editor, and copies KaTeX (the maths
// renderer the visual editor uses). Called by scripts/vendor.js, or on its own: node scripts/build-editor.js
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'renderer', 'vendor');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function buildEditor() {
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'editor-entry.js')],
    outfile: path.join(outDir, 'code-editor', 'code-editor.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'chrome120',
    legalComments: 'none'
  });

  const katexDir = path.join(root, 'node_modules', 'katex', 'dist');
  copy(path.join(katexDir, 'katex.min.js'), path.join(outDir, 'katex', 'katex.min.js'));
  copy(path.join(katexDir, 'katex.min.css'), path.join(outDir, 'katex', 'katex.min.css'));
  for (const f of fs.readdirSync(path.join(katexDir, 'fonts')).filter((n) => n.endsWith('.woff2'))) {
    copy(path.join(katexDir, 'fonts', f), path.join(outDir, 'katex', 'fonts', f));
  }
  const size = (fs.statSync(path.join(outDir, 'code-editor', 'code-editor.js')).size / 1024).toFixed(0);
  console.log(`editor: bundled code-editor.js (${size} KB) and KaTeX`);
}

module.exports = { buildEditor };
if (require.main === module) buildEditor();

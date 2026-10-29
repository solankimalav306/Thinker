// ThinkerTex spike: compile real documents with the real engine through the real compile service.
//   node scripts/tex-spike.js [path-to-tectonic.exe]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCompiler } = require('../tex-compile');

const engine = path.resolve(process.argv[2] || path.join(__dirname, '..', 'vendor', 'tectonic', 'tectonic.exe'));
if (!fs.existsSync(engine)) {
  console.error('Engine not found:', engine);
  process.exit(2);
}

const DOCS = {
  hello: String.raw`\documentclass{article}
\begin{document}
Hello, ThinkerTex.
\end{document}
`,
  maths_table: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath}
\usepackage{booktabs}
\usepackage{graphicx}
\usepackage{hyperref}
\title{A longer test}
\author{Thinker}
\begin{document}
\maketitle
\section{Maths}
The quadratic formula is
\begin{equation}
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}.
\end{equation}
\section{A table}
\begin{tabular}{lrr}
\toprule
Port & Fee & Currency \\
\midrule
Rotterdam & 12400 & EUR \\
Singapore & 9800 & USD \\
\bottomrule
\end{tabular}
\section{Links}
See \href{https://example.org}{the site}.
\end{document}
`,
  broken: String.raw`\documentclass{article}
\begin{document}
This line is fine.
\undefinedcommand{oops}
Maths outside maths: x_1
\end{document}
`
};

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
// A fresh cache folder shows what a first-time user sees. Pass THINKER_SPIKE_CACHE to reuse one.
const cacheDir = process.env.THINKER_SPIKE_CACHE || tmp('tex-cache-');
const compiler = createCompiler({ engine: { command: engine, args: ['-X', 'compile'] }, limits: { timeoutMs: 60000 }, env: { TECTONIC_CACHE_DIR: cacheDir } });

function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? folderSize(full) : fs.statSync(full).size;
  }
  return total;
}

async function build(name, source, extra = {}) {
  const root = tmp('tex-spike-');
  fs.writeFileSync(path.join(root, 'main.tex'), source);
  const buildDir = path.join(tmp('tex-build-'), 'out');
  const t0 = Date.now();
  const result = await compiler.compile({ projectId: name, root, buildDir, ...extra });
  const size = result.pdfPath ? fs.statSync(result.pdfPath).size : 0;
  console.log(`\n${name}${extra.onlyCached ? ' (offline)' : ''}: ${result.ok ? 'OK' : 'FAILED'} in ${Date.now() - t0} ms, pdf ${size} bytes`);
  for (const p of result.problems.slice(0, 6)) console.log(`   ${p.severity} ${p.file}:${p.line ?? '-'} ${p.message}${p.hint ? '  [' + p.hint + ']' : ''}`);
  if (!result.ok && !result.problems.length) console.log(result.log.slice(0, 600));
  return result;
}

(async () => {
  console.log('Engine:', engine, (fs.statSync(engine).size / 1048576).toFixed(1) + ' MB');
  console.log('Cache folder:', cacheDir);
  const t0 = Date.now();
  const prepared = await compiler.prepare({ root: tmp('tex-prepare-'), buildDir: path.join(tmp('tex-build-'), 'out') });
  console.log(`
prepare (cold cache): ${prepared.ok ? 'OK' : 'FAILED'} in ${Date.now() - t0} ms; cache is now ${(folderSize(cacheDir) / 1048576).toFixed(1)} MB`);
  for (const p of prepared.problems.slice(0, 4)) console.log('   ', p.severity, p.message);
  await build('hello', DOCS.hello);
  await build('maths_table', DOCS.maths_table);
  await build('broken', DOCS.broken);
  await build('hello', DOCS.hello, { onlyCached: true });
  await build('maths_table', DOCS.maths_table, { onlyCached: true });
})();

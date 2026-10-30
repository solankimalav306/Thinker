const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLog } = require('../tex-log');
const { createCompiler, insideProject } = require('../tex-compile');

const FAKE = path.join(__dirname, 'fixtures', 'fake-tex-engine.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-tex-'));
function project(source, name = 'main.tex') {
  const root = tmp();
  fs.writeFileSync(path.join(root, name), source);
  return { root, buildDir: path.join(tmp(), 'build') };
}
const compiler = (limits) => createCompiler({ engine: { command: process.execPath, args: [FAKE] }, limits });

test('Tectonic-style errors and warnings are parsed with file and line', () => {
  const problems = parseLog('error: main.tex:12: Missing } inserted.\nwarning: main.tex:5: Overfull \\hbox in paragraph\nerror: halted');
  assert.deepStrictEqual(problems.map((p) => [p.severity, p.file, p.line]), [['error', 'main.tex', 12], ['warning', 'main.tex', 5]]); // the bare "halted" line adds nothing
  assert.match(problems[0].hint, /curly bracket/);
});

test('classic TeX logs: the line comes from the l.NN line after the error', () => {
  const log = ['This is TeX', '! Undefined control sequence.', '<recently read> \\foo', '', 'l.27 \\foo', '', '! Missing $ inserted.', 'l.31 x_1'].join('\n');
  const problems = parseLog(log, { mainFile: 'main.tex' });
  assert.strictEqual(problems.length, 2);
  assert.deepStrictEqual([problems[0].line, problems[1].line], [27, 31]);
  assert.strictEqual(problems[0].file, 'main.tex');
  assert.match(problems[0].hint, /not known/);
});

test('LaTeX warnings carry their line, and repeated lines are listed once', () => {
  const warn = 'LaTeX Warning: Reference fig:a on page 1 undefined on input line 44.';
  const log = [warn, warn, 'Overfull \\hbox (3.2pt too wide) in paragraph at lines 9--11'].join('\n');
  const problems = parseLog(log);
  assert.strictEqual(problems.length, 2);
  assert.deepStrictEqual(problems.map((p) => p.line), [44, 9]);
  assert.ok(problems.every((p) => p.severity === 'warning'));
});

test('empty and odd input does not throw', () => {
  assert.deepStrictEqual(parseLog(''), []);
  assert.deepStrictEqual(parseLog(null), []);
  assert.deepStrictEqual(parseLog('nothing interesting here\n\n'), []);
});

test('only files inside the project are allowed as the main file', () => {
  const root = path.resolve(tmp());
  assert.ok(insideProject(root, 'main.tex'));
  assert.ok(insideProject(root, 'chapters/one.tex'));
  const bad = ['../x.tex', '..\\x.tex', 'a/../../x.tex', path.resolve(root, '..', 'x.tex'), 'C:\\Windows\\win.ini', '', '.', null];
  for (const file of bad) assert.strictEqual(insideProject(root, file), null, String(file));
});

test('a good build returns the PDF path and runs the engine safely', async () => {
  const { root, buildDir } = project('hello');
  const result = await compiler().compile({ projectId: 'p1', root, buildDir });
  assert.strictEqual(result.ok, true);
  assert.ok(fs.existsSync(result.pdfPath) && result.pdfPath.startsWith(buildDir));
  const seen = JSON.parse(fs.readFileSync(path.join(buildDir, 'args.json'), 'utf8'));
  assert.ok(seen.rest.includes('--untrusted'), 'always untrusted');
  assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync(root), 'runs in the project folder');
  assert.ok(!seen.rest.includes('--only-cached'));
  const offline = await compiler().compile({ projectId: 'p1', root, buildDir, onlyCached: true });
  assert.ok(JSON.parse(fs.readFileSync(path.join(buildDir, 'args.json'), 'utf8')).rest.includes('--only-cached'));
  assert.strictEqual(offline.ok, true);
});

test('a failing build reports the problems and no PDF', async () => {
  const { root, buildDir } = project('%FAIL');
  const result = await compiler().compile({ projectId: 'p2', root, buildDir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.pdfPath, null);
  assert.deepStrictEqual(result.problems.filter((p) => p.severity === 'error').map((p) => p.line), [3]);
  assert.strictEqual(result.problems.filter((p) => p.severity === 'warning').length, 1);
});

test('an engine that exits cleanly without a PDF is still an error', async () => {
  const { root, buildDir } = project('%NOPDF');
  const result = await compiler().compile({ projectId: 'p3', root, buildDir });
  assert.strictEqual(result.ok, false);
  assert.match(result.problems.at(-1).message, /did not produce a PDF/);
});

test('a runaway build is stopped at the time limit', async () => {
  const { root, buildDir } = project('%HANG');
  const started = Date.now();
  const result = await compiler({ timeoutMs: 700 }).compile({ projectId: 'p4', root, buildDir });
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.ok, false);
  assert.ok(Date.now() - started < 5000);
  assert.match(result.problems[0].message, /took longer than/);
});

test('huge output is capped', async () => {
  const { root, buildDir } = project('%FLOOD');
  const result = await compiler({ maxOutputBytes: 100000 }).compile({ projectId: 'p5', root, buildDir });
  assert.ok(result.log.length < 400000, `log was ${result.log.length} chars`);
  assert.match(result.log, /output cut off/);
});

test('paths that escape the project, and missing files, are refused before anything runs', async () => {
  const { root, buildDir } = project('x');
  const c = compiler();
  const escaped = await c.compile({ projectId: 'p6', root, buildDir, mainFile: '../../etc/passwd' });
  assert.strictEqual(escaped.ok, false);
  assert.match(escaped.problems[0].message, /inside the project/);
  const missing = await c.compile({ projectId: 'p6', root, buildDir, mainFile: 'nothing.tex' });
  assert.match(missing.problems[0].message, /not found/);
  assert.ok(!fs.existsSync(path.join(buildDir, 'args.json')), 'the engine never ran');
});

test('a second request while building waits, and a third replaces it', async () => {
  const { root, buildDir } = project('%SLOW');
  const c = compiler();
  const first = c.compile({ projectId: 'p7', root, buildDir });
  const second = c.compile({ projectId: 'p7', root, buildDir });
  const third = c.compile({ projectId: 'p7', root, buildDir });
  const [a, b, d] = await Promise.all([first, second, third]);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.superseded, true, 'the older waiting request is told it was replaced');
  assert.strictEqual(d.ok, true, 'the newest one is built');
});

test('cancel stops a running build', async () => {
  const { root, buildDir } = project('%HANG');
  const c = compiler({ timeoutMs: 20000 });
  const run = c.compile({ projectId: 'p8', root, buildDir });
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(c.isBuilding('p8'), true);
  assert.strictEqual(c.cancel('p8'), true);
  const result = await run;
  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(c.isBuilding('p8'), false);
});

test('a missing engine is reported, not thrown', async () => {
  const { root, buildDir } = project('x');
  const c = createCompiler({ engine: { command: path.join(root, 'no-such-engine.exe'), args: [] } });
  const result = await c.compile({ projectId: 'p9', root, buildDir });
  assert.strictEqual(result.ok, false);
  assert.match(result.problems[0].message, /could not start/);
});

test('projects build independently and in parallel', async () => {
  const a = project('%SLOW');
  const b = project('%SLOW');
  const c = compiler();
  const t0 = Date.now();
  const [ra, rb] = await Promise.all([
    c.compile({ projectId: 'A', root: a.root, buildDir: a.buildDir }),
    c.compile({ projectId: 'B', root: b.root, buildDir: b.buildDir })
  ]);
  assert.ok(ra.ok && rb.ok);
  assert.ok(Date.now() - t0 < 1500);
});

test('the engine\'s generic lines are dropped when a real error is known, and repeats ignore the full stop', () => {
  const log = [
    'error: main.tex:4: Undefined control sequence',
    'error: something bad happened inside XeTeX; its output follows:',
    'error: main.tex:4: Undefined control sequence.',
    'error: the XeTeX engine had an unrecoverable error'
  ].join('\n');
  const problems = parseLog(log);
  assert.strictEqual(problems.length, 1);
  assert.strictEqual(problems[0].line, 4);
  // with nothing more specific, the generic message is kept so the person still sees something
  assert.strictEqual(parseLog('error: the XeTeX engine had an unrecoverable error').length, 1);
});

test('prepare builds a starter document with a long limit and the engine sees the given environment', async () => {
  const root = tmp();
  const buildDir = path.join(tmp(), 'out');
  const seen = path.join(tmp(), 'seen.txt');
  const spy = path.join(tmp(), 'spy-engine.js');
  fs.writeFileSync(spy, [
    "const fs = require('fs'); const path = require('path');",
    "const out = process.argv[process.argv.indexOf('--outdir') + 1];",
    "fs.mkdirSync(out, { recursive: true });",
    "fs.writeFileSync(" + JSON.stringify(seen) + ", String(process.env.TECTONIC_CACHE_DIR));",
    "fs.writeFileSync(path.join(out, 'main.pdf'), '%PDF-fake');"
  ].join('\n'));
  const c = createCompiler({ engine: { command: process.execPath, args: [spy] }, limits: { timeoutMs: 100 }, env: { TECTONIC_CACHE_DIR: 'C:/cache/here' } });
  const result = await c.prepare({ root, buildDir, timeoutMs: 30000 });
  assert.strictEqual(result.ok, true);
  assert.ok(fs.readFileSync(path.join(root, 'main.tex'), 'utf8').includes('usepackage{amsmath'));
  assert.strictEqual(fs.readFileSync(seen, 'utf8'), 'C:/cache/here');
});

test('the same error reported with and without a file name is listed once', () => {
  const log = ['error: main.tex:3: Undefined control sequence', '! Undefined control sequence.', 'l.3 oops'].join('\n');
  assert.strictEqual(parseLog(log, { mainFile: 'main.tex' }).length, 1);
});

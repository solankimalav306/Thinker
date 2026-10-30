const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../tex-projects');
const { TEMPLATES, listTemplates } = require('../tex-templates');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-proj-'));

test('every template has a main.tex that starts with a document class and ends the document', () => {
  for (const [id, template] of Object.entries(TEMPLATES)) {
    const main = template.files['main.tex'];
    assert.ok(main, id);
    assert.match(main, /^\\documentclass/m, id);
    assert.match(main, /\\end\{document\}\s*$/, id);
    assert.ok(!/undefined|\$\{/.test(main), `${id} has a stray placeholder`);
  }
  assert.deepStrictEqual(listTemplates().map((t) => t.id).sort(), ['article', 'beamer', 'blank', 'letter', 'report']);
});

test('the report template ships the bibliography file it points at', () => {
  assert.ok(TEMPLATES.report.files['refs.bib']);
  assert.match(TEMPLATES.report.files['main.tex'], /\\bibliography\{refs\}/);
});

test('a new project gets its own folder, and a second one with the same name does not overwrite', () => {
  const projectsRoot = tmp();
  const a = P.createProject({ projectsRoot, name: 'My Thesis!' });
  const b = P.createProject({ projectsRoot, name: 'My Thesis!', template: 'report' });
  assert.notStrictEqual(a.root, b.root);
  assert.ok(fs.existsSync(path.join(a.root, 'main.tex')));
  assert.ok(fs.existsSync(path.join(b.root, 'refs.bib')));
  assert.strictEqual(path.basename(a.root), 'my-thesis');
  assert.throws(() => P.createProject({ projectsRoot, name: 'x', template: 'nope' }), /Unknown template/);
});

test('names that would be odd folder names are made safe', () => {
  assert.strictEqual(P.slug('  ../../Windows\\System32  '), 'windows-system32');
  assert.strictEqual(P.slug(''), 'project');
  assert.strictEqual(P.slug('日本語'), 'project');
  assert.ok(P.slug('x'.repeat(200)).length <= 40);
});

test('the main file of an existing folder is found', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'chapter.tex'), 'just text');
  fs.writeFileSync(path.join(dir, 'paper.tex'), '\\documentclass{article}\n\\begin{document}\\end{document}');
  assert.strictEqual(P.detectMainFile(dir), 'paper.tex');
  fs.writeFileSync(path.join(dir, 'main.tex'), 'x');
  assert.strictEqual(P.detectMainFile(dir), 'main.tex');
  assert.strictEqual(P.detectMainFile(tmp()), null);
});

test('file operations cannot leave the project', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'main.tex'), 'ok');
  const outside = path.join(path.dirname(root), 'secret.tex');
  fs.writeFileSync(outside, 'secret');
  for (const bad of ['../secret.tex', '..\\secret.tex', outside, 'a/../../secret.tex', 'C:\\Windows\\win.ini.tex']) {
    assert.throws(() => P.readTextFile(root, bad), /outside the project/, bad);
    assert.throws(() => P.writeTextFile(root, bad, 'x'), /outside the project/, bad);
    assert.throws(() => P.createFile(root, bad, 'x'), /outside the project/, bad);
    assert.throws(() => P.renameEntry(root, 'main.tex', bad), /outside the project/, bad);
  }
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'secret');
});

test('only known text types can be read or written, and size is limited', () => {
  const root = tmp();
  assert.throws(() => P.writeTextFile(root, 'run.bat', 'calc'), /cannot be saved/);
  assert.throws(() => P.writeTextFile(root, 'script.js', 'x'), /cannot be saved/);
  assert.throws(() => P.readTextFile(root, 'photo.png'), /Only text files/);
  assert.throws(() => P.writeTextFile(root, 'big.tex', 'x'.repeat(3 * 1024 * 1024)), /too large/);
  P.writeTextFile(root, 'chapters/one.tex', 'hello');
  assert.strictEqual(P.readTextFile(root, 'chapters/one.tex'), 'hello');
});

test('saving replaces the file whole and leaves no temporary file behind', () => {
  const root = tmp();
  P.writeTextFile(root, 'main.tex', 'one');
  P.writeTextFile(root, 'main.tex', 'two');
  assert.strictEqual(P.readTextFile(root, 'main.tex'), 'two');
  assert.deepStrictEqual(fs.readdirSync(root), ['main.tex']);
});

test('new files and folders refuse to overwrite; renames keep types valid', () => {
  const root = tmp();
  P.createFile(root, 'a.tex', 'A');
  assert.throws(() => P.createFile(root, 'a.tex', 'B'), /already exists/);
  assert.strictEqual(P.readTextFile(root, 'a.tex'), 'A');
  P.createFolder(root, 'figs');
  assert.throws(() => P.createFolder(root, 'figs'), /already exists/);
  P.renameEntry(root, 'a.tex', 'figs/b.tex');
  assert.ok(fs.existsSync(path.join(root, 'figs', 'b.tex')));
  P.createFile(root, 'c.tex', 'C');
  assert.throws(() => P.renameEntry(root, 'c.tex', 'figs/b.tex'), /already exists/);
  assert.throws(() => P.renameEntry(root, 'c.tex', 'c.exe'), /not supported/);
  assert.throws(() => P.renameEntry(root, 'ghost.tex', 'd.tex'), /no longer exists/);
});

test('listing shows text and image files, folders first, and hides build and hidden folders', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'figs'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'main.tex'), 'x');
  fs.writeFileSync(path.join(root, 'refs.bib'), 'x');
  fs.writeFileSync(path.join(root, 'figs', 'plot.png'), 'x');
  fs.writeFileSync(path.join(root, 'run.exe'), 'x');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'x');
  fs.writeFileSync(path.join(root, 'node_modules', 'a.tex'), 'x');
  const files = P.listFiles(root);
  assert.deepStrictEqual(files.map((f) => f.path), ['figs', 'figs/plot.png', 'main.tex', 'refs.bib']);
  assert.strictEqual(files.find((f) => f.path === 'figs/plot.png').type, 'image');
});

test('importing copies an image in, picks a free name, and rejects other types', () => {
  const root = tmp();
  const src = path.join(tmp(), 'plot.png');
  fs.writeFileSync(src, 'png-bytes');
  assert.strictEqual(P.importFile(root, src, 'figs'), 'figs/plot.png');
  assert.strictEqual(P.importFile(root, src, 'figs'), 'figs/plot-2.png');
  const exe = path.join(tmp(), 'tool.exe');
  fs.writeFileSync(exe, 'x');
  assert.throws(() => P.importFile(root, exe), /not supported/);
});

test('deleting goes through the Recycle Bin callback and needs one', async () => {
  const root = tmp();
  P.createFile(root, 'gone.tex', 'x');
  let trashed = null;
  await P.deleteEntry(root, 'gone.tex', async (p) => { trashed = p; });
  assert.strictEqual(path.basename(trashed), 'gone.tex');
  await assert.rejects(() => P.deleteEntry(root, 'gone.tex'), /Recycle Bin/);
  await assert.rejects(() => P.deleteEntry(root, '../x.tex', async () => {}), /outside the project/);
});

test('a scratch copy takes the changed files and leaves the real project alone', () => {
  const { makeShadow } = require('../tex-service');
  const root = tmp();
  fs.mkdirSync(path.join(root, 'figs'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'main.tex'), 'original');
  fs.writeFileSync(path.join(root, 'figs', 'a.png'), 'img');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'x');
  const shadow = makeShadow(root, { 'main.tex': 'changed', 'new.tex': 'added' });
  try {
    assert.strictEqual(fs.readFileSync(path.join(shadow, 'main.tex'), 'utf8'), 'changed');
    assert.strictEqual(fs.readFileSync(path.join(shadow, 'new.tex'), 'utf8'), 'added');
    assert.ok(fs.existsSync(path.join(shadow, 'figs', 'a.png')));
    assert.ok(!fs.existsSync(path.join(shadow, '.git')));
    assert.strictEqual(fs.readFileSync(path.join(root, 'main.tex'), 'utf8'), 'original');
    assert.ok(!fs.existsSync(path.join(root, 'new.tex')));
    assert.throws(() => makeShadow(root, { '../escape.tex': 'x' }), /outside the project/);
  } finally {
    fs.rmSync(shadow, { recursive: true, force: true });
  }
});

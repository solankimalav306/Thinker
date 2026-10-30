// ThinkerTex projects on disk: creating them, and reading and writing their files safely.
//
// Every path that comes from the interface is checked here, not trusted: it must stay inside the
// project folder, and only known text and image types can be written. Deleting moves to the Recycle
// Bin (through the `trash` callback) instead of erasing.
const fs = require('fs');
const path = require('path');
const { TEMPLATES } = require('./tex-templates');
const { insideProject } = require('./tex-compile');

const TEXT_EXTENSIONS = new Set(['.tex', '.bib', '.sty', '.cls', '.bst', '.txt', '.md', '.cfg', '.def', '.bbx', '.cbx', '.ltx']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.eps', '.gif']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.thinker', '__MACOSX']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_LIST = 3000;

const ext = (name) => path.extname(name).toLowerCase();

function slug(name) {
  return String(name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

function uniqueDir(parent, base) {
  let dir = path.join(parent, base);
  for (let n = 2; fs.existsSync(dir); n += 1) dir = path.join(parent, `${base}-${n}`);
  return dir;
}

function resolveIn(root, relative) {
  const full = insideProject(path.resolve(root), relative);
  if (!full) throw new Error('That path is outside the project.');
  return full;
}

// A new project in Thinker's own projects folder.
function createProject({ projectsRoot, name, template = 'article' }) {
  const t = TEMPLATES[template];
  if (!t) throw new Error('Unknown template.');
  fs.mkdirSync(projectsRoot, { recursive: true });
  const root = uniqueDir(projectsRoot, slug(name));
  fs.mkdirSync(root, { recursive: true });
  for (const [file, content] of Object.entries(t.files)) {
    const full = resolveIn(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return { root, mainFile: 'main.tex' };
}

// Finds the main document of an existing folder: the file with \documentclass, preferring main.tex.
function detectMainFile(root) {
  const candidates = fs.readdirSync(root).filter((f) => ext(f) === '.tex');
  if (!candidates.length) return null;
  if (candidates.includes('main.tex')) return 'main.tex';
  for (const file of candidates) {
    try {
      if (/\\documentclass/.test(fs.readFileSync(path.join(root, file), 'utf8').slice(0, 20000))) return file;
    } catch { /* unreadable file: try the next */ }
  }
  return candidates[0];
}

function listFiles(root) {
  const base = path.resolve(root);
  const out = [];
  (function walk(dir, depth) {
    if (depth > 6 || out.length >= MAX_LIST) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        walk(full, depth + 1);
      } else if (TEXT_EXTENSIONS.has(ext(entry.name)) || IMAGE_EXTENSIONS.has(ext(entry.name))) {
        out.push({ path: rel, type: TEXT_EXTENSIONS.has(ext(entry.name)) ? 'text' : 'image', size: fs.statSync(full).size });
      }
    }
  })(base, 0);
  return out;
}

function readTextFile(root, relative) {
  if (!TEXT_EXTENSIONS.has(ext(relative))) throw new Error('Only text files can be opened in the editor.');
  const full = resolveIn(root, relative);
  const stat = fs.statSync(full);
  if (stat.size > MAX_TEXT_BYTES) throw new Error('That file is too large to edit here.');
  return fs.readFileSync(full, 'utf8');
}

// Writes through a temporary file so a crash never leaves half a file.
function writeTextFile(root, relative, content) {
  if (!TEXT_EXTENSIONS.has(ext(relative))) throw new Error('That kind of file cannot be saved here.');
  if (Buffer.byteLength(String(content), 'utf8') > MAX_TEXT_BYTES) throw new Error('That file is too large.');
  const full = resolveIn(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.thinker-tmp`;
  fs.writeFileSync(tmp, String(content), 'utf8');
  fs.renameSync(tmp, full);
  return true;
}

function createFile(root, relative, content = '') {
  const full = resolveIn(root, relative);
  if (fs.existsSync(full)) throw new Error('A file with that name already exists.');
  writeTextFile(root, relative, content);
  return true;
}

function createFolder(root, relative) {
  const full = resolveIn(root, relative);
  if (fs.existsSync(full)) throw new Error('A folder with that name already exists.');
  fs.mkdirSync(full, { recursive: true });
  return true;
}

function renameEntry(root, from, to) {
  const a = resolveIn(root, from);
  const b = resolveIn(root, to);
  if (!fs.existsSync(a)) throw new Error('That file no longer exists.');
  if (fs.existsSync(b)) throw new Error('Something with that name already exists.');
  if (!fs.statSync(a).isDirectory() && !TEXT_EXTENSIONS.has(ext(to)) && !IMAGE_EXTENSIONS.has(ext(to))) throw new Error('That file type is not supported.');
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
  return true;
}

async function deleteEntry(root, relative, trash) {
  const full = resolveIn(root, relative);
  if (!fs.existsSync(full)) return true;
  if (typeof trash !== 'function') throw new Error('Deleting needs the Recycle Bin.');
  await trash(full);
  return true;
}

// Copies an image or text file into the project (for "upload image").
function importFile(root, sourcePath, relativeDir = '') {
  const name = path.basename(sourcePath);
  if (!IMAGE_EXTENSIONS.has(ext(name)) && !TEXT_EXTENSIONS.has(ext(name))) throw new Error('That file type is not supported.');
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error('That is not a file.');
  if (stat.size > 50 * 1024 * 1024) throw new Error('That file is larger than 50 MB.');
  let target = relativeDir ? path.posix.join(relativeDir.split(path.sep).join('/'), name) : name;
  for (let n = 2; fs.existsSync(resolveIn(root, target)); n += 1) {
    const parsed = path.parse(name);
    target = path.posix.join(relativeDir || '', `${parsed.name}-${n}${parsed.ext}`);
  }
  const full = resolveIn(root, target);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(sourcePath, full);
  return target;
}

module.exports = {
  createProject, detectMainFile, listFiles, readTextFile, writeTextFile, createFile, createFolder,
  renameEntry, deleteEntry, importFile, TEXT_EXTENSIONS, IMAGE_EXTENSIONS, slug
};

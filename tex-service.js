// ThinkerTex in the main process: ties the project files, the compile service and Thinkspaces to IPC.
// Every handler checks its arguments. File paths from the interface are always relative to a project
// that is looked up by id, and tex-projects.js refuses anything that would leave it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCompiler } = require('./tex-compile');
const projects = require('./tex-projects');
const { listTemplates } = require('./tex-templates');

const text = (v) => String(v ?? '');
const SHADOW_SKIP = new Set(['.git', 'node_modules', '.thinker']);

// A scratch copy of a project with some files replaced, so the agent can try a change and compile it
// without touching the person's files. Returns the folder; the caller removes it.
function makeShadow(root, overlay = {}) {
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'thinkertex-shadow-'));
  let bytes = 0;
  (function copy(from, to, depth) {
    if (depth > 6) return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (SHADOW_SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) copy(source, target, depth + 1);
      else {
        bytes += fs.statSync(source).size;
        if (bytes > 200 * 1024 * 1024) throw new Error('This project is too large to try changes on.');
        fs.copyFileSync(source, target);
      }
    }
  })(root, shadow, 0);
  for (const [relative, content] of Object.entries(overlay)) projects.writeTextFile(shadow, relative, content);
  return shadow;
}

function registerTexIpc({ ipcMain, dialog, shell, BrowserWindow, app, spaces, enginePath, onBuilt }) {
  const dataRoot = () => path.join(app.getPath('userData'), 'ThinkerTex');
  const projectsRoot = () => path.join(dataRoot(), 'projects');
  const buildsRoot = () => path.join(dataRoot(), 'builds');
  const cacheDir = () => path.join(app.getPath('userData'), 'tectonic-cache');
  const marker = () => path.join(cacheDir(), '.thinker-prepared');
  const engineFound = () => Boolean(enginePath && fs.existsSync(enginePath));
  const prepared = () => fs.existsSync(marker());

  let compiler = null;
  const getCompiler = () => {
    if (!compiler) {
      if (!engineFound()) throw new Error('The ThinkerTex engine is not installed.');
      compiler = createCompiler({
        engine: { command: enginePath, args: ['-X', 'compile'] },
        env: { TECTONIC_CACHE_DIR: cacheDir() }
      });
    }
    return compiler;
  };

  const project = (id) => {
    const found = spaces().getProject(text(id));
    if (!found) throw new Error('That project no longer exists.');
    if (!fs.existsSync(found.rootPath)) throw new Error('The project folder was moved or deleted.');
    return found;
  };

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (error) {
      return { ok: false, error: error?.message || 'Something went wrong.' };
    }
  });

  handle('tex:templates', () => listTemplates());

  handle('tex:engine', () => ({
    found: engineFound(),
    prepared: prepared(),
    cacheDir: cacheDir()
  }));

  handle('tex:setup', async (event) => {
    const c = getCompiler();
    fs.mkdirSync(cacheDir(), { recursive: true });
    const work = path.join(dataRoot(), 'setup');
    const started = Date.now();
    const tick = setInterval(() => event.sender.send('tex:setup-progress', { seconds: Math.round((Date.now() - started) / 1000) }), 1000);
    try {
      const result = await c.prepare({ root: path.join(work, 'src'), buildDir: path.join(work, 'out') });
      if (result.ok) fs.writeFileSync(marker(), JSON.stringify({ at: Date.now() }));
      return { ok: result.ok, problems: result.problems.slice(0, 5), seconds: Math.round((Date.now() - started) / 1000) };
    } finally {
      clearInterval(tick);
    }
  });

  handle('tex:projects', () => spaces().listProjects().filter((p) => p.kind === 'latex').map((p) => ({ ...p, missing: !fs.existsSync(p.rootPath) })));

  handle('tex:create', (_e, fields = {}) => {
    const made = projects.createProject({ projectsRoot: projectsRoot(), name: text(fields.name) || 'Untitled project', template: text(fields.template) || 'article' });
    return spaces().registerProject({ rootPath: made.root, name: text(fields.name) || 'Untitled project', managed: true, mainFile: made.mainFile, workspaceId: fields.workspaceId ? text(fields.workspaceId) : undefined });
  });

  handle('tex:openFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open a LaTeX project folder' });
    if (canceled || !filePaths[0]) return null;
    const root = filePaths[0];
    const main = projects.detectMainFile(root);
    if (!main) throw new Error('That folder has no .tex file in it.');
    return spaces().registerProject({ rootPath: root, name: path.basename(root), mainFile: main });
  });

  handle('tex:openFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'LaTeX', extensions: ['tex'] }] });
    if (canceled || !filePaths[0]) return null;
    return spaces().registerProject({ rootPath: path.dirname(filePaths[0]), name: path.basename(path.dirname(filePaths[0])), mainFile: path.basename(filePaths[0]) });
  });

  handle('tex:open', (_e, id) => {
    const p = project(id);
    spaces().updateProject(p.id, { lastOpenedAt: Date.now() });
    return { project: spaces().getProject(p.id), files: projects.listFiles(p.rootPath), spaces: spaces().workspacesForProject(p.id) };
  });

  handle('tex:forget', (_e, id) => spaces().forgetProject(text(id)));
  handle('tex:rename', (_e, id, name) => spaces().updateProject(project(id).id, { name: text(name) }));
  handle('tex:setMain', (_e, id, file) => {
    const p = project(id);
    if (!/\.tex$/i.test(text(file))) throw new Error('The main file must be a .tex file.');
    return spaces().updateProject(p.id, { mainFile: text(file) });
  });

  handle('tex:files', (_e, id) => projects.listFiles(project(id).rootPath));
  handle('tex:read', (_e, id, file) => projects.readTextFile(project(id).rootPath, text(file)));
  handle('tex:write', (_e, id, file, content) => projects.writeTextFile(project(id).rootPath, text(file), text(content)));
  handle('tex:newFile', (_e, id, file, content) => projects.createFile(project(id).rootPath, text(file), text(content)));
  handle('tex:newFolder', (_e, id, folder) => projects.createFolder(project(id).rootPath, text(folder)));
  handle('tex:renameFile', (_e, id, from, to) => projects.renameEntry(project(id).rootPath, text(from), text(to)));
  handle('tex:deleteFile', (_e, id, file) => projects.deleteEntry(project(id).rootPath, text(file), (full) => shell.trashItem(full)));

  handle('tex:importFiles', async (event, id, dir) => {
    const p = project(id);
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and PDFs', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'eps', 'gif'] }]
    });
    if (canceled) return [];
    return filePaths.map((source) => projects.importFile(p.rootPath, source, text(dir)));
  });

  // ---- compile and preview ----
  const buildDirFor = (p) => path.join(buildsRoot(), p.id);

  handle('tex:compile', async (_e, id, options = {}) => {
    const p = project(id);
    if (!engineFound()) throw new Error('The ThinkerTex engine is not installed.');
    const offline = Boolean(options.onlyCached);
    if (!prepared() && !offline) return { notReady: true };
    const result = await getCompiler().compile({
      projectId: p.id, root: p.rootPath, mainFile: p.mainFile, buildDir: buildDirFor(p),
      mode: options.draft ? 'draft' : 'full', onlyCached: offline
    });
    if (result.ok) {
      spaces().updateProject(p.id, { lastBuiltAt: Date.now() });
      try { onBuilt?.(p.id); } catch { /* sharing must never break a build */ }
    }
    return { ok: result.ok, problems: result.problems, durationMs: result.durationMs, timedOut: result.timedOut, cancelled: result.cancelled, superseded: Boolean(result.superseded), hasPdf: Boolean(result.pdfPath), log: result.log.slice(-60000) };
  });

  handle('tex:cancel', (_e, id) => (compiler ? compiler.cancel(text(id)) : false));

  handle('tex:pdf', (_e, id) => {
    const p = project(id);
    const file = path.join(buildDirFor(p), path.basename(p.mainFile).replace(/\.tex$/i, '.pdf'));
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  });

  handle('tex:exportPdf', async (event, id) => {
    const p = project(id);
    const file = path.join(buildDirFor(p), path.basename(p.mainFile).replace(/\.tex$/i, '.pdf'));
    if (!fs.existsSync(file)) throw new Error('Compile the project first.');
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `${p.name}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePath) return null;
    fs.copyFileSync(file, filePath);
    return filePath;
  });

  // The agent tries a change on a scratch copy and gets the build result back.
  handle('tex:tryChange', async (_e, id, overlay = {}) => {
    const p = project(id);
    if (!engineFound() || !prepared()) return { notReady: true };
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) throw new Error('Nothing to try.');
    const shadow = makeShadow(p.rootPath, overlay);
    try {
      const result = await getCompiler().compile({
        projectId: `try-${p.id}`, root: shadow, mainFile: p.mainFile, buildDir: path.join(shadow, '.thinker-build'), mode: 'draft'
      });
      return { ok: result.ok, problems: result.problems, durationMs: result.durationMs, timedOut: result.timedOut, log: result.log.slice(-30000) };
    } finally {
      fs.rmSync(shadow, { recursive: true, force: true });
    }
  });
}

module.exports = { registerTexIpc, makeShadow };

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } = require('electron');
const artifactProtocol = require('./artifact-protocol');
artifactProtocol.registerScheme(protocol);
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const { spawn } = require('child_process');
const net = require('net');
const axios = require('axios');

const { initStorage, migrateProfileSecrets, getItemSync, setItemSync, removeItemSync, getItemDirect } = require('./app-storage');
const { openDatabase } = require('./database');
const { createStore } = require('./store');
const { createWorkspaces } = require('./workspaces');
const { createArtifacts } = require('./artifacts');
const { createRemoteServer } = require('./remote-server');
const { createCollab } = require('./collab-docs');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');
const os = require('os');
const { registerTexIpc } = require('./tex-service');
const { importLegacyData } = require('./legacy-import');
const { handleLLMGenerate } = require('./llm-handler');
const { resolveSecrets, hasUnresolvedSecret, KEY_UNLOCK_ERROR } = require('./secrets');
const { isAllowedExternalUrl } = require('./external-links');
const { writeRealAnnotations } = require('./pdf-annotations');

// ── Backend process handle (so we can kill it cleanly on exit) ──────────────
let backendProcess = null;
let store = null;
let workspaces = null;
const spaces = () => (workspaces ||= createWorkspaces(store));
let artifactLib = null;
const artifacts = () => (artifactLib ||= createArtifacts(store));

// ── Backend address: random free port + per-launch token, chosen at startup ──
let BACKEND_PORT = 0;
let BACKEND_URL = '';
const BACKEND_TOKEN = crypto.randomBytes(32).toString('hex');
const PDF_ID_PATTERN = /^[0-9a-f]{64}$/;

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// The renderer is not trusted to choose where the backend reads or writes: the storage
// directory is fixed here and document ids must be content hashes.
async function backendPost(route, data, signal) {
  if (hasUnresolvedSecret(data)) throw new Error(KEY_UNLOCK_ERROR);
  const body = { ...data };
  if ('pdfId' in body && !PDF_ID_PATTERN.test(String(body.pdfId))) {
    throw new Error('Invalid document id');
  }
  if ('docs' in body) {
    // a Thinkspace question searches several documents: each needs a real content hash and a plain title
    const docs = Array.isArray(body.docs) ? body.docs.slice(0, 12) : [];
    body.docs = docs.map((d) => {
      if (!d || !PDF_ID_PATTERN.test(String(d.pdfId))) throw new Error('Invalid document id');
      return { pdfId: String(d.pdfId), title: String(d.title || 'Untitled').replace(/[\r\n\[\]]+/g, ' ').trim().slice(0, 120) };
    });
  }
  if ('storagePath' in body) body.storagePath = app.getPath('userData');
  // Slower than any normal answer, but finite: a stalled provider call must not hang the chat.
  return axios.post(`${BACKEND_URL}${route}`, body, { headers: { 'x-thinker-token': BACKEND_TOKEN }, timeout: 150000, signal });
}

// ── Spawn the Python/compiled backend ───────────────────────────────────────
function startBackend() {
  const backendEnv = {
    ...process.env,
    THINKER_TOKEN: BACKEND_TOKEN,
    THINKER_STORAGE_ROOT: app.getPath('userData')
  };
  // Production: search multiple locations for backend.exe
  const possiblePaths = [
    path.join(path.dirname(app.getPath('exe')), 'backend.exe'),
    path.join(process.resourcesPath, 'backend.exe'),
    path.join(app.getAppPath(), '..', 'backend.exe')
  ];
  let exePath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      exePath = p;
      break;
    }
  }

  if (exePath) {
    console.log('[backend] Launching backend.exe on port:', BACKEND_PORT, exePath);
    backendProcess = spawn(exePath, [String(BACKEND_PORT)], { detached: false, env: backendEnv });
  } else {
    // Dev fallback: use the venv uvicorn
    console.log('[backend] backend.exe not found – falling back to venv uvicorn on port:', BACKEND_PORT);
    const venvPython = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python';
    backendProcess = spawn(
      pythonBin,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
      { cwd: path.join(__dirname, 'agent-handler'), detached: false, env: backendEnv }
    );
  }

  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString().trim()));
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString().trim()));
  backendProcess.on('exit', code => console.log('[backend] exited with code', code));
}

// ── Poll /health until the backend responds ──────────────────────────────────
async function waitForBackend(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await axios.get(`${BACKEND_URL}/health`, { timeout: 2000, headers: { 'x-thinker-token': BACKEND_TOKEN } });
      if (res.data?.status === 'ok') return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false; // timed out
}

// ── Splash window ────────────────────────────────────────────────────────────
let splashWindow = null;
function createSplash() {
  const theme = getItemDirect('smartpdf.theme') || 'dark';
  const palette = getItemDirect('smartpdf.themePalette') || 'aurora';
  const customAccent = getItemDirect('custom-accent-color') || '';

  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, sandbox: true, contextIsolation: true }
  });
  
  splashWindow.loadFile('renderer/splash.html', {
    query: { theme, palette, customAccent }
  });
}

function toLocalPath(filePath) {
  if (!filePath) return filePath;
  if (filePath.startsWith('file:///')) {
    return decodeURIComponent(filePath.replace('file:///', '').replace(/\//g, '\\'));
  }
  if (filePath.startsWith('file://')) {
    return decodeURIComponent(filePath.replace('file://', ''));
  }
  return filePath;
}

function parseColor(input) {
  const raw = String(input || '').trim();
  if (!raw) return { color: rgb(1, 0.92, 0.23), opacity: 1 };

  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1];
    const r = parseInt(v.slice(0, 2), 16) / 255;
    const g = parseInt(v.slice(2, 4), 16) / 255;
    const b = parseInt(v.slice(4, 6), 16) / 255;
    return { color: rgb(r, g, b), opacity: 1 };
  }

  const rgba = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => p.trim());
    const r = Math.max(0, Math.min(255, Number(parts[0]) || 0)) / 255;
    const g = Math.max(0, Math.min(255, Number(parts[1]) || 0)) / 255;
    const b = Math.max(0, Math.min(255, Number(parts[2]) || 0)) / 255;
    const a = parts.length > 3 ? Math.max(0, Math.min(1, Number(parts[3]) || 0)) : 1;
    return { color: rgb(r, g, b), opacity: a };
  }

  return { color: rgb(1, 0.92, 0.23), opacity: 1 };
}

function toPdfPoint(nx, ny, width, height) {
  const x = Math.max(0, Math.min(1, Number(nx) || 0)) * width;
  const y = (1 - Math.max(0, Math.min(1, Number(ny) || 0))) * height;
  return { x, y };
}

function toPdfRect(nx, ny, nw, nh, width, height) {
  const x = Math.max(0, Math.min(1, Number(nx) || 0)) * width;
  const yTop = Math.max(0, Math.min(1, Number(ny) || 0)) * height;
  const w = Math.max(0, Math.min(1, Number(nw) || 0)) * width;
  const h = Math.max(0, Math.min(1, Number(nh) || 0)) * height;
  const y = Math.max(0, height - yTop - h);
  return { x, y, w, h };
}

function inferStrokeWidth(pathData, pageWidth) {
  const norm = Number(pathData?.widthNorm);
  if (Number.isFinite(norm) && norm > 0) {
    return Math.max(0.6, norm * pageWidth);
  }
  const abs = Number(pathData?.width);
  if (Number.isFinite(abs) && abs > 0) {
    return Math.max(0.6, abs * 0.8);
  }
  return 1.5;
}

// Legacy export: burns annotations into the page content as drawn shapes (not editable afterwards).
function flattenAnnotations(pdfDoc, annotationsByPage, highlightBoxesByPage) {
  const pages = pdfDoc.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const pageData = annotationsByPage[String(pageNumber)] || annotationsByPage[pageNumber] || { paths: [], stickyNotes: [] };
    const highlightBoxes = highlightBoxesByPage[String(pageNumber)] || highlightBoxesByPage[pageNumber] || [];

    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const paths = Array.isArray(pageData.paths) ? pageData.paths : [];
    const stickyNotes = Array.isArray(pageData.stickyNotes) ? pageData.stickyNotes : [];
    if (paths.length === 0 && stickyNotes.length === 0 && highlightBoxes.length === 0) {
      continue;
    }

    for (const pathData of paths) {
      const points = Array.isArray(pathData.points) ? pathData.points : [];
      if (points.length < 2) continue;

      const { color, opacity } = parseColor(pathData.color);
      const thickness = inferStrokeWidth(pathData, width);

      for (let i = 1; i < points.length; i += 1) {
        const p1 = points[i - 1];
        const p2 = points[i];
        const a = toPdfPoint(p1.x, p1.y, width, height);
        const b = toPdfPoint(p2.x, p2.y, width, height);

        page.drawLine({
          start: a,
          end: b,
          thickness,
          color,
          opacity: Math.max(0.1, Math.min(1, opacity ?? pathData.alpha ?? 1))
        });
      }
    }

    // Render AI highlights as translucent rectangles
    for (const box of highlightBoxes) {
      const rect = toPdfRect(box.x, box.y, box.w, box.h, width, height);
      if (rect.w <= 0 || rect.h <= 0) continue;
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        color: rgb(1, 0.92, 0.35),
        opacity: 0.35
      });
    }

    for (const note of stickyNotes) {
      const p = toPdfPoint(note.x, note.y, width, height);
      const boxW = Math.max(100, Math.min(220, width * 0.24));
      const boxH = 44;
      const yBottom = Math.max(6, p.y - boxH + 8);
      const xLeft = Math.max(6, Math.min(width - boxW - 6, p.x - 12));
      const text = String(note.text || '').replace(/\s+/g, ' ').trim().slice(0, 280) || 'Note';

      page.drawRectangle({
        x: xLeft,
        y: yBottom,
        width: boxW,
        height: boxH,
        color: rgb(1, 0.94, 0.55),
        opacity: 0.9,
        borderColor: rgb(0.55, 0.46, 0.1),
        borderWidth: 0.8
      });

      page.drawText(text, {
        x: xLeft + 6,
        y: yBottom + boxH - 15,
        size: 9,
        color: rgb(0.24, 0.22, 0.12),
        maxWidth: boxW - 10,
        lineHeight: 10
      });
    }
  }
}


ipcMain.on('storage:getItem', getItemSync);
ipcMain.on('storage:setItem', setItemSync);
ipcMain.on('storage:removeItem', removeItemSync);


// Keep Chromium cache under this app's writable userData to avoid Windows cache permission issues.
const sessionDataPath = path.join(app.getPath('userData'), 'session-data');
const diskCachePath = path.join(sessionDataPath, 'disk-cache');
app.setPath('sessionData', sessionDataPath);
app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);

const windows = new Set();
let snipWindow = null;
let snippingRequestorWindow = null;


// Title bar colours follow the app theme (they match --bg in renderer/css/tokens.css).
const TITLEBAR_THEMES = {
  light: { color: '#f4f1e9', symbolColor: '#1c1b2e', height: 44 },
  dark: { color: '#121120', symbolColor: '#f3f0e6', height: 44 }
};

function currentThemeName() {
  return getItemDirect('smartpdf.theme') === 'light' ? 'light' : 'dark';
}

function createMainWindow(filePath = null) {
  const theme = currentThemeName();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    icon: path.join(__dirname, 'renderer/assets/brand/app-icon-256.png'),
    backgroundColor: TITLEBAR_THEMES[theme].color,
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLEBAR_THEMES[theme],
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });

  windows.add(win);

  win.on('closed', () => {
    windows.delete(win);
  });

  if (filePath) {
    win.loadFile('renderer/index.html', {
      query: { open: filePath }
    });
  } else {
    win.loadFile('renderer/index.html');
  }

  return win;
}

function registerIpcHandlers() {
  ipcMain.handle('window:create', (event, filePath) => {
    createMainWindow(filePath);
    return true;
  });

  ipcMain.handle('dialog:openPDF', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('dialog:pickPdfs', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    });
    return canceled ? [] : filePaths;
  });

  // Export an artifact as PDF, PNG, Word or PowerPoint. The page is only ever drawn in a hidden window that has no
  // preload, a policy that refuses everything but styles and data images, and no way to leave the page.
  const EXPORTS = {
    pdf: { name: 'PDF document', ext: 'pdf' },
    png: { name: 'PNG image', ext: 'png' },
    docx: { name: 'Word document', ext: 'docx' },
    pptx: { name: 'PowerPoint presentation', ext: 'pptx' }
  };
  const EXPORT_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

  async function renderExportPage(html, width) {
    const win = new BrowserWindow({
      show: false, width, height: 800, useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: `artifact-export-${Date.now()}` }
    });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const page = String(html).includes('<head>') ? String(html).replace('<head>', `<head>${EXPORT_POLICY}`) : `${EXPORT_POLICY}${html}`;
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(page).toString('base64')}`);
    await win.webContents.insertCSS('::-webkit-scrollbar { display: none }');
    return win;
  }

  async function capturePage(html, width = 900) {
    const win = await renderExportPage(html, width);
    try {
      const height = await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
      win.setContentSize(width, Math.min(Math.max(height, 100), 8000));
      await new Promise((r) => setTimeout(r, 150));
      const image = await win.webContents.capturePage();
      return image.toPNG();
    } finally {
      win.destroy();
    }
  }

  ipcMain.handle('art:export', async (event, req) => {
    try {
      const format = String(req?.format || '');
      const kind = EXPORTS[format];
      if (!kind) return { ok: false, error: 'Unknown format' };
      const html = String(req?.html || '');
      if (!html.trim() || html.length > 2000000) return { ok: false, error: 'There is nothing to export.' };
      const title = String(req?.title || 'artifact').slice(0, 120);

      let data;
      if (format === 'png') {
        data = await capturePage(html);
      } else if (format === 'pdf') {
        const win = await renderExportPage(html, 900);
        try {
          data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: req?.kindOfArtifact === 'slides' });
        } finally {
          win.destroy();
        }
      } else {
        const builders = require('./artifact-export');
        const image = req?.withImage ? (await capturePage(html)).toString('base64') : '';
        if (format === 'docx') {
          const blocks = Array.isArray(req?.blocks) ? req.blocks.slice() : [];
          if (image) blocks.push({ t: 'img', data: image });
          data = await builders.buildDocx({ title, blocks });
        } else {
          const slides = Array.isArray(req?.slides) ? req.slides.map((x) => ({ ...x })) : [];
          if (image && slides.length <= 1) {
            if (!slides.length) slides.push({ title, bullets: [] });
            slides[0].image = image;
          }
          data = await builders.buildPptx({ title, slides });
        }
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      const safe = title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'artifact';
      // automated tests (development runs only) name a folder instead of answering the dialog
      const testDir = !app.isPackaged && process.env.THINKER_TEST_EXPORT_DIR;
      const { canceled, filePath } = testDir
        ? { canceled: false, filePath: path.join(testDir, `${safe}.${kind.ext}`) }
        : await dialog.showSaveDialog(win, {
          defaultPath: `${safe}.${kind.ext}`,
          filters: [{ name: kind.name, extensions: [kind.ext] }]
        });
      if (canceled || !filePath) return { ok: false, canceled: true };
      await fsPromises.writeFile(filePath, data);
      return { ok: true, filePath };
    } catch (error) {
      console.error('Failed to export artifact:', error);
      return { ok: false, error: error.message || 'Export failed' };
    }
  });

  ipcMain.handle('dialog:saveTextFile', async (event, payload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: payload?.defaultPath || 'mindmap.svg',
        filters: payload?.filters || [{ name: 'All Files', extensions: ['*'] }]
      });

      if (canceled || !filePath) {
        return { ok: false, canceled: true };
      }

      await fsPromises.writeFile(filePath, payload?.content || '', 'utf8');
      return { ok: true, filePath };
    } catch (error) {
      console.error('Failed to save text file:', error);
      return { ok: false, error: error.message || 'Save failed' };
    }
  });

  ipcMain.handle('llm:generate', handleLLMGenerate);

  ipcMain.handle('chat:loadHistory', async (_event, pdfPath) => {
    if (!pdfPath) return [];
    const [latest] = store.listConversations(pdfPath);
    return latest ? store.getMessages(latest.id) : [];
  });

  ipcMain.handle('chat:appendEntry', async (_event, payload) => {
    if (!payload || !payload.pdfPath || !payload.entry) {
      return false;
    }
    const conversation = store.listConversations(payload.pdfPath)[0] || store.createConversation(payload.pdfPath);
    store.appendMessage(conversation.id, payload.entry);
    return true;
  });

  ipcMain.handle('pdf:getPdfId', (_event, filePath) => {
    const id = store.docIdForPath(filePath);
    return id && !id.startsWith('missing-') ? id : null;
  });

  ipcMain.handle('app:getUserDataPath', async () => {
    const embeddingsPath = path.join(app.getPath('userData'), 'embeddings');
    await fsPromises.mkdir(embeddingsPath, { recursive: true });
    return embeddingsPath;
  });

  ipcMain.handle('pdf:saveAnnotated', async (event, payload) => {
    try {
      const sourcePath = toLocalPath(payload?.pdfPath);
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        return { ok: false, error: 'Source PDF not found.' };
      }

      const annotationsByPage = payload?.annotationsByPage || {};
      const highlightBoxesByPage = payload?.highlightBoxesByPage || {};
      const inputBytes = await fsPromises.readFile(sourcePath);
      const pdfDoc = await PDFDocument.load(inputBytes);
      const pages = pdfDoc.getPages();

      if (payload?.flatten) {
        flattenAnnotations(pdfDoc, annotationsByPage, highlightBoxesByPage);
      } else {
        writeRealAnnotations(pdfDoc, annotationsByPage, highlightBoxesByPage, { author: payload?.author });
      }

      // Append detailed notes (if any) as extra pages at the end of the PDF
      try {
        if (payload?.includeNotes !== false) {
          {
            const notesArr = store.loadNotes(sourcePath);

            if (Array.isArray(notesArr) && notesArr.length > 0) {
              // Use first page size as reference, or A4 fallback
              const ref = pages.length > 0 ? pages[0].getSize() : { width: 595, height: 842 };
              const pageWidth = ref.width || 595;
              const pageHeight = ref.height || 842;

              // Prepare text lines
              const header = `Research Notes (${notesArr.length})`;
              let bodyLines = [];
              notesArr.forEach((n, idx) => {
                const when = n.date ? new Date(n.date).toLocaleString() : '';
                const source = n.source ? `(${n.source})` : '';
                const title = `Note ${idx + 1} ${source} ${when}`.trim();
                bodyLines.push(title);
                const content = String(n.content || '').replace(/\r/g, '').split(/\n/).map(l => l.trim());
                content.forEach(line => {
                  // wrap long lines at ~80 chars
                  if (line.length <= 120) {
                    bodyLines.push(line);
                  } else {
                    let pos = 0;
                    while (pos < line.length) {
                      bodyLines.push(line.slice(pos, pos + 120));
                      pos += 120;
                    }
                  }
                });
                bodyLines.push('');
              });

              // Create pages and write lines
              const linesPerPage = Math.floor((pageHeight - 80) / 12);
              let currentPage = null;
              let currentLines = 0;
              for (let i = 0; i < bodyLines.length; i += 1) {
                if (!currentPage || currentLines >= linesPerPage) {
                  currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                  currentLines = 0;
                  // Header for first line on new page
                  if (currentLines === 0) {
                    currentPage.drawText(header, { x: 40, y: pageHeight - 40, size: 14, color: rgb(0, 0, 0) });
                    currentLines += 2;
                  }
                }
                const y = pageHeight - 40 - (currentLines * 12) - 16;
                currentPage.drawText(bodyLines[i] || '', { x: 40, y, size: 10, color: rgb(0, 0, 0), lineHeight: 12, maxWidth: pageWidth - 80 });
                currentLines += 1;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to append detailed notes to PDF export:', e);
      }

      const parsed = path.parse(sourcePath);
      const defaultPath = path.join(parsed.dir, `${parsed.name}-annotated.pdf`);
      const win = BrowserWindow.fromWebContents(event.sender);
      const dialogResult = await dialog.showSaveDialog(win, {
        defaultPath,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });

      if (dialogResult.canceled || !dialogResult.filePath) {
        return { ok: false, canceled: true };
      }

      const outBytes = await pdfDoc.save();
      await fsPromises.writeFile(dialogResult.filePath, outBytes);
      return { ok: true, filePath: dialogResult.filePath };
    } catch (error) {
      console.error('Failed to save annotated PDF:', error);
      return { ok: false, error: error.message || 'Failed to save annotated PDF.' };
    }
  });

  // Help links open in the default browser, but only for a short list of known HTTPS pages.
  ipcMain.handle('shell:openExternal', async (_event, url) => {
    if (!isAllowedExternalUrl(url)) return false;
    await shell.openExternal(String(url));
    return true;
  });

  // Keeps the native window controls in step with the app theme.
  ipcMain.handle('theme:set', (event, theme) => {
    const colors = TITLEBAR_THEMES[theme === 'light' ? 'light' : 'dark'];
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed() && typeof win.setTitleBarOverlay === 'function') win.setTitleBarOverlay(colors);
    return true;
  });

  // Settings registry values
  const SETTING_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
  const SETTING_SCOPES = new Set(['app', 'workspace', 'document']);
  ipcMain.handle('settings:getAll', () => store.getSettings());
  ipcMain.handle('settings:set', (_event, key, scope, scopeId, value) => {
    if (!SETTING_KEY.test(String(key)) || !SETTING_SCOPES.has(scope)) return false;
    store.setSetting(key, scope, String(scopeId || ''), value);
    return true;
  });
  ipcMain.handle('settings:reset', (_event, key, scope, scopeId) => {
    if (!SETTING_KEY.test(String(key)) || !SETTING_SCOPES.has(scope)) return false;
    store.resetSetting(key, scope, String(scopeId || ''));
    return true;
  });

  // Conversations (several chats per document)
  ipcMain.handle('conv:list', (_event, pdfPath) => (pdfPath ? store.listConversations(pdfPath) : []));
  ipcMain.handle('conv:create', (_event, pdfPath, fields) => store.createConversation(pdfPath, fields || {}));
  ipcMain.handle('conv:update', (_event, id, patch) => store.updateConversation(String(id), patch || {}));
  ipcMain.handle('conv:delete', (_event, id) => {
    store.deleteConversation(String(id));
    return true;
  });
  ipcMain.handle('conv:messages', (_event, id) => store.getMessages(String(id)));
  ipcMain.handle('conv:append', (_event, id, entry) => store.appendMessage(String(id), entry || {}));

  // Thinker Remote: share one artifact or project on the local network. Off until asked.
  const remote = createRemoteServer({ appRoot: __dirname });
  let texApi = null;
  const lanAddresses = () => Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  remote.events.on('change', () => {
    for (const win of BrowserWindow.getAllWindows()) { try { win.webContents.send('remote:changed'); } catch { /* closing */ } }
  });
  app.on('before-quit', () => { remote.stop(); });
  const remoteView = () => ({ running: remote.running, address: remote.address, lan: lanAddresses(), shares: remote.listShares() });
  const shareLinks = (share) => {
    const a = remote.address;
    if (!a) return [];
    const hosts = a.host === '127.0.0.1' ? ['127.0.0.1'] : lanAddresses();
    return hosts.map((h) => `http://${h}:${a.port}/s/${share.token}/`);
  };
  ipcMain.handle('remote:status', () => {
    const view = remoteView();
    return { ...view, shares: view.shares.map((s) => ({ ...s, urls: shareLinks(s) })) };
  });
  ipcMain.handle('remote:share', async (_e, req) => {
    const kind = String(req?.kind || '');
    const ref = String(req?.id || '');
    const local = req?.scope === 'local';
    const ttlMs = Math.max(0.25, Math.min(Number(req?.hours) || 4, 24)) * 3600 * 1000;
    let provider;
    let title;
    let collab = null;
    if (kind === 'artifact') {
      const found = artifacts().get(ref);
      if (!found) throw new Error('That artifact no longer exists.');
      title = found.title;
      provider = { content: async () => ({ type: 'html', html: artifacts().get(ref)?.html || '' }) };
    } else if (kind === 'tex') {
      const found = spaces().getProject(ref);
      if (!found) throw new Error('That project no longer exists.');
      title = found.name;
      if (req?.allowEdit) {
        collab = createCollab({ root: found.rootPath, onError: (error) => console.error('[collab]', error.message) });
      }
      provider = {
        compile: async () => {
          const result = await texApi.compileProject(found.id);
          if (result?.notReady) return result;
          for (const win of BrowserWindow.getAllWindows()) { try { win.webContents.send('remote:built', { projectId: found.id, ok: result.ok, problems: result.problems, log: result.log, durationMs: result.durationMs }); } catch { /* closing */ } }
          if (result.ok) remote.bumpRef('tex', found.id);
          return result;
        },
        content: async () => ({
          type: 'pdf',
          file: path.join(app.getPath('userData'), 'ThinkerTex', 'builds', found.id, path.basename(found.mainFile).replace(/\.tex$/i, '.pdf'))
        })
      };
    } else {
      throw new Error('That cannot be shared.');
    }
    if (remote.running && remote.address.host === '127.0.0.1' && !local) await remote.stop();
    await remote.start({ bindHost: local ? '127.0.0.1' : '0.0.0.0' });
    const made = remote.createShare({ kind, title, ref, provider, ttlMs, collab, allowEdit: Boolean(req?.allowEdit && collab) });
    return { ...made, urls: shareLinks({ token: made.token }), lan: lanAddresses(), local };
  });
  ipcMain.handle('remote:end', async (_e, id) => {
    const ended = remote.endShare(String(id));
    if (!remote.listShares().length) await remote.stop();
    return ended;
  });
  ipcMain.handle('remote:stopAll', async () => { await remote.stop(); return true; });

  // The host's own editor joins the shared copy of a file, so host and guests edit the same text.
  const hostDocs = new Map(); // `${projectId}:${rel}` -> { entry, collab, off }
  const hostKey = (projectId, rel) => `${projectId}:${rel}`;
  ipcMain.handle('collab:open', (event, projectId, rel) => {
    const collab = remote.collabFor('tex', String(projectId));
    if (!collab) return null;
    const key = hostKey(projectId, rel);
    if (hostDocs.has(key)) { collab.release(hostDocs.get(key).entry); hostDocs.get(key).off(); hostDocs.delete(key); }
    const entry = collab.open(String(rel));
    const send = (channel, payload) => { try { if (!event.sender.isDestroyed()) event.sender.send(channel, payload); } catch { /* closing */ } };
    const onUpdate = (update, origin) => { if (origin !== 'host') send('collab:update', { projectId, rel, update }); };
    const onAwareness = ({ added, updated, removed }, origin) => {
      if (origin === 'host') return;
      send('collab:awareness', { projectId, rel, update: awarenessProtocol.encodeAwarenessUpdate(entry.awareness, added.concat(updated, removed)) });
    };
    entry.listeners.add(onUpdate);
    entry.awareness.on('update', onAwareness);
    hostDocs.set(key, { entry, collab, off: () => { entry.listeners.delete(onUpdate); entry.awareness.off('update', onAwareness); } });
    return {
      state: Y.encodeStateAsUpdate(entry.doc),
      awareness: awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...entry.awareness.getStates().keys()])
    };
  });
  ipcMain.handle('collab:update', (_e, projectId, rel, update) => {
    const held = hostDocs.get(hostKey(projectId, rel));
    if (held && !held.entry.dead) Y.applyUpdate(held.entry.doc, new Uint8Array(update), 'host');
    return true;
  });
  ipcMain.handle('collab:awareness', (_e, projectId, rel, update) => {
    const held = hostDocs.get(hostKey(projectId, rel));
    if (held && !held.entry.dead) awarenessProtocol.applyAwarenessUpdate(held.entry.awareness, new Uint8Array(update), 'host');
    return true;
  });
  ipcMain.handle('collab:close', (_e, projectId, rel) => {
    const key = hostKey(projectId, rel);
    const held = hostDocs.get(key);
    if (!held) return false;
    held.off();
    held.collab.release(held.entry);
    hostDocs.delete(key);
    return true;
  });

  // ThinkerTex: the engine ships next to the app when packaged, and in vendor/ while developing.
  texApi = registerTexIpc({
    ipcMain, dialog, shell, BrowserWindow, app, spaces, onBuilt: (projectId) => remote.bumpRef('tex', projectId),
    enginePath: app.isPackaged ? path.join(process.resourcesPath, 'tectonic', 'tectonic.exe') : path.join(__dirname, 'vendor', 'tectonic', 'tectonic.exe')
  });

  // Thinkspaces and ThinkerTex projects. Every call validates its arguments; nothing here touches files.
  const text = (v) => String(v ?? '');
  const paths = (v) => (Array.isArray(v) ? v.map(text).slice(0, 500) : []);
  ipcMain.handle('wsconv:list', (_e, id) => store.listWorkspaceConversations(text(id)));
  ipcMain.handle('wsconv:create', (_e, id, fields) => store.createWorkspaceConversation(text(id), fields || {}));
  ipcMain.handle('ws:list', () => spaces().listWorkspaces());
  ipcMain.handle('ws:get', (_e, id) => spaces().getWorkspace(text(id)));
  ipcMain.handle('ws:create', (_e, fields) => spaces().createWorkspace(fields || {}));
  ipcMain.handle('ws:update', (_e, id, patch) => spaces().updateWorkspace(text(id), patch || {}));
  ipcMain.handle('ws:delete', (_e, id) => spaces().deleteWorkspace(text(id)));
  ipcMain.handle('ws:opened', (_e, id) => { spaces().markOpened(text(id)); return true; });
  ipcMain.handle('ws:addDocuments', (_e, id, files) => spaces().addDocuments(text(id), paths(files)));
  ipcMain.handle('ws:removeDocument', (_e, id, docId) => spaces().removeDocument(text(id), text(docId)));
  ipcMain.handle('ws:reorderDocuments', (_e, id, order) => spaces().reorderDocuments(text(id), paths(order)));
  ipcMain.handle('ws:forDocument', (_e, docId) => spaces().workspacesForDocument(text(docId)));
  ipcMain.handle('art:list', (_e, filter) => artifacts().list(filter || {}));
  ipcMain.handle('art:get', (_e, id) => artifacts().get(text(id)));
  ipcMain.handle('art:create', (_e, fields) => artifacts().create(fields || {}));
  ipcMain.handle('art:update', (_e, id, patch) => artifacts().update(text(id), patch || {}));
  ipcMain.handle('art:delete', (_e, id) => artifacts().remove(text(id)));
  ipcMain.handle('proj:list', () => spaces().listProjects());
  ipcMain.handle('proj:get', (_e, id) => spaces().getProject(text(id)));
  ipcMain.handle('proj:update', (_e, id, patch) => spaces().updateProject(text(id), patch || {}));
  ipcMain.handle('proj:forget', (_e, id) => spaces().forgetProject(text(id)));
  ipcMain.handle('proj:link', (_e, workspaceId, projectId) => spaces().linkProject(text(workspaceId), text(projectId)));
  ipcMain.handle('proj:unlink', (_e, workspaceId, projectId) => spaces().unlinkProject(text(workspaceId), text(projectId)));
  ipcMain.handle('proj:forProject', (_e, id) => spaces().workspacesForProject(text(id)));

  // Custom AI instructions, layered global -> document -> conversation
  ipcMain.handle('ins:list', (_event, scope, scopeId) => store.listInstructions(scope || null, scopeId || null));
  ipcMain.handle('ins:save', (_event, fields) => store.saveInstruction(fields || {}));
  ipcMain.handle('ins:delete', (_event, id) => {
    store.deleteInstruction(String(id));
    return true;
  });
  ipcMain.handle('ins:resolve', (_event, pdfPath, conversationId) => {
    const layers = store.listInstructions('global', '').filter((i) => i.enabled);
    const docId = pdfPath ? store.docIdForPath(pdfPath) : null;
    if (docId) layers.push(...store.listInstructions('document', docId).filter((i) => i.enabled));
    const conversation = conversationId ? store.getConversation(String(conversationId)) : null;
    // a Thinkspace chat also gets the Thinkspace's own instructions, between the global and the chat's
    if (conversation?.workspaceId) {
      layers.splice(layers.length, 0, ...store.listInstructions('workspace', conversation.workspaceId).filter((i) => i.enabled));
    }
    const result = layers.map(({ scope, title, body }) => ({ scope, title, body }));
    if (conversation?.instructions?.trim()) {
      result.push({ scope: 'conversation', title: '', body: conversation.instructions });
    }
    return result;
  });
  ipcMain.handle('doc:id', (_event, pdfPath) => (pdfPath ? store.docIdForPath(pdfPath) : null));

  // Notes persistence handlers
  ipcMain.handle('notes:load', async (_event, pdfPath) => {
    try {
      return store.loadNotes(pdfPath);
    } catch (e) {
      console.error('Failed to load notes:', e);
      return [];
    }
  });
  ipcMain.handle('notes:save', async (_event, pdfPath, notes) => {
    try {
      store.saveNotes(pdfPath, notes);
      return true;
    } catch (e) {
      console.error('Failed to save notes:', e);
      return false;
    }
  });

  // Mindmaps persistence per-PDF
  ipcMain.handle('mindmaps:list', async (_event, pdfPath) => {
    try {
      return store.listMindmaps(pdfPath);
    } catch (e) {
      console.error('Failed to list mindmaps:', e);
      return [];
    }
  });

  ipcMain.handle('mindmaps:save', async (_event, pdfPath, mindmap) => {
    try {
      return { ok: true, result: store.saveMindmap(pdfPath, mindmap) };
    } catch (e) {
      console.error('Failed to save mindmap:', e);
      return { ok: false };
    }
  });

  ipcMain.handle('mindmaps:delete', async (_event, pdfPath, id) => {
    try {
      store.deleteMindmap(pdfPath, id);
      return { ok: true };
    } catch (e) {
      console.error('Failed to delete mindmap:', e);
      return { ok: false };
    }
  });

  ipcMain.handle('dict:define', async (_event, { word, context, apiKey, model, profile }) => {
    if (!apiKey && (!profile || !profile.key)) {
      return { ok: false, error: 'Missing API key. Select a saved AI profile first.' };
    }

    try {
      const requestProfile = profile && typeof profile === 'object'
        ? { ...profile, key: profile.key || apiKey, model: profile.model || model || 'gemini-3.5-flash-lite' }
        : { format: 'gemini', key: apiKey, model: model || 'gemini-3.5-flash-lite' };

      const apiFormat = requestProfile.format || 'gemini';
      const apiUrl    = requestProfile.url    || '';
      const effectiveKey = requestProfile.key || apiKey || '';

      const prompt = [
        'You are a dictionary assistant for a PDF reader.',
        'Return ONLY valid JSON with keys: term, definition, source.',
        'Use source="llm".',
        `Term: ${word}`,
        `Context: ${context || ''}`,
        'Definition should be concise, accurate, and specific to the selected term.'
      ].join('\n');

      const result = await handleLLMGenerate(null, {
        profile: requestProfile,
        parts: [{ text: prompt }]
      });

      if (!result?.ok) {
        return { ok: false, error: result?.error || 'Definition lookup failed' };
      }

      const rawText = String(result.text || '').trim();
      const jsonText = rawText.startsWith('```')
        ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
        : rawText;

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        parsed = {
          term: word,
          definition: rawText,
          source: 'llm'
        };
      }

      return { ok: true, result: parsed };
    } catch (error) {
      console.error('Definition lookup failed:', error);
      return { ok: false, error: error.message || 'Definition lookup failed' };
    }
  });

  // Requests in flight, so the chat's Stop button can abandon one.
  const inflightAgentCalls = new Map();

  ipcMain.handle('agent:invoke', async (_event, data) => {
    const requestId = String(data?.requestId || '');
    const controller = new AbortController();
    if (requestId) inflightAgentCalls.set(requestId, controller);
    try {
      const response = await backendPost('/agent/invoke', resolveSecrets(data), controller.signal);
      return { ok: true, result: response.data };
    } catch (error) {
      if (axios.isCancel(error) || error.code === 'ERR_CANCELED') {
        return { ok: false, cancelled: true, error: 'Stopped.' };
      }
      console.error('Agent invocation failed:', error);
      const timedOut = error.code === 'ECONNABORTED';
      return { ok: false, error: timedOut ? 'The AI took too long to answer. Please try again.' : error.message };
    } finally {
      if (requestId) inflightAgentCalls.delete(requestId);
    }
  });

  ipcMain.handle('agent:cancel', (_event, requestId) => {
    inflightAgentCalls.get(String(requestId))?.abort();
    return true;
  });

  ipcMain.handle('agent:summarizeCache', async (_event, data) => {
    try {
      const response = await backendPost('/agent/summarize-cache', resolveSecrets(data));
      return { ok: true, result: response.data };
    } catch (error) {
      console.error('Cache summarization failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('tokens:append', async (_event, entry) => {
    try {
      store.appendUsage(entry);
      return { ok: true };
    } catch (error) {
      console.error('Failed to append token usage:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('tokens:getHistory', async () => {
    try {
      return store.readUsage();
    } catch (error) {
      console.error('Failed to read token usage:', error);
      return [];
    }
  });

  ipcMain.handle('glossary:get', async () => {
    try {
      return store.getGlossary();
    } catch (error) {
      console.error('Failed to get glossary:', error);
      return { terms: [], pdfGlossaries: {} };
    }
  });

  ipcMain.handle('glossary:add', async (_event, payload) => {
    try {
      store.addGlossaryTerm(payload);
      return true;
    } catch (error) {
      console.error('Failed to add to glossary:', error);
      return false;
    }
  });

  ipcMain.handle('glossary:remove', async (_event, term) => {
    try {
      store.removeGlossaryTerm(term);
      return true;
    } catch (error) {
      console.error('Failed to remove from glossary:', error);
      return false;
    }
  });
}

// Global security lockdown: block DevTools globally in production for all windows
app.on('web-contents-created', (event, contents) => {
  // A file dropped on the window, or a stray link, must never replace the app with another page.
  const appPages = pathToFileURL(path.join(__dirname, 'renderer')).href;
  contents.on('will-navigate', (navEvent, url) => {
    if (!url.startsWith(appPages)) navEvent.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (app.isPackaged) {
    contents.on('before-input-event', (e, input) => {
      if (
        input.key === 'F12' ||
        (input.control && input.shift && (input.key === 'I' || input.key === 'J' || input.key === 'C'))
      ) {
        e.preventDefault();
      }
    });
    contents.on('devtools-opened', () => {
      contents.closeDevTools();
    });
  }
});

function parsePdfPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-') || arg === '.') continue;
    if (arg.toLowerCase().endsWith('.pdf')) {
      try {
        const fullPath = path.resolve(arg);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      } catch (e) {
        console.warn('Failed to resolve arg path:', arg, e);
      }
    }
  }
  return null;
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  let startupPdfPath = parsePdfPathFromArgv(process.argv);

  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const activeWin = BrowserWindow.getFocusedWindow() || Array.from(windows)[0];
    if (activeWin) {
      if (activeWin.isMinimized()) activeWin.restore();
      activeWin.focus();

      const pdfPath = parsePdfPathFromArgv(commandLine);
      if (pdfPath) {
        activeWin.webContents.send('open-pdf', pdfPath);
      }
    } else {
      const pdfPath = parsePdfPathFromArgv(commandLine);
      createMainWindow(pdfPath);
    }
  });

  // ── App startup flow ─────────────────────────────────────────────────────────
  app.whenReady().then(async () => {
    artifactProtocol.handleScheme(protocol, __dirname);
    // Hide application menu in production to prevent keyboard shortcut DevTools access
    if (app.isPackaged) {
      Menu.setApplicationMenu(null);
    }

    // Open the database first: everything else (splash theme, profiles, IPC handlers) reads from it.
    store = createStore(openDatabase(app.getPath('userData')));
    initStorage(store);
    try {
      const imported = importLegacyData(store, app.getPath('userData'));
      if (!imported.skipped) console.log('[storage] imported legacy data:', JSON.stringify(imported.report));
    } catch (error) {
      console.error('[storage] legacy import failed; old files are untouched:', error);
    }
    migrateProfileSecrets();

    // Register all IPC handlers once
    registerIpcHandlers();

    // 1. Show splash immediately
    createSplash();

    // 2. Start backend (exe or venv fallback) on a random local port
    BACKEND_PORT = await pickFreePort();
    BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
    startBackend();

    // 3. Wait until /health returns ok (up to 60 s)
    const ready = await waitForBackend(60_000);
    if (!ready) {
      console.warn('[startup] Backend did not become healthy within 60 s – opening anyway.');
    } else {
      // Signal the splash to animate to 100%
      if (splashWindow && !splashWindow.isDestroyed()) {
        await splashWindow.webContents.executeJavaScript('window.onBackendReady && window.onBackendReady()').catch(() => {});
        await new Promise(r => setTimeout(r, 500)); // brief pause so the user sees "Ready"
      }
    }

    // 4. Open the main window
    createMainWindow(startupPdfPath);

    // 5. Close splash
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });
}

app.on('window-all-closed', () => {
  // Kill the backend process when the app closes
  if (backendProcess) {
    try { backendProcess.kill(); } catch { /* ignore */ }
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

// 🖼️ Trigger snipping tool from renderer
ipcMain.on('open-snipping-tool', (event) => {
  snippingRequestorWindow = BrowserWindow.fromWebContents(event.sender);
  snipWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    fullscreen: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer/snipper-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });

  snipWindow.loadFile(path.join(__dirname, 'renderer/snipper.html'));
});

// 📤 Once snipping is done and image data is ready
ipcMain.on('snip-complete', (event, dataUrl) => {
  if (snippingRequestorWindow && !snippingRequestorWindow.isDestroyed()) {
    snippingRequestorWindow.webContents.send('image-snipped', dataUrl);
  }
  if (snipWindow) {
    snipWindow.close();
    snipWindow = null;
  }
});

// axios is required at the top of the file

ipcMain.handle('pdf:index', async (_event, data) => {
  try {
    const response = await backendPost('/index', data);
    return { ok: true, result: response.data };
  } catch (error) {
    console.error('Indexing failed:', error);
    return { ok: false, error: error.message || 'Indexing failed' };
  }
});

ipcMain.handle('pdf:query', async (_event, data) => {
  try {
    const response = await backendPost('/query', data);
    return { ok: true, result: response.data };
  } catch (error) {
    console.error('Query failed:', error);
    return { ok: false, error: error.message || 'Query failed' };
  }
});
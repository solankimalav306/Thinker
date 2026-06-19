const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const { spawn } = require('child_process');
const axios = require('axios');
require('dotenv').config();

const { getItemSync, setItemSync, removeItemSync, getItemDirect } = require('./app-storage');
const { handleLLMGenerate } = require('./llm-handler');

// ── Backend process handle (so we can kill it cleanly on exit) ──────────────
let backendProcess = null;

// ── Spawn the Python/compiled backend ───────────────────────────────────────
function startBackend() {
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
    console.log('[backend] Launching backend.exe:', exePath);
    backendProcess = spawn(exePath, [], { detached: false });
  } else {
    // Dev fallback: use the venv uvicorn
    console.log('[backend] backend.exe not found – falling back to venv uvicorn');
    const venvPython = path.join(__dirname, 'venv', 'Scripts', 'python.exe');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python';
    backendProcess = spawn(
      pythonBin,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'],
      { cwd: path.join(__dirname, 'agent-handler'), detached: false }
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
      const res = await axios.get('http://127.0.0.1:8000/health', { timeout: 2000 });
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
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  
  splashWindow.loadFile('renderer/splash.html', {
    query: { theme, palette, customAccent }
  });
}

function getPdfId(filePath) {
  try {
    // Convert file:// URL to local path if needed
    let localPath = filePath;
    if (filePath.startsWith('file:///')) {
      localPath = filePath.replace('file:///', '').replace(/\//g, '\\');
    } else if (filePath.startsWith('file://')) {
      localPath = filePath.replace('file://', '');
    }

    console.log('Computing PDF ID for:', localPath);
    const buffer = fs.readFileSync(localPath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log('PDF ID computed:', hash);
    return hash;
  } catch (error) {
    console.error('Failed to compute PDF ID for', filePath, ':', error.message);
    return null;
  }
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

ipcMain.on('storage:getItem', getItemSync);
ipcMain.on('storage:setItem', setItemSync);
ipcMain.on('storage:removeItem', removeItemSync);


// Keep Chromium cache under this app's writable userData to avoid Windows cache permission issues.
const sessionDataPath = path.join(app.getPath('userData'), 'session-data');
const diskCachePath = path.join(sessionDataPath, 'disk-cache');
app.setPath('sessionData', sessionDataPath);
app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);

let mainWindow;  // track your main window globally
let snipWindow;  // track snipping tool window


function getChatHistoryDir() {
  return path.join(app.getPath('userData'), 'chat-history');
}

function getPdfChatPath(pdfPath) {
  const hash = crypto.createHash('sha256').update(pdfPath).digest('hex');
  return path.join(getChatHistoryDir(), `${hash}.jsonl`);
}

async function readJsonl(filePath) {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'renderer/assets/logoWhite.png'),
    backgroundColor: '#0f141c',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f141c',
      symbolColor: '#e8eff9',
      height: 34
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile('renderer/index.html');


  ipcMain.handle('dialog:openPDF', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('dialog:saveTextFile', async (_event, payload) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
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
    const filePath = getPdfChatPath(pdfPath);
    return readJsonl(filePath);
  });

  ipcMain.handle('chat:appendEntry', async (_event, payload) => {
    if (!payload || !payload.pdfPath || !payload.entry) {
      return false;
    }

    const dir = getChatHistoryDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const filePath = getPdfChatPath(payload.pdfPath);
    const line = `${JSON.stringify(payload.entry)}\n`;
    await fsPromises.appendFile(filePath, line, 'utf8');
    return true;
  });

  ipcMain.handle('pdf:getPdfId', (_event, filePath) => {
    return getPdfId(filePath);
  });

  ipcMain.handle('app:getUserDataPath', async () => {
    const embeddingsPath = path.join(app.getPath('userData'), 'embeddings');
    await fsPromises.mkdir(embeddingsPath, { recursive: true });
    return embeddingsPath;
  });

  ipcMain.handle('pdf:saveAnnotated', async (_event, payload) => {
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

      // Append detailed notes (if any) as extra pages at the end of the PDF
      try {
        if (payload?.includeNotes !== false) {
          const pdfId = path.basename(sourcePath, path.extname(sourcePath));
          const notesFile = path.join(app.getPath('userData'), `notes-${pdfId}.json`);
          if (fs.existsSync(notesFile)) {
            const raw = await fsPromises.readFile(notesFile, 'utf8');
            let notesArr = [];
            try { notesArr = JSON.parse(raw); } catch { notesArr = []; }

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
      const dialogResult = await dialog.showSaveDialog(mainWindow, {
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

  // Notes persistence handlers
  ipcMain.handle('notes:load', async (event, pdfPath) => {
    try {
      const userData = app.getPath('userData');
      const pdfId = path.basename(pdfPath, path.extname(pdfPath));
      const notesFile = path.join(userData, `notes-${pdfId}.json`);
      if (fs.existsSync(notesFile)) {
        const data = fs.readFileSync(notesFile, 'utf-8');
        return JSON.parse(data);
      }
      return [];
    } catch (e) {
      return [];
    }
  });
  ipcMain.handle('notes:save', async (event, pdfPath, notes) => {
    try {
      const userData = app.getPath('userData');
      const pdfId = path.basename(pdfPath, path.extname(pdfPath));
      const notesFile = path.join(userData, `notes-${pdfId}.json`);
      fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2), 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  });

  // Mindmaps persistence per-PDF
  ipcMain.handle('mindmaps:list', async (_event, pdfPath) => {
    try {
      const userData = app.getPath('userData');
      const pdfId = crypto.createHash('sha256').update(String(pdfPath)).digest('hex');
      const file = path.join(userData, `mindmaps-${pdfId}.json`);
      if (fs.existsSync(file)) {
        const data = await fsPromises.readFile(file, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (e) {
      console.error('Failed to list mindmaps:', e);
      return [];
    }
  });

  ipcMain.handle('mindmaps:save', async (_event, pdfPath, mindmap) => {
    try {
      const userData = app.getPath('userData');
      const pdfId = crypto.createHash('sha256').update(String(pdfPath)).digest('hex');
      const file = path.join(userData, `mindmaps-${pdfId}.json`);
      let arr = [];
      if (fs.existsSync(file)) {
        arr = JSON.parse(await fsPromises.readFile(file, 'utf8')) || [];
      }
      mindmap.id = mindmap.id || String(Date.now());
      mindmap.createdAt = mindmap.createdAt || new Date().toISOString();
      const idx = arr.findIndex(m => m.id === mindmap.id);
      if (idx > -1) arr[idx] = mindmap; else arr.push(mindmap);
      await fsPromises.writeFile(file, JSON.stringify(arr, null, 2), 'utf8');
      return { ok: true, result: mindmap };
    } catch (e) {
      console.error('Failed to save mindmap:', e);
      return { ok: false };
    }
  });

  ipcMain.handle('mindmaps:delete', async (_event, pdfPath, id) => {
    try {
      const userData = app.getPath('userData');
      const pdfId = crypto.createHash('sha256').update(String(pdfPath)).digest('hex');
      const file = path.join(userData, `mindmaps-${pdfId}.json`);
      let arr = [];
      if (fs.existsSync(file)) {
        arr = JSON.parse(await fsPromises.readFile(file, 'utf8')) || [];
      }
      arr = arr.filter(m => m.id !== id);
      await fsPromises.writeFile(file, JSON.stringify(arr, null, 2), 'utf8');
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
        ? { ...profile, key: profile.key || apiKey, model: profile.model || model || 'gemini-2.0-flash' }
        : { format: 'gemini', key: apiKey, model: model || 'gemini-2.0-flash' };

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

  ipcMain.handle('agent:invoke', async (_event, data) => {
    try {
      const response = await axios.post('http://localhost:8000/agent/invoke', data);
      return { ok: true, result: response.data };
    } catch (error) {
      console.error('Agent invocation failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('glossary:get', async () => {
    try {
      const glossaryFile = path.join(app.getPath('userData'), 'glossary.json');
      if (fs.existsSync(glossaryFile)) {
        const data = await fsPromises.readFile(glossaryFile, 'utf8');
        return JSON.parse(data);
      }
      return { terms: [], pdfGlossaries: {} };
    } catch (error) {
      console.error('Failed to get glossary:', error);
      return { terms: [], pdfGlossaries: {} };
    }
  });

  ipcMain.handle('glossary:add', async (_event, payload) => {
    try {
      const glossaryFile = path.join(app.getPath('userData'), 'glossary.json');
      let glossary = { terms: [], pdfGlossaries: {} };
      
      if (fs.existsSync(glossaryFile)) {
        const data = await fsPromises.readFile(glossaryFile, 'utf8');
        glossary = JSON.parse(data);
      }

      // Handle global vs PDF-specific glossary if needed, for now just global terms
      const existingIndex = glossary.terms.findIndex(t => t.term.toLowerCase() === payload.term.toLowerCase());
      if (existingIndex > -1) {
        glossary.terms[existingIndex] = { ...glossary.terms[existingIndex], ...payload, frequency: (glossary.terms[existingIndex].frequency || 1) + 1 };
      } else {
        glossary.terms.push({ ...payload, dateAdded: new Date().toISOString(), frequency: 1 });
      }

      await fsPromises.writeFile(glossaryFile, JSON.stringify(glossary, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to add to glossary:', error);
      return false;
    }
  });

  ipcMain.handle('glossary:remove', async (_event, term) => {
    try {
      const glossaryFile = path.join(app.getPath('userData'), 'glossary.json');
      if (fs.existsSync(glossaryFile)) {
        const data = await fsPromises.readFile(glossaryFile, 'utf8');
        const glossary = JSON.parse(data);
        glossary.terms = glossary.terms.filter(t => t.term !== term);
        await fsPromises.writeFile(glossaryFile, JSON.stringify(glossary, null, 2), 'utf8');
      }
      return true;
    } catch (error) {
      console.error('Failed to remove from glossary:', error);
      return false;
    }
  });
}

// Global security lockdown: block DevTools globally in production for all windows
app.on('web-contents-created', (event, contents) => {
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

// ── App startup flow ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Hide application menu in production to prevent keyboard shortcut DevTools access
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }

  // 1. Show splash immediately
  createSplash();

  // 2. Start backend (exe or venv fallback)
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
  createMainWindow();

  // 5. Close splash
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
});

app.on('window-all-closed', () => {
  // Kill the backend process when the app closes
  if (backendProcess) {
    try { backendProcess.kill(); } catch { /* ignore */ }
    backendProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

// 🖼️ Trigger snipping tool from renderer
ipcMain.on('open-snipping-tool', () => {
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
    }
  });

  snipWindow.loadFile(path.join(__dirname, 'renderer/snipper.html'));
});

// 📤 Once snipping is done and image data is ready
ipcMain.on('snip-complete', (event, dataUrl) => {
  if (mainWindow) {
    mainWindow.webContents.send('image-snipped', dataUrl);
  }
  if (snipWindow) {
    snipWindow.close();
    snipWindow = null;
  }
});

// axios is required at the top of the file

ipcMain.handle('pdf:index', async (_event, data) => {
  try {
    const response = await axios.post('http://localhost:8000/index', data);
    return { ok: true, result: response.data };
  } catch (error) {
    console.error('Indexing failed:', error);
    return { ok: false, error: error.message || 'Indexing failed' };
  }
});

ipcMain.handle('pdf:query', async (_event, data) => {
  try {
    const response = await axios.post('http://localhost:8000/query', data);
    return { ok: true, result: response.data };
  } catch (error) {
    console.error('Query failed:', error);
    return { ok: false, error: error.message || 'Query failed' };
  }
});
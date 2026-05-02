const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
require('dotenv').config();

const { getItemSync, setItemSync, removeItemSync } = require('./app-storage');

const { handleLLMGenerate } = require('./llm-handler');

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

function createWindow() {
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
    if (!apiKey) {
      return { ok: false, error: 'Missing API key. Select a saved AI profile first.' };
    }

    try {
      const requestProfile = profile && typeof profile === 'object'
        ? { ...profile, key: profile.key || apiKey, model: profile.model || model || 'gemini-2.0-flash' }
        : { format: 'gemini', key: apiKey, model: model || 'gemini-2.0-flash' };
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
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

const axios = require('axios');

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
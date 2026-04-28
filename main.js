const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
require('dotenv').config();

const { getItemSync, setItemSync, removeItemSync } = require('./app-storage');

const { handleLLMGenerate } = require('./llm-handler');

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
    const content = await fs.readFile(filePath, 'utf8');
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

  ipcMain.handle('config:getGeminiApiKey', () => {
    return process.env.GEMINI_API_KEY || '';
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
    await fs.mkdir(dir, { recursive: true });
    const filePath = getPdfChatPath(payload.pdfPath);
    const line = `${JSON.stringify(payload.entry)}\n`;
    await fs.appendFile(filePath, line, 'utf8');
    return true;
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

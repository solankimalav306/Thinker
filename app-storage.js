const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const getStorageDir = () => path.join(app.getPath('userData'), 'local-storage-jsonl');
const getFilePath = (key) => path.join(getStorageDir(), `${key}.jsonl`);

function ensureStorageDir() {
  const dir = getStorageDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getItemSync(event, key) {
  ensureStorageDir();
  const file = getFilePath(key);
  if (!fs.existsSync(file)) {
      event.returnValue = null;
      return;
  }
  try {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
        event.returnValue = null;
        return;
    }
    const lastLine = lines[lines.length - 1];
    event.returnValue = JSON.parse(lastLine).value;
  } catch (e) {
    event.returnValue = null;
  }
}

function setItemSync(event, key, value) {
  ensureStorageDir();
  const file = getFilePath(key);
  const data = JSON.stringify({ timestamp: Date.now(), value }) + '\n';
  fs.appendFileSync(file, data, 'utf8');
  event.returnValue = true;
}

function removeItemSync(event, key) {
  ensureStorageDir();
  const file = getFilePath(key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  event.returnValue = true;
}

module.exports = { getItemSync, setItemSync, removeItemSync };

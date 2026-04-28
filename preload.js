const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDF: () => ipcRenderer.invoke('dialog:openPDF'),
  getGeminiApiKey: () => ipcRenderer.invoke('config:getGeminiApiKey'),
  askLLM: (payload) => ipcRenderer.invoke('llm:generate', payload),
  askGemini: (payload) => ipcRenderer.invoke('llm:generate', payload), // legacy alias
  loadChatHistory: (pdfPath) => ipcRenderer.invoke('chat:loadHistory', pdfPath),
  appendChatEntry: (payload) => ipcRenderer.invoke('chat:appendEntry', payload),
  getPdfId: (filePath) => ipcRenderer.invoke('pdf:getPdfId', filePath),
  getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
  indexPDF: (data) => ipcRenderer.invoke('pdf:index', data),
  queryPDF: (data) => ipcRenderer.invoke('pdf:query', data),
  
  // Expose synchronous local storage replacement
  getItem: (key) => ipcRenderer.sendSync('storage:getItem', key),
  setItem: (key, value) => ipcRenderer.sendSync('storage:setItem', key, value),
  removeItem: (key) => ipcRenderer.sendSync('storage:removeItem', key)
});




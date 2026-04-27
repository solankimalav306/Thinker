const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDF: () => ipcRenderer.invoke('dialog:openPDF'),
  getGeminiApiKey: () => ipcRenderer.invoke('config:getGeminiApiKey'),
  askGemini: (payload) => ipcRenderer.invoke('gemini:generate', payload),
  loadChatHistory: (pdfPath) => ipcRenderer.invoke('chat:loadHistory', pdfPath),
  appendChatEntry: (payload) => ipcRenderer.invoke('chat:appendEntry', payload),
  
  // Expose synchronous local storage replacement
  getItem: (key) => ipcRenderer.sendSync('storage:getItem', key),
  setItem: (key, value) => ipcRenderer.sendSync('storage:setItem', key, value),
  removeItem: (key) => ipcRenderer.sendSync('storage:removeItem', key)
});




const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDF: () => ipcRenderer.invoke('dialog:openPDF'),
  askLLM: (payload) => ipcRenderer.invoke('llm:generate', payload),
  askGemini: (payload) => ipcRenderer.invoke('llm:generate', payload), // legacy alias
  loadChatHistory: (pdfPath) => ipcRenderer.invoke('chat:loadHistory', pdfPath),
  appendChatEntry: (payload) => ipcRenderer.invoke('chat:appendEntry', payload),
  getPdfId: (filePath) => ipcRenderer.invoke('pdf:getPdfId', filePath),
  getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
  saveAnnotatedPdf: (payload) => ipcRenderer.invoke('pdf:saveAnnotated', payload),
  indexPDF: (data) => ipcRenderer.invoke('pdf:index', data),
  queryPDF: (data) => ipcRenderer.invoke('pdf:query', data),
  invokeAgent: (data) => ipcRenderer.invoke('agent:invoke', data),
  summarizeCache: (data) => ipcRenderer.invoke('agent:summarizeCache', data),
  appendTokenUsage: (entry) => ipcRenderer.invoke('tokens:append', entry),
  getTokenUsageHistory: () => ipcRenderer.invoke('tokens:getHistory'),
  
  getDefinition: (payload) => ipcRenderer.invoke('dict:define', payload),
  addToGlossary: (payload) => ipcRenderer.invoke('glossary:add', payload),
  removeFromGlossary: (term) => ipcRenderer.invoke('glossary:remove', term),
  getGlossaryTerms: () => ipcRenderer.invoke('glossary:get'),

  // Notes persistence
  loadNotes: (pdfPath) => ipcRenderer.invoke('notes:load', pdfPath),
  saveNotes: (pdfPath, notes) => ipcRenderer.invoke('notes:save', pdfPath, notes),
  // Mindmap persistence
  loadMindmaps: (pdfPath) => ipcRenderer.invoke('mindmaps:list', pdfPath),
  saveMindmap: (pdfPath, mindmap) => ipcRenderer.invoke('mindmaps:save', pdfPath, mindmap),
  deleteMindmap: (pdfPath, id) => ipcRenderer.invoke('mindmaps:delete', pdfPath, id),
  saveTextFile: (payload) => ipcRenderer.invoke('dialog:saveTextFile', payload),

  // Expose synchronous local storage replacement
  getItem: (key) => ipcRenderer.sendSync('storage:getItem', key),
  setItem: (key, value) => ipcRenderer.sendSync('storage:setItem', key, value),
  removeItem: (key) => ipcRenderer.sendSync('storage:removeItem', key),

  // Multi-window and drag-out PDF handlers
  createWindow: (filePath) => ipcRenderer.invoke('window:create', filePath),
  onOpenPdf: (callback) => {
    const subscription = (event, path) => callback(path);
    ipcRenderer.on('open-pdf', subscription);
    return () => ipcRenderer.removeListener('open-pdf', subscription);
  }
});




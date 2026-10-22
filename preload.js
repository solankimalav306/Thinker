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

  setTitleBarTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  // Settings registry
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSetting: (key, scope, scopeId, value) => ipcRenderer.invoke('settings:set', key, scope, scopeId, value),
  resetSetting: (key, scope, scopeId) => ipcRenderer.invoke('settings:reset', key, scope, scopeId),

  // Conversations and custom instructions
  listConversations: (pdfPath) => ipcRenderer.invoke('conv:list', pdfPath),
  createConversation: (pdfPath, fields) => ipcRenderer.invoke('conv:create', pdfPath, fields),
  updateConversation: (id, patch) => ipcRenderer.invoke('conv:update', id, patch),
  deleteConversation: (id) => ipcRenderer.invoke('conv:delete', id),
  getConversationMessages: (id) => ipcRenderer.invoke('conv:messages', id),
  appendConversationMessage: (id, entry) => ipcRenderer.invoke('conv:append', id, entry),
  listInstructions: (scope, scopeId) => ipcRenderer.invoke('ins:list', scope, scopeId),
  saveInstruction: (fields) => ipcRenderer.invoke('ins:save', fields),
  deleteInstruction: (id) => ipcRenderer.invoke('ins:delete', id),
  resolveInstructions: (pdfPath, conversationId) => ipcRenderer.invoke('ins:resolve', pdfPath, conversationId),
  getDocumentId: (pdfPath) => ipcRenderer.invoke('doc:id', pdfPath),

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




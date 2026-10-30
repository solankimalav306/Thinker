const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDF: () => ipcRenderer.invoke('dialog:openPDF'),
  pickPdfs: () => ipcRenderer.invoke('dialog:pickPdfs'),

  // ThinkerTex (every call answers { ok, value } or { ok: false, error })
  tex: {
    templates: () => ipcRenderer.invoke('tex:templates'),
    engine: () => ipcRenderer.invoke('tex:engine'),
    setup: () => ipcRenderer.invoke('tex:setup'),
    onSetupProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('tex:setup-progress', handler);
      return () => ipcRenderer.removeListener('tex:setup-progress', handler);
    },
    projects: () => ipcRenderer.invoke('tex:projects'),
    create: (fields) => ipcRenderer.invoke('tex:create', fields),
    openFolder: () => ipcRenderer.invoke('tex:openFolder'),
    openFile: () => ipcRenderer.invoke('tex:openFile'),
    open: (id) => ipcRenderer.invoke('tex:open', id),
    forget: (id) => ipcRenderer.invoke('tex:forget', id),
    rename: (id, name) => ipcRenderer.invoke('tex:rename', id, name),
    setMain: (id, file) => ipcRenderer.invoke('tex:setMain', id, file),
    files: (id) => ipcRenderer.invoke('tex:files', id),
    read: (id, file) => ipcRenderer.invoke('tex:read', id, file),
    write: (id, file, content) => ipcRenderer.invoke('tex:write', id, file, content),
    newFile: (id, file, content) => ipcRenderer.invoke('tex:newFile', id, file, content),
    newFolder: (id, folder) => ipcRenderer.invoke('tex:newFolder', id, folder),
    renameFile: (id, from, to) => ipcRenderer.invoke('tex:renameFile', id, from, to),
    deleteFile: (id, file) => ipcRenderer.invoke('tex:deleteFile', id, file),
    importFiles: (id, dir) => ipcRenderer.invoke('tex:importFiles', id, dir),
    compile: (id, options) => ipcRenderer.invoke('tex:compile', id, options),
    cancel: (id) => ipcRenderer.invoke('tex:cancel', id),
    pdf: (id) => ipcRenderer.invoke('tex:pdf', id),
    exportPdf: (id) => ipcRenderer.invoke('tex:exportPdf', id),
    tryChange: (id, overlay) => ipcRenderer.invoke('tex:tryChange', id, overlay)
  },

  // Thinkspaces and ThinkerTex projects
  listWorkspaces: () => ipcRenderer.invoke('ws:list'),
  listWorkspaceConversations: (id) => ipcRenderer.invoke('wsconv:list', id),
  createWorkspaceConversation: (id, fields) => ipcRenderer.invoke('wsconv:create', id, fields),
  getWorkspace: (id) => ipcRenderer.invoke('ws:get', id),
  createWorkspace: (fields) => ipcRenderer.invoke('ws:create', fields),
  updateWorkspace: (id, patch) => ipcRenderer.invoke('ws:update', id, patch),
  deleteWorkspace: (id) => ipcRenderer.invoke('ws:delete', id),
  markWorkspaceOpened: (id) => ipcRenderer.invoke('ws:opened', id),
  addWorkspaceDocuments: (id, files) => ipcRenderer.invoke('ws:addDocuments', id, files),
  removeWorkspaceDocument: (id, docId) => ipcRenderer.invoke('ws:removeDocument', id, docId),
  reorderWorkspaceDocuments: (id, order) => ipcRenderer.invoke('ws:reorderDocuments', id, order),
  workspacesForDocument: (docId) => ipcRenderer.invoke('ws:forDocument', docId),
  listArtifacts: (filter) => ipcRenderer.invoke('art:list', filter),
  getArtifact: (id) => ipcRenderer.invoke('art:get', id),
  createArtifact: (fields) => ipcRenderer.invoke('art:create', fields),
  updateArtifact: (id, patch) => ipcRenderer.invoke('art:update', id, patch),
  deleteArtifact: (id) => ipcRenderer.invoke('art:delete', id),
  exportArtifact: (request) => ipcRenderer.invoke('art:export', request),
  remoteStatus: () => ipcRenderer.invoke('remote:status'),
  remoteShare: (request) => ipcRenderer.invoke('remote:share', request),
  remoteEnd: (id) => ipcRenderer.invoke('remote:end', id),
  remoteStopAll: () => ipcRenderer.invoke('remote:stopAll'),
  onRemoteChanged: (callback) => ipcRenderer.on('remote:changed', () => callback()),
  onRemoteBuilt: (callback) => ipcRenderer.on('remote:built', (_e, payload) => callback(payload)),
  collab: {
    open: (projectId, rel) => ipcRenderer.invoke('collab:open', projectId, rel),
    update: (projectId, rel, update) => ipcRenderer.invoke('collab:update', projectId, rel, update),
    awareness: (projectId, rel, update) => ipcRenderer.invoke('collab:awareness', projectId, rel, update),
    close: (projectId, rel) => ipcRenderer.invoke('collab:close', projectId, rel),
    onUpdate: (callback) => ipcRenderer.on('collab:update', (_e, payload) => callback(payload)),
    onAwareness: (callback) => ipcRenderer.on('collab:awareness', (_e, payload) => callback(payload))
  },
  listProjects: () => ipcRenderer.invoke('proj:list'),
  getProject: (id) => ipcRenderer.invoke('proj:get', id),
  updateProject: (id, patch) => ipcRenderer.invoke('proj:update', id, patch),
  forgetProject: (id) => ipcRenderer.invoke('proj:forget', id),
  linkProject: (workspaceId, projectId) => ipcRenderer.invoke('proj:link', workspaceId, projectId),
  unlinkProject: (workspaceId, projectId) => ipcRenderer.invoke('proj:unlink', workspaceId, projectId),
  workspacesForProject: (id) => ipcRenderer.invoke('proj:forProject', id),
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
  cancelAgent: (requestId) => ipcRenderer.invoke('agent:cancel', requestId),
  summarizeCache: (data) => ipcRenderer.invoke('agent:summarizeCache', data),
  appendTokenUsage: (entry) => ipcRenderer.invoke('tokens:append', entry),
  getTokenUsageHistory: () => ipcRenderer.invoke('tokens:getHistory'),
  
  getDefinition: (payload) => ipcRenderer.invoke('dict:define', payload),
  addToGlossary: (payload) => ipcRenderer.invoke('glossary:add', payload),
  removeFromGlossary: (term) => ipcRenderer.invoke('glossary:remove', term),
  getGlossaryTerms: () => ipcRenderer.invoke('glossary:get'),

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openDocumentLink: (url) => ipcRenderer.invoke('shell:openDocumentLink', url),
  // The real path of a file dropped onto the window (File.path no longer exists in current Electron).
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
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




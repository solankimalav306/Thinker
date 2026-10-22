// Data access on top of the SQLite database. Everything a document owns is keyed by the
// SHA-256 of its contents, so moving or renaming a file keeps its annotations, notes and chats.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { transaction } = require('./database');

const ANNOTATION_KEY = /^pdf-(annotations|highlights):(.*):page-(\d+)$/;
const TOKEN_USAGE_KEY = 'smartpdf.tokenUsage';

const now = () => Date.now();
const newId = (prefix) => `${prefix}-${now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

function toLocalPath(filePath) {
  if (!filePath) return filePath;
  const value = String(filePath);
  if (value.startsWith('file:///')) return decodeURIComponent(value.slice('file:///'.length)).replace(/\//g, path.sep);
  if (value.startsWith('file://')) return decodeURIComponent(value.slice('file://'.length));
  return value;
}

function createStore(db) {
  const q = (sql) => db.prepare(sql);
  const parse = (text, fallback = null) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  // ── Documents ──────────────────────────────────────────────────────────────
  // A document id is the content hash. Files that no longer exist fall back to a path-derived
  // id so legacy keys stay stable instead of throwing.
  function docIdForPath(rawPath) {
    const filePath = toLocalPath(rawPath);
    if (!filePath) return null;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return `missing-${crypto.createHash('sha256').update(String(filePath)).digest('hex')}`;
    }
    const cached = q('SELECT doc_id, size, mtime_ms FROM path_cache WHERE path = ?').get(filePath);
    if (cached && cached.size === stat.size && cached.mtime_ms === Math.floor(stat.mtimeMs)) {
      touchDocument(cached.doc_id, filePath);
      return cached.doc_id;
    }
    const id = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    transaction(db, () => {
      q(`INSERT INTO documents (id, path, title, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET path = excluded.path, last_opened_at = excluded.last_opened_at`)
        .run(id, filePath, path.basename(filePath), now(), now());
      q(`INSERT INTO path_cache (path, size, mtime_ms, doc_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, doc_id = excluded.doc_id`)
        .run(filePath, stat.size, Math.floor(stat.mtimeMs), id);
    });
    return id;
  }

  function touchDocument(id, filePath) {
    q('UPDATE documents SET path = ?, last_opened_at = ? WHERE id = ?').run(filePath, now(), id);
  }

  // Makes sure a documents row exists for ids that are not real hashes (missing files), so
  // foreign keys hold.
  function ensureDocument(id, filePath = null) {
    if (!id) return;
    q(`INSERT INTO documents (id, path, title, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(id, filePath, filePath ? path.basename(filePath) : null, now());
  }

  // ── Key-value (legacy renderer storage) with routing ──────────────────────
  // Per-page annotation and highlight keys are stored by document hash instead of by path.
  function routeAnnotationKey(key) {
    const match = ANNOTATION_KEY.exec(key);
    if (!match) return null;
    const docId = docIdForPath(match[2]);
    ensureDocument(docId, toLocalPath(match[2]));
    return { docId, kind: match[1], page: Number(match[3]) };
  }

  function getItem(key) {
    const route = routeAnnotationKey(key);
    if (route) {
      const row = q('SELECT data FROM annotations WHERE doc_id = ? AND page = ? AND kind = ?').get(route.docId, route.page, route.kind);
      return row ? row.data : null;
    }
    const row = q('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  function setItem(key, value) {
    const route = routeAnnotationKey(key);
    if (route) {
      q(`INSERT INTO annotations (doc_id, page, kind, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(doc_id, page, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
        .run(route.docId, route.page, route.kind, String(value), now());
      return;
    }
    q(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, String(value), now());
  }

  function removeItem(key) {
    const route = routeAnnotationKey(key);
    if (route) {
      q('DELETE FROM annotations WHERE doc_id = ? AND page = ? AND kind = ?').run(route.docId, route.page, route.kind);
      return;
    }
    q('DELETE FROM kv WHERE key = ?').run(key);
  }

  // ── Settings registry values ──────────────────────────────────────────────
  function getSettings() {
    return q('SELECT key, scope, scope_id, value FROM settings').all()
      .map((r) => ({ key: r.key, scope: r.scope, scopeId: r.scope_id, value: parse(r.value) }));
  }

  function setSetting(key, scope, scopeId, value) {
    q(`INSERT INTO settings (key, scope, scope_id, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, scope, scopeId || '', JSON.stringify(value), now());
  }

  function resetSetting(key, scope, scopeId) {
    q('DELETE FROM settings WHERE key = ? AND scope = ? AND scope_id = ?').run(key, scope, scopeId || '');
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  function loadNotes(pdfPath) {
    const docId = docIdForPath(pdfPath);
    return q('SELECT data FROM notes WHERE doc_id = ? ORDER BY position').all(docId).map((r) => parse(r.data)).filter(Boolean);
  }

  // The renderer saves the whole list at once, so replace the document's notes atomically.
  function saveNotes(pdfPath, notes) {
    const docId = docIdForPath(pdfPath);
    ensureDocument(docId, toLocalPath(pdfPath));
    transaction(db, () => {
      q('DELETE FROM notes WHERE doc_id = ?').run(docId);
      const insert = q('INSERT INTO notes (id, doc_id, data, position) VALUES (?, ?, ?, ?)');
      (Array.isArray(notes) ? notes : []).forEach((note, index) => {
        insert.run(`${docId}:${note?.id || newId('note')}:${index}`, docId, JSON.stringify(note), index);
      });
    });
  }

  // ── Mind maps ─────────────────────────────────────────────────────────────
  function listMindmaps(pdfPath) {
    const docId = docIdForPath(pdfPath);
    return q('SELECT data FROM mindmaps WHERE doc_id = ? ORDER BY created_at').all(docId).map((r) => parse(r.data)).filter(Boolean);
  }

  function saveMindmap(pdfPath, mindmap) {
    const docId = docIdForPath(pdfPath);
    ensureDocument(docId, toLocalPath(pdfPath));
    mindmap.id = mindmap.id || String(now());
    mindmap.createdAt = mindmap.createdAt || new Date().toISOString();
    q(`INSERT INTO mindmaps (id, doc_id, data, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .run(`${docId}:${mindmap.id}`, docId, JSON.stringify(mindmap), Date.parse(mindmap.createdAt) || now());
    return mindmap;
  }

  function deleteMindmap(pdfPath, id) {
    const docId = docIdForPath(pdfPath);
    q('DELETE FROM mindmaps WHERE id = ?').run(`${docId}:${id}`);
  }

  // ── Glossary ──────────────────────────────────────────────────────────────
  function getGlossary() {
    const terms = q('SELECT data FROM glossary ORDER BY term').all().map((r) => parse(r.data)).filter(Boolean);
    return { terms, pdfGlossaries: {} };
  }

  function addGlossaryTerm(payload) {
    const existing = q('SELECT data FROM glossary WHERE term = ?').get(payload.term);
    const merged = existing
      ? { ...parse(existing.data, {}), ...payload, frequency: (parse(existing.data, {}).frequency || 1) + 1 }
      : { ...payload, dateAdded: new Date().toISOString(), frequency: 1 };
    q(`INSERT INTO glossary (term, data) VALUES (?, ?) ON CONFLICT(term) DO UPDATE SET data = excluded.data`)
      .run(payload.term, JSON.stringify(merged));
  }

  function removeGlossaryTerm(term) {
    q('DELETE FROM glossary WHERE term = ?').run(term);
  }

  // ── Token usage ───────────────────────────────────────────────────────────
  function appendUsage(entry) {
    q('INSERT INTO usage (ts, profile_id, conversation_id, data) VALUES (?, ?, ?, ?)')
      .run(entry?.timestamp || now(), entry?.profileId || entry?.profile_id || null, entry?.conversationId || null, JSON.stringify(entry));
  }

  function readUsage() {
    return q('SELECT ts, data FROM usage ORDER BY id').all().map((r) => ({ timestamp: r.ts, ...parse(r.data, {}) }));
  }

  // ── Conversations and messages ────────────────────────────────────────────
  const conversationRow = (r) => r && ({
    id: r.id, docId: r.doc_id, title: r.title, mode: r.mode, profileId: r.profile_id,
    instructions: r.instructions, pinned: Boolean(r.pinned), archived: Boolean(r.archived),
    createdAt: r.created_at, updatedAt: r.updated_at
  });

  function listConversations(pdfPath) {
    const docId = docIdForPath(pdfPath);
    return q('SELECT * FROM conversations WHERE doc_id = ? AND archived = 0 ORDER BY pinned DESC, updated_at DESC')
      .all(docId).map(conversationRow);
  }

  function createConversation(pdfPath, fields = {}) {
    const docId = docIdForPath(pdfPath);
    ensureDocument(docId, toLocalPath(pdfPath));
    const id = newId('chat');
    q(`INSERT INTO conversations (id, doc_id, title, mode, profile_id, instructions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, docId, fields.title || 'New chat', fields.mode || null, fields.profileId || null, fields.instructions || '', now(), now());
    return conversationRow(q('SELECT * FROM conversations WHERE id = ?').get(id));
  }

  function getConversation(id) {
    return conversationRow(q('SELECT * FROM conversations WHERE id = ?').get(id));
  }

  function updateConversation(id, patch = {}) {
    const columns = { title: 'title', mode: 'mode', profileId: 'profile_id', instructions: 'instructions', pinned: 'pinned', archived: 'archived' };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(columns)) {
      if (field in patch) {
        sets.push(`${column} = ?`);
        values.push(typeof patch[field] === 'boolean' ? Number(patch[field]) : patch[field]);
      }
    }
    if (sets.length === 0) return conversationRow(q('SELECT * FROM conversations WHERE id = ?').get(id));
    q(`UPDATE conversations SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), id);
    return conversationRow(q('SELECT * FROM conversations WHERE id = ?').get(id));
  }

  function deleteConversation(id) {
    q('DELETE FROM conversations WHERE id = ?').run(id);
  }

  function getMessages(conversationId) {
    return q('SELECT id, parent_id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id')
      .all(conversationId)
      .map((r) => ({ id: r.id, parentId: r.parent_id, role: r.role, text: r.content, ts: r.created_at, ...parse(r.meta, {}) }));
  }

  // Entries keep the renderer's shape: { role, text, ...extras }. Extras live in the meta column.
  function appendMessage(conversationId, entry, parentId = null) {
    const { role, text, ts, ...meta } = entry;
    const result = q('INSERT INTO messages (conversation_id, parent_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(conversationId, parentId, role || 'user', String(text ?? ''), JSON.stringify(meta), ts || now());
    const conv = q('SELECT title FROM conversations WHERE id = ?').get(conversationId);
    if (conv && conv.title === 'New chat' && role === 'user') {
      const title = String(meta.question || text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (title) q('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
    }
    q('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conversationId);
    return Number(result.lastInsertRowid);
  }

  // ── Instructions ──────────────────────────────────────────────────────────
  const instructionRow = (r) => ({ id: r.id, scope: r.scope, scopeId: r.scope_id, title: r.title, body: r.body, enabled: Boolean(r.enabled), createdAt: r.created_at });

  function listInstructions(scope = null, scopeId = null) {
    if (scope) {
      return q('SELECT * FROM instructions WHERE scope = ? AND scope_id = ? ORDER BY created_at').all(scope, scopeId || '').map(instructionRow);
    }
    return q('SELECT * FROM instructions ORDER BY created_at').all().map(instructionRow);
  }

  function saveInstruction(fields) {
    const id = fields.id || newId('ins');
    q(`INSERT INTO instructions (id, scope, scope_id, title, body, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, scope_id = excluded.scope_id, title = excluded.title,
         body = excluded.body, enabled = excluded.enabled`)
      .run(id, fields.scope, fields.scopeId || '', fields.title || 'Instruction', fields.body || '', fields.enabled === false ? 0 : 1, now());
    return instructionRow(q('SELECT * FROM instructions WHERE id = ?').get(id));
  }

  function deleteInstruction(id) {
    q('DELETE FROM instructions WHERE id = ?').run(id);
  }

  return {
    db, docIdForPath, ensureDocument, toLocalPath,
    getItem, setItem, removeItem,
    getSettings, setSetting, resetSetting,
    loadNotes, saveNotes, listMindmaps, saveMindmap, deleteMindmap,
    getGlossary, addGlossaryTerm, removeGlossaryTerm,
    appendUsage, readUsage,
    listConversations, getConversation, createConversation, updateConversation, deleteConversation, getMessages, appendMessage,
    listInstructions, saveInstruction, deleteInstruction
  };
}

module.exports = { createStore, toLocalPath, ANNOTATION_KEY, TOKEN_USAGE_KEY };

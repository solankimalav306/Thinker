// Thinkspaces and ThinkerTex projects: the data layer.
//
// A Thinkspace groups documents (PDFs) and, optionally, ThinkerTex projects. A project is a folder of
// files that can live anywhere; it is linked to a Thinkspace only if the person links it. Deleting a
// Thinkspace or removing a document or project from one never deletes files, documents or projects.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { transaction } = require('./database');

const now = () => Date.now();
const newId = (prefix) => `${prefix}-${now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const MAX_NAME = 80;

function cleanName(raw, fallback) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || fallback;
}

function createWorkspaces(store) {
  const { db } = store;
  const q = (sql) => db.prepare(sql);

  const workspaceRow = (r) => !r ? null : ({
    id: r.id, name: r.name, description: r.description, color: r.color,
    createdAt: r.created_at, updatedAt: r.updated_at, lastOpenedAt: r.last_opened_at,
    documentCount: r.document_count ?? undefined, projectCount: r.project_count ?? undefined
  });

  const projectRow = (r) => !r ? null : ({
    id: r.id, kind: r.kind, name: r.name, rootPath: r.root_path, managed: Boolean(r.managed),
    mainFile: r.main_file, engine: r.engine, createdAt: r.created_at, updatedAt: r.updated_at,
    lastOpenedAt: r.last_opened_at, lastBuiltAt: r.last_built_at
  });

  const touch = (id) => q('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), id);
  const mustExist = (id) => {
    const row = q('SELECT * FROM workspaces WHERE id = ?').get(String(id));
    if (!row) throw new Error('That Thinkspace no longer exists.');
    return row;
  };

  // ── Thinkspaces ────────────────────────────────────────────────────────────
  function listWorkspaces() {
    return q(`SELECT w.*,
        (SELECT COUNT(*) FROM workspace_documents d WHERE d.workspace_id = w.id) AS document_count,
        (SELECT COUNT(*) FROM workspace_projects p WHERE p.workspace_id = w.id) AS project_count
      FROM workspaces w ORDER BY COALESCE(w.last_opened_at, w.updated_at) DESC, w.created_at DESC`)
      .all().map(workspaceRow);
  }

  function createWorkspace(fields = {}) {
    const id = newId('space');
    const t = now();
    q('INSERT INTO workspaces (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, cleanName(fields.name, 'Untitled Thinkspace'), String(fields.description || '').slice(0, 500), String(fields.color || '').slice(0, 20), t, t);
    return getWorkspace(id);
  }

  function updateWorkspace(id, patch = {}) {
    mustExist(id);
    const sets = [];
    const values = [];
    if ('name' in patch) { sets.push('name = ?'); values.push(cleanName(patch.name, 'Untitled Thinkspace')); }
    if ('description' in patch) { sets.push('description = ?'); values.push(String(patch.description || '').slice(0, 500)); }
    if ('color' in patch) { sets.push('color = ?'); values.push(String(patch.color || '').slice(0, 20)); }
    if (sets.length) q(`UPDATE workspaces SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), String(id));
    return getWorkspace(id);
  }

  // Never touches documents, projects or files; only the grouping goes away. Chats and notes that were
  // made inside the Thinkspace keep existing (their workspace link is cleared by the schema).
  function deleteWorkspace(id) {
    q('DELETE FROM workspaces WHERE id = ?').run(String(id));
    return true;
  }

  function markOpened(id) {
    q('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(now(), String(id));
  }

  function getWorkspace(id) {
    const row = q(`SELECT w.*,
        (SELECT COUNT(*) FROM workspace_documents d WHERE d.workspace_id = w.id) AS document_count,
        (SELECT COUNT(*) FROM workspace_projects p WHERE p.workspace_id = w.id) AS project_count
      FROM workspaces w WHERE w.id = ?`).get(String(id));
    if (!row) return null;
    return {
      ...workspaceRow(row),
      documents: listDocuments(id),
      projects: listWorkspaceProjects(id)
    };
  }

  // ── Documents in a Thinkspace ──────────────────────────────────────────────
  function listDocuments(workspaceId) {
    return q(`SELECT d.id, d.path, d.title, d.page_count, wd.added_at, wd.position
      FROM workspace_documents wd JOIN documents d ON d.id = wd.doc_id
      WHERE wd.workspace_id = ? ORDER BY wd.position, wd.added_at, d.title`)
      .all(String(workspaceId))
      .map((r) => ({ id: r.id, path: r.path, title: r.title || path.basename(r.path || '') || 'Untitled', pageCount: r.page_count, addedAt: r.added_at, position: r.position }));
  }

  // Adds PDFs by path. Files that cannot be read are reported, not silently skipped.
  function addDocuments(workspaceId, paths = []) {
    mustExist(workspaceId);
    const added = [];
    const skipped = [];
    transaction(db, () => {
      const base = q('SELECT COALESCE(MAX(position), -1) AS m FROM workspace_documents WHERE workspace_id = ?').get(String(workspaceId)).m;
      let next = base + 1;
      for (const raw of paths) {
        const filePath = store.toLocalPath(raw);
        if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          skipped.push({ path: String(raw), reason: 'missing' });
          continue;
        }
        if (!/\.pdf$/i.test(filePath)) {
          skipped.push({ path: filePath, reason: 'not-pdf' });
          continue;
        }
        const docId = store.docIdForPath(filePath);
        store.ensureDocument(docId, filePath);
        const result = q('INSERT OR IGNORE INTO workspace_documents (workspace_id, doc_id, added_at, position) VALUES (?, ?, ?, ?)')
          .run(String(workspaceId), docId, now(), next);
        if (Number(result.changes) > 0) {
          next += 1;
          added.push(docId);
        } else {
          skipped.push({ path: filePath, reason: 'already-there' });
        }
      }
      touch(workspaceId);
    });
    return { added, skipped, workspace: getWorkspace(workspaceId) };
  }

  function removeDocument(workspaceId, docId) {
    q('DELETE FROM workspace_documents WHERE workspace_id = ? AND doc_id = ?').run(String(workspaceId), String(docId));
    touch(workspaceId);
    return getWorkspace(workspaceId);
  }

  function reorderDocuments(workspaceId, orderedIds = []) {
    transaction(db, () => {
      const update = q('UPDATE workspace_documents SET position = ? WHERE workspace_id = ? AND doc_id = ?');
      orderedIds.forEach((docId, index) => update.run(index, String(workspaceId), String(docId)));
      touch(workspaceId);
    });
    return getWorkspace(workspaceId);
  }

  // Which Thinkspaces a document belongs to (for "also in ..." hints).
  function workspacesForDocument(docId) {
    return q(`SELECT w.id, w.name FROM workspace_documents wd JOIN workspaces w ON w.id = wd.workspace_id
      WHERE wd.doc_id = ? ORDER BY w.name`).all(String(docId));
  }

  // ── ThinkerTex projects ────────────────────────────────────────────────────
  function listProjects() {
    return q('SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at) DESC').all().map(projectRow);
  }

  function getProject(id) {
    return projectRow(q('SELECT * FROM projects WHERE id = ?').get(String(id)));
  }

  function projectForRoot(rootPath) {
    return projectRow(q('SELECT * FROM projects WHERE root_path = ?').get(path.resolve(String(rootPath))));
  }

  // Registers a folder as a project. Registering the same folder twice returns the existing project.
  function registerProject(fields = {}) {
    if (!fields.rootPath) throw new Error('A project needs a folder.');
    const rootPath = path.resolve(String(fields.rootPath));
    const existing = projectForRoot(rootPath);
    if (existing) return existing;
    const id = newId('proj');
    const t = now();
    q(`INSERT INTO projects (id, kind, name, root_path, managed, main_file, engine, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, fields.kind || 'latex', cleanName(fields.name, path.basename(rootPath) || 'Untitled project'), rootPath,
        fields.managed ? 1 : 0, String(fields.mainFile || 'main.tex'), String(fields.engine || 'tectonic'), t, t);
    if (fields.workspaceId) linkProject(fields.workspaceId, id);
    return getProject(id);
  }

  function updateProject(id, patch = {}) {
    if (!getProject(id)) throw new Error('That project no longer exists.');
    const columns = { name: 'name', mainFile: 'main_file', engine: 'engine', lastBuiltAt: 'last_built_at', lastOpenedAt: 'last_opened_at' };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(columns)) {
      if (field in patch) {
        sets.push(`${column} = ?`);
        values.push(field === 'name' ? cleanName(patch[field], 'Untitled project') : patch[field]);
      }
    }
    if (sets.length) q(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now(), String(id));
    return getProject(id);
  }

  // Forgets the project. Its files are left exactly where they are.
  function forgetProject(id) {
    q('DELETE FROM projects WHERE id = ?').run(String(id));
    return true;
  }

  function linkProject(workspaceId, projectId) {
    mustExist(workspaceId);
    if (!getProject(projectId)) throw new Error('That project no longer exists.');
    q('INSERT OR IGNORE INTO workspace_projects (workspace_id, project_id, added_at) VALUES (?, ?, ?)').run(String(workspaceId), String(projectId), now());
    touch(workspaceId);
    return getWorkspace(workspaceId);
  }

  function unlinkProject(workspaceId, projectId) {
    q('DELETE FROM workspace_projects WHERE workspace_id = ? AND project_id = ?').run(String(workspaceId), String(projectId));
    touch(workspaceId);
    return getWorkspace(workspaceId);
  }

  function listWorkspaceProjects(workspaceId) {
    return q(`SELECT p.* FROM workspace_projects wp JOIN projects p ON p.id = wp.project_id
      WHERE wp.workspace_id = ? ORDER BY wp.added_at`).all(String(workspaceId)).map(projectRow);
  }

  function workspacesForProject(projectId) {
    return q(`SELECT w.id, w.name FROM workspace_projects wp JOIN workspaces w ON w.id = wp.workspace_id
      WHERE wp.project_id = ? ORDER BY w.name`).all(String(projectId));
  }

  return {
    listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, getWorkspace, markOpened,
    listDocuments, addDocuments, removeDocument, reorderDocuments, workspacesForDocument,
    listProjects, getProject, projectForRoot, registerProject, updateProject, forgetProject,
    linkProject, unlinkProject, listWorkspaceProjects, workspacesForProject
  };
}

module.exports = { createWorkspaces, cleanName };

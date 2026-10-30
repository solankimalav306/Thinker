// The Artifacts library: AI-written pages (tables, charts, slides, documents) kept on their own.
const crypto = require('crypto');

const KINDS = ['page', 'table', 'chart', 'slides', 'document'];
const MAX_TITLE = 120;
const MAX_HTML = 200000;
const now = () => Date.now();
const newId = () => `art-${now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

const cleanTitle = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || 'Untitled artifact';
const cleanKind = (raw) => (KINDS.includes(raw) ? raw : 'page');

function cleanSources(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200)
    .map((s) => ({ doc: String(s?.doc ?? '').slice(0, 300), page: Number(s?.page) || 0 }))
    .filter((s) => s.doc);
}

function createArtifacts(store) {
  const { db } = store;
  const q = (sql) => db.prepare(sql);
  const spaceId = (id) => (id && q('SELECT id FROM workspaces WHERE id = ?').get(String(id)) ? String(id) : null);

  const row = (r, withHtml) => !r ? null : ({
    id: r.id, kind: r.kind, title: r.title, workspaceId: r.workspace_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
    ...(withHtml ? { html: r.html, sources: JSON.parse(r.sources || '[]') } : {})
  });

  function get(id) {
    return row(q('SELECT * FROM artifacts WHERE id = ?').get(String(id)), true);
  }

  function create({ title, html, kind, sources, workspaceId } = {}) {
    const body = String(html ?? '');
    if (!body.trim()) throw new Error('There is nothing to save: the artifact is empty.');
    if (body.length > MAX_HTML) throw new Error('That artifact is too large to save.');
    const id = newId();
    const t = now();
    q('INSERT INTO artifacts (id, kind, title, html, sources, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, cleanKind(kind), cleanTitle(title), body, JSON.stringify(cleanSources(sources)), spaceId(workspaceId), t, t);
    return get(id);
  }

  // newest first; a search matches the title only, so listing stays cheap
  function list({ search = '', kind = '', workspaceId = '' } = {}) {
    const where = [];
    const args = [];
    if (search) {
      where.push("title LIKE ? ESCAPE '!'");
      args.push(`%${String(search).replace(/[!%_]/g, '!$&')}%`);
    }
    if (KINDS.includes(kind)) { where.push('kind = ?'); args.push(kind); }
    if (workspaceId) { where.push('workspace_id = ?'); args.push(String(workspaceId)); }
    const sql = `SELECT id, kind, title, workspace_id, created_at, updated_at FROM artifacts${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
    return q(sql).all(...args).map((r) => row(r, false));
  }

  function update(id, patch = {}) {
    const current = get(id);
    if (!current) throw new Error('That artifact no longer exists.');
    const title = patch.title !== undefined ? cleanTitle(patch.title) : current.title;
    const kind = patch.kind !== undefined ? cleanKind(patch.kind) : current.kind;
    const workspaceId = patch.workspaceId !== undefined ? spaceId(patch.workspaceId) : current.workspaceId;
    q('UPDATE artifacts SET title = ?, kind = ?, workspace_id = ?, updated_at = ? WHERE id = ?').run(title, kind, workspaceId, now(), String(id));
    return get(id);
  }

  function remove(id) {
    return q('DELETE FROM artifacts WHERE id = ?').run(String(id)).changes > 0;
  }

  return { create, list, get, update, remove, KINDS };
}

module.exports = { createArtifacts, KINDS };

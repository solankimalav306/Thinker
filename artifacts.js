// The Artifacts library: AI-written pages (tables, charts, slides, documents) kept on their own.
const crypto = require('crypto');

const KINDS = ['checklist', 'steps', 'quiz', 'flashcards', 'table', 'chart', 'diagram', 'timeline', 'document', 'slides', 'page'];
const MAX_STATE = 20000;
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

  const parseJson = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
  const row = (r, withHtml) => !r ? null : ({
    id: r.id, kind: r.kind, title: r.title, workspaceId: r.workspace_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
    ...(withHtml ? { html: r.html, spec: r.spec ? parseJson(r.spec, null) : null, state: parseJson(r.state, {}), sources: parseJson(r.sources, []) } : {})
  });
  const cleanState = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const text = JSON.stringify(v);
    return text.length > MAX_STATE ? {} : v;
  };

  function get(id) {
    return row(q('SELECT * FROM artifacts WHERE id = ?').get(String(id)), true);
  }

  function create({ title, html, spec, state, kind, sources, workspaceId } = {}) {
    const body = String(html ?? '');
    const data = spec && typeof spec === 'object' && !Array.isArray(spec) && Object.keys(spec).length ? JSON.stringify(spec) : '';
    if (!body.trim() && !data) throw new Error('There is nothing to save: the artifact is empty.');
    if (body.length > MAX_HTML || data.length > MAX_HTML) throw new Error('That artifact is too large to save.');
    const id = newId();
    const t = now();
    q('INSERT INTO artifacts (id, kind, title, html, spec, state, sources, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, cleanKind(kind), cleanTitle(title), body, data, JSON.stringify(cleanState(state)), JSON.stringify(cleanSources(sources)), spaceId(workspaceId), t, t);
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
    // ticking a task is not editing the artifact: progress is saved without moving it to the top of the list
    if (patch.state !== undefined && patch.title === undefined && patch.kind === undefined && patch.workspaceId === undefined) {
      q('UPDATE artifacts SET state = ? WHERE id = ?').run(JSON.stringify(cleanState(patch.state)), String(id));
      return get(id);
    }
    const state = patch.state !== undefined ? JSON.stringify(cleanState(patch.state)) : JSON.stringify(current.state || {});
    q('UPDATE artifacts SET title = ?, kind = ?, workspace_id = ?, state = ?, updated_at = ? WHERE id = ?').run(title, kind, workspaceId, state, now(), String(id));
    return get(id);
  }

  function remove(id) {
    return q('DELETE FROM artifacts WHERE id = ?').run(String(id)).changes > 0;
  }

  return { create, list, get, update, remove, KINDS };
}

module.exports = { createArtifacts, KINDS };

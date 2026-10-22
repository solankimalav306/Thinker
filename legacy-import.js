// One-time import of the pre-SQLite files (JSONL key-value store, chat history, notes,
// mind maps, glossary) into the database. The old files are left untouched so nothing is
// lost if the import misses something; they can be deleted once the new data looks right.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { transaction } = require('./database');
const { ANNOTATION_KEY, TOKEN_USAGE_KEY, toLocalPath } = require('./store');

const IMPORTED_FLAG = 'legacy.importedAt';

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function listFiles(dir, test) {
  try {
    return fs.readdirSync(dir).filter(test);
  } catch {
    return [];
  }
}

function importLegacyData(store, userData) {
  if (store.getItem(IMPORTED_FLAG)) return { skipped: true };

  const kvDir = path.join(userData, 'local-storage-jsonl');
  const chatDir = path.join(userData, 'chat-history');
  const kvFiles = listFiles(kvDir, (f) => f.endsWith('.jsonl'));
  const hasLegacy = kvFiles.length > 0 || listFiles(chatDir, (f) => f.endsWith('.jsonl')).length > 0
    || listFiles(userData, (f) => /^(notes|mindmaps)-.*\.json$/.test(f) || f === 'glossary.json').length > 0;
  if (!hasLegacy) {
    store.setItem(IMPORTED_FLAG, String(Date.now()));
    return { skipped: true, empty: true };
  }

  const report = { keys: 0, annotations: 0, usage: 0, conversations: 0, messages: 0, notes: 0, mindmaps: 0, glossary: 0, orphans: 0 };
  const knownPaths = new Set();

  transaction(store.db, () => {
    // 1. Key-value files. Annotation keys carry document paths; collect them for matching below.
    for (const file of kvFiles) {
      const key = decodeURIComponent(file.slice(0, -'.jsonl'.length));
      const rows = readJsonLines(path.join(kvDir, file));
      if (rows.length === 0) continue;

      if (key === TOKEN_USAGE_KEY) {
        rows.forEach((row) => store.appendUsage(row));
        report.usage += rows.length;
        continue;
      }
      const match = ANNOTATION_KEY.exec(key);
      if (match) {
        knownPaths.add(toLocalPath(match[2]));
        report.annotations += 1;
      }
      const value = rows[rows.length - 1].value;
      if (value !== undefined && value !== null) {
        store.setItem(key, value);
        report.keys += 1;
      }
    }

    try {
      const recents = JSON.parse(store.getItem('smartpdf.recents') || '[]');
      if (Array.isArray(recents)) recents.forEach((p) => knownPaths.add(toLocalPath(p)));
    } catch { /* ignore malformed recents */ }

    const byPathHash = new Map([...knownPaths].map((p) => [sha256(p), p]));
    const byBaseName = new Map();
    for (const p of knownPaths) {
      const base = path.basename(p, path.extname(p));
      if (!byBaseName.has(base)) byBaseName.set(base, []);
      byBaseName.get(base).push(p);
    }

    // 2. Chat history: one JSONL per path hash becomes one conversation.
    for (const file of listFiles(chatDir, (f) => f.endsWith('.jsonl'))) {
      const entries = readJsonLines(path.join(chatDir, file));
      if (entries.length === 0) continue;
      const hash = file.slice(0, -'.jsonl'.length);
      const knownPath = byPathHash.get(hash);
      const docId = knownPath ? store.docIdForPath(knownPath) : null;
      const created = store.db.prepare(
        `INSERT INTO conversations (id, doc_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      );
      const convId = `legacy-chat-${hash.slice(0, 16)}`;
      if (docId) store.ensureDocument(docId, knownPath);
      const first = entries.find((e) => e.role === 'user');
      const title = String(first?.question || first?.text || (docId ? 'Imported chat' : 'Imported chat (document unknown)'))
        .replace(/\s+/g, ' ').trim().slice(0, 60) || 'Imported chat';
      created.run(convId, docId, title, entries[0].ts || Date.now(), entries[entries.length - 1].ts || Date.now());
      entries.forEach((entry) => store.appendMessage(convId, entry));
      report.conversations += 1;
      report.messages += entries.length;
      if (!docId) report.orphans += 1;
    }

    // 3. Notes were saved as notes-<file name without extension>.json.
    for (const file of listFiles(userData, (f) => /^notes-.*\.json$/.test(f))) {
      const base = file.slice('notes-'.length, -'.json'.length);
      const notes = readJson(path.join(userData, file), []);
      if (!Array.isArray(notes) || notes.length === 0) continue;
      const candidate = (byBaseName.get(base) || []).find((p) => fs.existsSync(p));
      if (candidate) {
        store.saveNotes(candidate, notes);
      } else {
        const insert = store.db.prepare('INSERT INTO notes (id, doc_id, data, position, legacy_key) VALUES (?, NULL, ?, ?, ?)');
        notes.forEach((note, i) => insert.run(`legacy-${base}-${i}`, JSON.stringify(note), i, file));
        report.orphans += 1;
      }
      report.notes += notes.length;
    }

    // 4. Mind maps were saved as mindmaps-<sha256(path)>.json.
    for (const file of listFiles(userData, (f) => /^mindmaps-.*\.json$/.test(f))) {
      const hash = file.slice('mindmaps-'.length, -'.json'.length);
      const maps = readJson(path.join(userData, file), []);
      if (!Array.isArray(maps) || maps.length === 0) continue;
      const knownPath = byPathHash.get(hash);
      maps.forEach((map, i) => {
        if (knownPath) {
          store.saveMindmap(knownPath, map);
        } else {
          store.db.prepare('INSERT INTO mindmaps (id, doc_id, data, created_at, legacy_key) VALUES (?, NULL, ?, ?, ?)')
            .run(`legacy-${hash.slice(0, 12)}-${map.id || i}`, JSON.stringify(map), Date.parse(map.createdAt) || Date.now(), file);
        }
      });
      if (!knownPath) report.orphans += 1;
      report.mindmaps += maps.length;
    }

    // 5. Glossary.
    const glossary = readJson(path.join(userData, 'glossary.json'), null);
    if (glossary && Array.isArray(glossary.terms)) {
      for (const term of glossary.terms) {
        if (!term?.term) continue;
        store.db.prepare('INSERT INTO glossary (term, data) VALUES (?, ?) ON CONFLICT(term) DO NOTHING')
          .run(term.term, JSON.stringify(term));
        report.glossary += 1;
      }
    }

    store.setItem(IMPORTED_FLAG, String(Date.now()));
  });

  return { skipped: false, report };
}

module.exports = { importLegacyData, IMPORTED_FLAG };

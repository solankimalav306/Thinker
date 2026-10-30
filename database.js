// One SQLite file for everything the app stores. Opened and owned by the main process only.
// Uses Node's built-in node:sqlite, so nothing native has to be compiled per platform.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = 'thinker.db';

// Numbered migrations, applied in order on launch. Never edit an applied one; add a new entry.
const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,              -- SHA-256 of the file contents
        path TEXT,                        -- last known location
        title TEXT,
        page_count INTEGER,
        created_at INTEGER NOT NULL,
        last_opened_at INTEGER
      );
      CREATE TABLE path_cache (           -- avoids re-hashing a file that has not changed
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE workspaces (           -- Thinkspaces (UI arrives in v3; schema is ready now)
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE workspace_documents (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        PRIMARY KEY (workspace_id, doc_id)
      );

      CREATE TABLE kv (                   -- legacy key-value storage used by the renderer
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE settings (             -- registry-backed settings with scopes
        key TEXT NOT NULL,
        scope TEXT NOT NULL,              -- app | workspace | document
        scope_id TEXT NOT NULL DEFAULT '',
        value TEXT NOT NULL,              -- JSON
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, scope, scope_id)
      );

      CREATE TABLE annotations (          -- per page: kind is 'annotations' or 'highlights'
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,
        kind TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (doc_id, page, kind)
      );

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        data TEXT NOT NULL,               -- JSON note object as the renderer holds it
        position INTEGER NOT NULL DEFAULT 0,
        legacy_key TEXT                   -- set when a legacy file could not be matched to a document
      );
      CREATE INDEX notes_doc ON notes(doc_id);

      CREATE TABLE mindmaps (
        id TEXT PRIMARY KEY,
        doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        legacy_key TEXT
      );
      CREATE INDEX mindmaps_doc ON mindmaps(doc_id);

      CREATE TABLE glossary (
        term TEXT PRIMARY KEY COLLATE NOCASE,
        data TEXT NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        doc_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        mode TEXT,                        -- auto | document
        profile_id TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX conversations_doc ON conversations(doc_id, updated_at);
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,   -- enables branching
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,                        -- JSON: quote, question, citations, actions, usage
        created_at INTEGER NOT NULL
      );
      CREATE INDEX messages_conversation ON messages(conversation_id, id);

      CREATE TABLE instructions (         -- custom AI instructions, layered by scope
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,              -- global | workspace | document | conversation
        scope_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX instructions_scope ON instructions(scope, scope_id);

      CREATE TABLE usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        profile_id TEXT,
        conversation_id TEXT,
        data TEXT NOT NULL                -- JSON entry as the renderer reports it
      );
    `
  },
  {
    version: 2,
    sql: `
      -- Thinkspaces: a name and look, when it was last used, and a stable order for its documents.
      ALTER TABLE workspaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspaces ADD COLUMN last_opened_at INTEGER;
      ALTER TABLE workspace_documents ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_documents ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      UPDATE workspaces SET updated_at = created_at WHERE updated_at = 0;

      -- ThinkerTex projects. A project is a folder of files; it can live anywhere and belongs to no
      -- Thinkspace unless it is linked to one (or several).
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'latex',
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,          -- the project folder
        managed INTEGER NOT NULL DEFAULT 0,   -- 1 when Thinker created the folder in its own projects area
        main_file TEXT NOT NULL DEFAULT 'main.tex',
        engine TEXT NOT NULL DEFAULT 'tectonic',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER,
        last_built_at INTEGER
      );
      CREATE UNIQUE INDEX projects_root ON projects(root_path);
      CREATE TABLE workspace_projects (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        added_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workspace_id, project_id)
      );
    `
  },
  {
    version: 3,
    sql: `
      -- Artifacts: AI-written HTML (tables, charts, slides, documents, pages) kept on their own,
      -- apart from the chat that produced them. A Thinkspace link is optional and never deletes the artifact.
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'page',
        title TEXT NOT NULL,
        html TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',   -- JSON: [{doc, page}] the answer was given, for citation checks
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX artifacts_updated ON artifacts(updated_at DESC);
    `
  },
  {
    version: 4,
    sql: `
      -- Interactive artifacts are kept as data (spec) and drawn fresh each time, so they pick up later improvements;
      -- state is the person's progress in one (ticked tasks, quiz answers).
      ALTER TABLE artifacts ADD COLUMN spec TEXT NOT NULL DEFAULT '';
      ALTER TABLE artifacts ADD COLUMN state TEXT NOT NULL DEFAULT '{}';
    `
  }
];

function openDatabase(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, DB_FILE));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

function currentVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function migrate(db) {
  const applied = currentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= applied) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} failed: ${error.message}`);
    }
  }
}

// Runs fn inside a transaction; rolls back if it throws. Calls may nest: inner calls use savepoints.
const depths = new WeakMap();

function transaction(db, fn) {
  const depth = depths.get(db) || 0;
  const begin = depth === 0 ? 'BEGIN' : `SAVEPOINT sp${depth}`;
  const commit = depth === 0 ? 'COMMIT' : `RELEASE sp${depth}`;
  const rollback = depth === 0 ? 'ROLLBACK' : `ROLLBACK TO sp${depth}; RELEASE sp${depth}`;
  db.exec(begin);
  depths.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(commit);
    return result;
  } catch (error) {
    db.exec(rollback);
    throw error;
  } finally {
    depths.set(db, depth);
  }
}

module.exports = { openDatabase, migrate, transaction, currentVersion, MIGRATIONS, DB_FILE };

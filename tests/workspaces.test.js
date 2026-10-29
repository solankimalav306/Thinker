const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, currentVersion, MIGRATIONS } = require('../database');
const { createStore } = require('../store');
const { createWorkspaces } = require('../workspaces');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'thinker-ws-'));
function fresh() {
  const dir = tmp();
  const store = createStore(openDatabase(dir));
  return { dir, store, ws: createWorkspaces(store) };
}
const pdf = (dir, name, body = name) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4 ${body}`);
  return p;
};

test('creating, renaming and listing Thinkspaces', () => {
  const { ws } = fresh();
  const a = ws.createWorkspace({ name: '  Thesis   notes  ' });
  assert.strictEqual(a.name, 'Thesis notes');
  assert.strictEqual(ws.createWorkspace({ name: '   ' }).name, 'Untitled Thinkspace');
  assert.strictEqual(ws.createWorkspace({ name: 'x'.repeat(500) }).name.length, 80);
  ws.updateWorkspace(a.id, { name: 'Thesis', description: 'Chapter 2 sources' });
  const listed = ws.listWorkspaces();
  assert.strictEqual(listed.length, 3);
  assert.ok(listed.some((w) => w.name === 'Thesis' && w.description === 'Chapter 2 sources'));
  assert.throws(() => ws.updateWorkspace('nope', { name: 'x' }), /no longer exists/);
});

test('adding documents: duplicates, missing files and non-PDFs are reported, order is kept', () => {
  const { dir, ws } = fresh();
  const space = ws.createWorkspace({ name: 'S' });
  const one = pdf(dir, 'one.pdf');
  const two = pdf(dir, 'two.pdf');
  const txt = path.join(dir, 'notes.txt');
  fs.writeFileSync(txt, 'hello');
  const result = ws.addDocuments(space.id, [one, two, one, txt, path.join(dir, 'gone.pdf')]);
  assert.strictEqual(result.added.length, 2);
  assert.deepStrictEqual(result.skipped.map((s) => s.reason).sort(), ['already-there', 'missing', 'not-pdf']);
  assert.deepStrictEqual(result.workspace.documents.map((d) => d.title), ['one.pdf', 'two.pdf']);
  assert.strictEqual(result.workspace.documentCount, 2);
});

test('reordering and removing documents', () => {
  const { dir, ws } = fresh();
  const space = ws.createWorkspace({ name: 'S' });
  const { added } = ws.addDocuments(space.id, [pdf(dir, 'a.pdf'), pdf(dir, 'b.pdf'), pdf(dir, 'c.pdf')]);
  const reordered = ws.reorderDocuments(space.id, [added[2], added[0], added[1]]);
  assert.deepStrictEqual(reordered.documents.map((d) => d.title), ['c.pdf', 'a.pdf', 'b.pdf']);
  const after = ws.removeDocument(space.id, added[0]);
  assert.deepStrictEqual(after.documents.map((d) => d.title), ['c.pdf', 'b.pdf']);
});

test('one document can be in several Thinkspaces', () => {
  const { dir, ws } = fresh();
  const s1 = ws.createWorkspace({ name: 'Alpha' });
  const s2 = ws.createWorkspace({ name: 'Beta' });
  const file = pdf(dir, 'shared.pdf');
  const { added } = ws.addDocuments(s1.id, [file]);
  ws.addDocuments(s2.id, [file]);
  assert.deepStrictEqual(ws.workspacesForDocument(added[0]).map((w) => w.name), ['Alpha', 'Beta']);
});

test('deleting a Thinkspace keeps documents, projects, files and chats', () => {
  const { dir, store, ws } = fresh();
  const space = ws.createWorkspace({ name: 'Doomed' });
  const file = pdf(dir, 'keep.pdf');
  const { added } = ws.addDocuments(space.id, [file]);
  const projectDir = path.join(dir, 'paper');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'main.tex'), '\\documentclass{article}');
  const project = ws.registerProject({ rootPath: projectDir, name: 'Paper', workspaceId: space.id });
  const chat = store.createConversation(file, { title: 'my chat' });

  ws.deleteWorkspace(space.id);

  assert.strictEqual(ws.getWorkspace(space.id), null);
  assert.ok(fs.existsSync(file) && fs.existsSync(path.join(projectDir, 'main.tex')));
  assert.ok(ws.getProject(project.id), 'the project survives');
  assert.strictEqual(store.getConversation(chat.id).title, 'my chat');
  assert.ok(store.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(added[0]), 'the document survives');
});

test('projects live anywhere: standalone, in a folder, or linked to Thinkspaces', () => {
  const { dir, ws } = fresh();
  const folder = path.join(dir, 'my-paper');
  fs.mkdirSync(folder);
  const alone = ws.registerProject({ rootPath: folder, name: 'My paper' });
  assert.strictEqual(alone.kind, 'latex');
  assert.strictEqual(alone.mainFile, 'main.tex');
  assert.strictEqual(ws.workspacesForProject(alone.id).length, 0, 'no Thinkspace is needed');

  // registering the same folder again does not create a second project
  assert.strictEqual(ws.registerProject({ rootPath: folder }).id, alone.id);
  assert.strictEqual(ws.listProjects().length, 1);

  const s1 = ws.createWorkspace({ name: 'One' });
  const s2 = ws.createWorkspace({ name: 'Two' });
  ws.linkProject(s1.id, alone.id);
  ws.linkProject(s2.id, alone.id);
  ws.linkProject(s2.id, alone.id); // linking twice is harmless
  assert.deepStrictEqual(ws.workspacesForProject(alone.id).map((w) => w.name), ['One', 'Two']);
  assert.strictEqual(ws.getWorkspace(s2.id).projectCount, 1);

  ws.unlinkProject(s1.id, alone.id);
  assert.deepStrictEqual(ws.workspacesForProject(alone.id).map((w) => w.name), ['Two']);
  assert.ok(ws.getProject(alone.id), 'unlinking keeps the project');
});

test('forgetting a project leaves its files alone', () => {
  const { dir, ws } = fresh();
  const folder = path.join(dir, 'proj');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'main.tex'), 'x');
  const project = ws.registerProject({ rootPath: folder });
  ws.forgetProject(project.id);
  assert.strictEqual(ws.getProject(project.id), null);
  assert.ok(fs.existsSync(path.join(folder, 'main.tex')));
  assert.throws(() => ws.registerProject({}), /needs a folder/);
  assert.throws(() => ws.linkProject('nope', 'nope'), /no longer exists/);
});

test('updating a project and recording a build', () => {
  const { dir, ws } = fresh();
  const project = ws.registerProject({ rootPath: dir, name: 'P' });
  const updated = ws.updateProject(project.id, { name: '  Renamed  ', mainFile: 'paper.tex', lastBuiltAt: 123 });
  assert.strictEqual(updated.name, 'Renamed');
  assert.strictEqual(updated.mainFile, 'paper.tex');
  assert.strictEqual(updated.lastBuiltAt, 123);
});

test('an existing v1 database upgrades without losing anything', () => {
  const dir = tmp();
  const { DatabaseSync } = require('node:sqlite');
  // Build a version-1 database by hand, as an installed 2.0 app would have it.
  const db = new DatabaseSync(path.join(dir, 'thinker.db'));
  db.exec(MIGRATIONS[0].sql);
  db.exec('PRAGMA user_version = 1');
  db.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run('old', 'Old space', 1000);
  db.close();

  const upgraded = openDatabase(dir);
  assert.strictEqual(currentVersion(upgraded), MIGRATIONS[MIGRATIONS.length - 1].version);
  const ws = createWorkspaces(createStore(upgraded));
  const old = ws.getWorkspace('old');
  assert.strictEqual(old.name, 'Old space');
  assert.strictEqual(old.updatedAt, 1000);
  assert.deepStrictEqual(old.documents, []);
});

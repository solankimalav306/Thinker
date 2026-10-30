// Shared editing of a LaTeX project's text files.
//
// One Yjs document per file keeps everybody's edits together (the host's editor and any guests'), and this module
// writes the result back to the file, so the project on disk is always the single copy of the work.
//
// Only plain text files inside the project folder can be opened, and only ones that already exist: a guest can
// change the text of an existing file, nothing else.
const fs = require('fs');
const path = require('path');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const TEXT_EXT = new Set(['.tex', '.bib', '.sty', '.cls', '.bst', '.txt', '.md', '.cfg', '.def', '.ltx']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.thinker-build', 'build', 'out']);
const MAX_BYTES = 1000000;
const MAX_FILES = 200;
const MAX_DEPTH = 4;
const MAX_MESSAGE = 2 * 1024 * 1024;

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// the smallest edit that turns `from` into `to`: keep the shared start and end, replace the middle
function diffRange(from, to) {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start += 1;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) { endFrom -= 1; endTo -= 1; }
  return { index: start, remove: endFrom - start, insert: to.slice(start, endTo) };
}

function createCollab({ root, writeDelay = 400, watch = true, onError = () => {} }) {
  const rootReal = fs.realpathSync(root);
  const entries = new Map();

  // A relative path the project really contains: a text file, not a link out of the folder, small enough.
  function resolve(rel) {
    if (typeof rel !== 'string' || !rel || rel.length > 300 || rel.includes('\0')) throw new Error('That file cannot be opened.');
    const clean = rel.replace(/\\/g, '/');
    if (clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some((p) => p === '..' || p === '' || p.startsWith('.'))) throw new Error('That file cannot be opened.');
    if (!TEXT_EXT.has(path.extname(clean).toLowerCase())) throw new Error('Only text files can be edited together.');
    const abs = path.join(rootReal, ...clean.split('/'));
    let real;
    try { real = fs.realpathSync(abs); } catch { throw new Error('That file does not exist.'); }
    const inside = real === rootReal || real.startsWith(rootReal + path.sep);
    if (!inside) throw new Error('That file cannot be opened.');
    const stat = fs.statSync(real);
    if (!stat.isFile()) throw new Error('That file cannot be opened.');
    if (stat.size > MAX_BYTES) throw new Error('That file is too large to edit together.');
    return { rel: clean, abs: real };
  }

  function listFiles() {
    const out = [];
    const walk = (dir, depth) => {
      if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
      let items;
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const item of items) {
        if (out.length >= MAX_FILES) return;
        if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) { if (!SKIP_DIRS.has(item.name)) walk(full, depth + 1); continue; }
        if (!item.isFile() || !TEXT_EXT.has(path.extname(item.name).toLowerCase())) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch { continue; }
        if (size > MAX_BYTES) continue;
        out.push(path.relative(rootReal, full).split(path.sep).join('/'));
      }
    };
    walk(rootReal, 0);
    return out;
  }

  function open(rel) {
    const { rel: key, abs } = resolve(rel);
    let entry = entries.get(key);
    if (entry) { entry.refs += 1; return entry; }

    const doc = new Y.Doc();
    const ytext = doc.getText('content');
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // the server itself is not a participant
    const initial = fs.readFileSync(abs, 'utf8');
    doc.transact(() => ytext.insert(0, initial), 'disk');

    entry = {
      rel: key, abs, doc, ytext, awareness, refs: 1, lastDisk: initial, timer: null, watcher: null, listeners: new Set(), dead: false
    };

    const writeNow = () => {
      clearTimeout(entry.timer);
      entry.timer = null;
      const text = ytext.toString();
      if (text === entry.lastDisk) return;
      if (Buffer.byteLength(text) > MAX_BYTES * 2) { onError(new Error(`${key} became too large to save.`)); return; }
      try {
        const tmp = `${abs}.thinker-tmp`;
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, abs);
        entry.lastDisk = text;
      } catch (error) {
        onError(error);
      }
    };
    entry.flush = writeNow;

    doc.on('update', (update, origin) => {
      for (const fn of entry.listeners) fn(update, origin);
      if (origin !== 'disk') {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(writeNow, writeDelay);
        entry.timer.unref?.();
      }
    });

    // the file changed outside Thinker (another editor, a git checkout): fold that into the shared copy
    if (watch) {
      let wait = null;
      try {
        entry.watcher = fs.watch(abs, () => {
          clearTimeout(wait);
          wait = setTimeout(() => {
            let disk;
            try { disk = fs.readFileSync(abs, 'utf8'); } catch { return; }
            if (disk === entry.lastDisk || disk === ytext.toString()) { entry.lastDisk = disk; return; }
            const { index, remove, insert } = diffRange(ytext.toString(), disk);
            doc.transact(() => { if (remove) ytext.delete(index, remove); if (insert) ytext.insert(index, insert); }, 'disk');
            entry.lastDisk = disk;
          }, 150);
          wait.unref?.();
        });
        entry.watcher.on('error', () => {});
      } catch { entry.watcher = null; }
    }

    entries.set(key, entry);
    return entry;
  }

  function release(entry) {
    entry.refs -= 1;
    if (entry.refs > 0) return;
    entry.flush();
    entry.watcher?.close();
    entry.awareness.destroy();
    entry.doc.destroy();
    entry.dead = true;
    entries.delete(entry.rel);
  }

  function flushAll() { for (const entry of entries.values()) entry.flush(); }
  function destroy() { flushAll(); for (const entry of [...entries.values()]) { entry.refs = 1; release(entry); } }

  return { resolve, listFiles, open, release, flushAll, destroy, get openCount() { return entries.size; } };
}

// ---- one connection to one shared file (the same messages y-websocket speaks) --------------------------
// `send(Uint8Array)` delivers a message to that participant. `role` is 'edit' or 'view'; a viewer's edits are dropped.
function connect(entry, { send, role }) {
  const { doc, awareness } = entry;
  const controlled = new Set();
  let closed = false;
  const out = (encoder) => { if (!closed && encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder)); };

  const onDocUpdate = (update, origin) => {
    if (origin === conn) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    out(encoder);
  };
  const onAwareness = ({ added, updated, removed }, origin) => {
    if (origin === conn) return;
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    out(encoder);
  };
  const conn = { role };

  const onClientsChanged = ({ added, removed }, origin) => {
    if (origin !== conn) return;
    added.forEach((id) => controlled.add(id));
    removed.forEach((id) => controlled.delete(id));
  };

  doc.on('update', onDocUpdate);
  awareness.on('update', onAwareness);
  awareness.on('change', onClientsChanged);

  // greet: ask for what they have, and tell them who else is here
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    out(encoder);
    const states = awareness.getStates();
    if (states.size) {
      const e2 = encoding.createEncoder();
      encoding.writeVarUint(e2, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e2, awarenessProtocol.encodeAwarenessUpdate(awareness, [...states.keys()]));
      out(e2);
    }
  }

  function message(data) {
    if (closed) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length > MAX_MESSAGE || bytes.length < 2) return;
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const sub = decoding.peekVarUint(decoder);
        if (role !== 'edit' && sub !== 0) return; // a viewer may ask for the document, never change it
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        out(encoder);
      } else if (type === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        if (update.length < 4096) awarenessProtocol.applyAwarenessUpdate(awareness, update, conn);
      }
    } catch (error) {
      // a malformed message from a guest must never take the host down
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    doc.off('update', onDocUpdate);
    awareness.off('update', onAwareness);
    awareness.off('change', onClientsChanged);
    awarenessProtocol.removeAwarenessStates(awareness, [...controlled], null);
  }

  return { message, close };
}

module.exports = { createCollab, connect, diffRange, TEXT_EXT, MAX_BYTES, MESSAGE_SYNC, MESSAGE_AWARENESS };

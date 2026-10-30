// The editor a guest gets in their browser when a project is shared for editing.
// Bundled by scripts/build-editor.js into renderer/vendor/guest-editor/guest-editor.js and served by the share server.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];
const colourFor = (name) => PALETTE[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.keyword, t.tagName], color: 'var(--accent)', fontWeight: '600' },
  { tag: [t.atom, t.number, t.bool], color: '#d97706' },
  { tag: [t.string, t.attributeValue], color: '#16a34a' },
  { tag: [t.meta, t.operator], color: '#0ea5e9' }
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '14px' },
  '.cm-scroller': { fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace", lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  '&.cm-focused': { outline: 'none' }
});

// Opens one file for live editing. `readOnly` guests see everyone's changes and cursors but cannot type.
export function openFile(parent, { wsBase, file, name, readOnly, onStatus, onPeople }) {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  const awareness = new Awareness(doc);
  const color = colourFor(name);
  awareness.setLocalStateField('user', { name, color, colorLight: color + '33' });

  const provider = new WebsocketProvider(wsBase, 'doc', doc, { awareness, params: { file }, maxBackoffTime: 8000 });
  provider.on('status', (event) => onStatus?.(event.status));
  provider.on('sync', (synced) => onStatus?.(synced ? 'synced' : 'connecting'));
  const people = () => onPeople?.([...awareness.getStates().entries()].filter(([id]) => id !== doc.clientID).map(([, s]) => s.user).filter(Boolean));
  awareness.on('change', people);

  const undoManager = new Y.UndoManager(ytext);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), bracketMatching(),
        StreamLanguage.define(stex), syntaxHighlighting(highlight), EditorView.lineWrapping, theme,
        yCollab(ytext, awareness, { undoManager }),
        keymap.of([...(readOnly ? [] : yUndoManagerKeymap), ...searchKeymap, ...(readOnly ? [] : [indentWithTab]), ...defaultKeymap]),
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorView.editable.of(!readOnly)
      ]
    })
  });

  return {
    focus: () => view.focus(),
    destroy() {
      try { awareness.setLocalState(null); } catch { /* closing */ }
      provider.destroy();
      view.destroy();
      doc.destroy();
    }
  };
}

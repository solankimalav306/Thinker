// The source of the ThinkerTex code editor. It is bundled by scripts/build-editor.js into
// renderer/vendor/code-editor/code-editor.js, because the browser cannot resolve bare imports.
import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, Decoration, placeholder, gutter, GutterMarker } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

const BS = String.fromCharCode(92);

// ---- completions: the commands people use most, and environments that insert a matching end ----
const COMMANDS = [
  'section', 'subsection', 'subsubsection', 'paragraph', 'chapter', 'textbf', 'textit', 'emph', 'underline', 'texttt', 'textsc',
  'cite', 'citep', 'citet', 'ref', 'label', 'eqref', 'footnote', 'includegraphics', 'caption', 'centering', 'item', 'usepackage',
  'documentclass', 'title', 'author', 'date', 'maketitle', 'tableofcontents', 'bibliography', 'bibliographystyle', 'input', 'include',
  'frac', 'sqrt', 'sum', 'int', 'prod', 'lim', 'infty', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'omega',
  'leq', 'geq', 'neq', 'approx', 'times', 'cdot', 'partial', 'nabla', 'mathbf', 'mathrm', 'mathcal', 'mathbb', 'hline', 'toprule', 'midrule', 'bottomrule',
  'newcommand', 'renewcommand', 'href', 'url', 'vspace', 'hspace', 'newpage', 'clearpage', 'noindent', 'today'
];
const ENVIRONMENTS = ['document', 'abstract', 'itemize', 'enumerate', 'description', 'equation', 'align', 'figure', 'table', 'tabular', 'center', 'quote', 'verbatim', 'frame', 'theorem', 'proof', 'lemma'];

function completionSource(context) {
  const word = context.matchBefore(/\\[A-Za-z]*$/);
  if (word && (word.from !== word.to || context.explicit)) {
    const options = COMMANDS.map((c) => ({ label: BS + c, type: 'function' }));
    options.push(
      snippetCompletion(BS + 'begin{${1:environment}}\n\t${2}\n' + BS + 'end{${1:environment}}', { label: BS + 'begin', detail: 'environment', type: 'keyword' }),
      ...ENVIRONMENTS.map((e) => snippetCompletion(BS + 'begin{' + e + '}\n\t${}\n' + BS + 'end{' + e + '}', { label: BS + 'begin{' + e + '}', type: 'keyword', boost: -1 }))
    );
    return { from: word.from, options, validFor: /^\\[A-Za-z]*$/ };
  }
  return null;
}

// ---- how it looks: colours come from the app's own theme variables so light and dark just work ----
const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--text-3)', fontStyle: 'italic' },
  { tag: [t.keyword, t.tagName], color: 'var(--primary)', fontWeight: '600' },
  { tag: [t.atom, t.number, t.bool], color: '#d97706' },
  { tag: [t.string, t.attributeValue], color: '#16a34a' },
  { tag: [t.bracket, t.paren, t.brace], color: 'var(--text-2)' },
  { tag: [t.meta, t.operator], color: '#0ea5e9' },
  { tag: t.variableName, color: 'var(--text)' },
  { tag: t.invalid, color: 'var(--danger, #dc2626)' }
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '14px' },
  '.cm-scroller': { fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace", lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--primary)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2, var(--surface))', color: 'var(--text-3)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--primary) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--primary)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--primary)', color: 'var(--on-primary, #fff)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, #f59e0b 35%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, #f59e0b 65%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panel input, .cm-panel button': { font: 'inherit' },
  '.cm-problem-error': { backgroundColor: 'color-mix(in srgb, var(--danger, #dc2626) 14%, transparent)', boxShadow: 'inset 3px 0 0 var(--danger, #dc2626)' },
  '.cm-problem-warning': { backgroundColor: 'color-mix(in srgb, #f59e0b 12%, transparent)', boxShadow: 'inset 3px 0 0 #f59e0b' },
  '.cm-problem-marker': { color: 'var(--danger, #dc2626)', fontWeight: '700', paddingLeft: '4px' },
  '.cm-problem-marker.warning': { color: '#d97706' }
});

// ---- problems from the compiler, shown on their lines ----
const setProblems = StateEffect.define();

const problemField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setProblems)) return effect.value;
    return tr.docChanged ? value.map((p) => p) : value;
  }
});

const problemLines = EditorView.decorations.compute([problemField], (state) => {
  const marks = [];
  const lines = new Map();
  for (const p of state.field(problemField)) {
    if (!p.line || p.line < 1 || p.line > state.doc.lines) continue;
    const prior = lines.get(p.line);
    if (!prior || (prior === 'warning' && p.severity === 'error')) lines.set(p.line, p.severity);
  }
  for (const [line, severity] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    marks.push(Decoration.line({ class: severity === 'error' ? 'cm-problem-error' : 'cm-problem-warning' }).range(state.doc.line(line).from));
  }
  return Decoration.set(marks);
});

class ProblemMarker extends GutterMarker {
  constructor(severity, message) { super(); this.severity = severity; this.message = message; }
  eq(other) { return other.severity === this.severity && other.message === this.message; }
  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-problem-marker ${this.severity}`;
    el.textContent = this.severity === 'error' ? '!' : '•';
    el.title = this.message;
    return el;
  }
}

const problemGutter = gutter({
  class: 'cm-problem-gutter',
  lineMarker(view, line) {
    const number = view.state.doc.lineAt(line.from).number;
    const here = view.state.field(problemField).filter((p) => p.line === number);
    if (!here.length) return null;
    const worst = here.find((p) => p.severity === 'error') || here[0];
    return new ProblemMarker(worst.severity, here.map((p) => p.message).join('\n'));
  },
  initialSpacer: () => new ProblemMarker('error', '')
});

// ---- small helpers for the keyboard ----
function wrapSelection(view, before, after) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: from + before.length + selected.length }
  });
  return true;
}

function toggleComment(view) {
  const { state } = view;
  const lines = new Set();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      pos = line.to + 1;
    }
  }
  const numbers = [...lines];
  const allCommented = numbers.every((n) => /^\s*%/.test(state.doc.line(n).text));
  const changes = [];
  for (const n of numbers) {
    const line = state.doc.line(n);
    if (allCommented) {
      const m = line.text.match(/^(\s*)%\s?/);
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' });
    } else {
      changes.push({ from: line.from, insert: '% ' });
    }
  }
  view.dispatch({ changes });
  return true;
}

export function createCodeEditor(parent, options = {}) {
  const wrap = new Compartment();
  const readOnlyCompartment = new Compartment();
  const historyCompartment = new Compartment();
  const collabCompartment = new Compartment();
  let applyingExternal = false;

  const extensions = [
    lineNumbers(),
    problemGutter,
    highlightActiveLineGutter(),
    historyCompartment.of(history()),
    collabCompartment.of([]),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    StreamLanguage.define(stex),
    syntaxHighlighting(highlight),
    autocompletion({ override: [completionSource], activateOnTyping: true }),
    wrap.of(EditorView.lineWrapping),
    readOnlyCompartment.of(EditorState.readOnly.of(Boolean(options.readOnly))),
    placeholder(options.placeholder || ''),
    problemField,
    problemLines,
    theme,
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { options.onSave?.(); return true; } },
      { key: 'Mod-Enter', preventDefault: true, run: () => { options.onCompile?.(); return true; } },
      { key: 'Mod-/', run: toggleComment },
      { key: 'Mod-b', run: (v) => wrapSelection(v, BS + 'textbf{', '}') },
      { key: 'Mod-i', run: (v) => wrapSelection(v, BS + 'emph{', '}') },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal) options.onChange?.(update.state.doc.toString());
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        options.onCursor?.({ line: line.number, column: head - line.from + 1 });
      }
    })
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: options.doc || '', extensions }) });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      applyingExternal = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      } finally {
        applyingExternal = false;
      }
    },
    // Opens a different file: a fresh editor state, so undo can never carry one file's text into another.
    reset(text) {
      view.setState(EditorState.create({ doc: text || '', extensions }));
    },
    getSelection() {
      const { from, to } = view.state.selection.main;
      return { from, to, text: view.state.sliceDoc(from, to) };
    },
    // Applies edits [{ from, to, insert }] as ONE undo step, so "Accept" is a single Ctrl+Z.
    applyEdits(edits) {
      view.dispatch({ changes: edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })) });
    },
    insertAtCursor(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    },
    goToLine(lineNumber) {
      const n = Math.max(1, Math.min(lineNumber, view.state.doc.lines));
      const line = view.state.doc.line(n);
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      view.focus();
    },
    getCursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    setProblems: (problems) => view.dispatch({ effects: setProblems.of(problems || []) }),
    setReadOnly: (value) => view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(Boolean(value))) }),
    setWrap: (on) => view.dispatch({ effects: wrap.reconfigure(on ? EditorView.lineWrapping : []) }),
    // Everyone's edits to this file are merged by Yjs; its own undo replaces the editor's, so undo only takes back your own typing.
    attachCollab: (ext) => view.dispatch({ effects: [historyCompartment.reconfigure([]), collabCompartment.reconfigure(ext)] }),
    detachCollab: () => view.dispatch({ effects: [historyCompartment.reconfigure(history()), collabCompartment.reconfigure([])] }),
    focus: () => view.focus(),
    destroy: () => view.destroy()
  };
}

// ---- working on the same file with other people ----
const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];
const colourFor = (name) => PALETTE[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];

// Joins `editor` to a shared copy of its file. `state` and `awarenessState` are what the host process already has;
// `onUpdate` and `onAwareness` carry this side's changes back. Returns the pieces the caller needs to keep it in step.
export function bindCollab(editor, { state, awarenessState, name = 'You', onUpdate, onAwareness }) {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  if (state) Y.applyUpdate(doc, new Uint8Array(state), 'remote');
  const awareness = new Awareness(doc);
  if (awarenessState) applyAwarenessUpdate(awareness, new Uint8Array(awarenessState), 'remote');
  const color = colourFor(name);
  awareness.setLocalStateField('user', { name, color, colorLight: color + '33' });
  doc.on('update', (update, origin) => { if (origin !== 'remote') onUpdate(update); });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin !== 'remote') onAwareness(encodeAwarenessUpdate(awareness, added.concat(updated, removed)));
  });
  editor.reset(ytext.toString());
  const undoManager = new Y.UndoManager(ytext);
  editor.attachCollab([yCollab(ytext, awareness, { undoManager }), keymap.of(yUndoManagerKeymap)]);
  return {
    text: () => ytext.toString(),
    applyUpdate: (update) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'),
    applyAwareness: (update) => applyAwarenessUpdate(awareness, new Uint8Array(update), 'remote'),
    people: () => [...awareness.getStates().entries()].filter(([id]) => id !== doc.clientID).map(([, s]) => s.user).filter(Boolean),
    destroy() {
      try { awareness.setLocalState(null); } catch { /* already gone */ }
      try { editor.detachCollab(); } catch { /* the editor closed first */ }
      awareness.destroy();
      doc.destroy();
    }
  };
}

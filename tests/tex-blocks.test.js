const test = require('node:test');
const assert = require('node:assert');
const { TEMPLATES } = require('../tex-templates');

const load = () => import('../renderer/js/tex-blocks.js');
const BS = String.fromCharCode(92);

const SAMPLE = [
  BS + 'documentclass{article}',
  BS + 'usepackage{amsmath}',
  BS + 'newcommand{' + BS + 'R}{' + BS + 'mathbb{R}}',
  BS + 'begin{document}',
  BS + 'maketitle',
  '',
  BS + 'section{Introduction}',
  'First paragraph with ' + BS + 'textbf{bold}, ' + BS + 'emph{italic},',
  'a wrapped line and math $x^2$ plus a cite ' + BS + 'cite{knuth84}.',
  '',
  '',
  BS + 'begin{itemize}',
  '  ' + BS + 'item One',
  '  ' + BS + 'item Two with ' + BS + 'textbf{bold}',
  BS + 'end{itemize}',
  '',
  BS + 'begin{equation}',
  '  E = mc^2',
  BS + 'end{equation}',
  '',
  BS + 'begin{table}[h]',
  BS + 'begin{tabular}{ll}',
  'a & b ' + BS + BS,
  '',
  'c & d ' + BS + BS,
  BS + 'end{tabular}',
  BS + 'end{table}',
  '',
  '% a comment line',
  'Paragraph with a trailing comment % hidden',
  '',
  BS + 'subsection{Details}' + BS + 'label{sec:d}',
  '',
  'Last paragraph, 100' + BS + '% sure and ' + BS + 'S4 stays.',
  BS + 'end{document}',
  ''
].join('\n');

test('a document with no edits is written back byte for byte', async () => {
  const { parseDocument, serializeDocument } = await load();
  for (const source of [SAMPLE, SAMPLE.replace(/\n/g, '\r\n'), SAMPLE.replace(/\n\n/g, '\n \n'), ...Object.values(TEMPLATES).flatMap((t) => Object.values(t.files))]) {
    const model = parseDocument(source);
    if (!model.ok) continue; // a .bib file is not a document
    assert.strictEqual(serializeDocument(model), source);
  }
});

test('blocks are recognised, and anything unusual stays raw', async () => {
  const { parseDocument } = await load();
  const model = parseDocument(SAMPLE);
  assert.ok(model.ok);
  assert.deepStrictEqual(model.blocks.map((b) => b.kind), ['raw', 'heading', 'paragraph', 'list', 'math', 'raw', 'raw', 'heading', 'paragraph']);
  assert.strictEqual(model.blocks[1].text, 'Introduction');
  assert.strictEqual(model.blocks[1].level, 1);
  assert.strictEqual(model.blocks[7].level, 2);
  assert.strictEqual(model.blocks[7].tail, BS + 'label{sec:d}');
  assert.deepStrictEqual(model.blocks[3].items, ['One', 'Two with ' + BS + 'textbf{bold}']);
  assert.strictEqual(model.blocks[4].math, 'E = mc^2');
  assert.strictEqual(model.blocks[5].env, 'table', 'a table with a blank line inside is still one block');
  assert.match(model.blocks[6].src, /trailing comment/, 'text with a comment is kept as source, not rewritten');
});

test('files that are not full documents are refused with a reason', async () => {
  const { parseDocument } = await load();
  assert.strictEqual(parseDocument('just some text').ok, false);
  assert.match(parseDocument(BS + 'begin{document} no end').reason, /end\{document\}/);
});

test('editing one paragraph changes only that paragraph', async () => {
  const { parseDocument, serializeDocument, updateBlock } = await load();
  const model = parseDocument(SAMPLE);
  const next = updateBlock(model, 2, { text: 'Rewritten paragraph.' });
  const out = serializeDocument(next);
  assert.ok(out.includes('Rewritten paragraph.'));
  assert.ok(!out.includes('First paragraph'));
  const before = SAMPLE.split('Rewritten')[0];
  const after = out.split('Rewritten paragraph.')[1];
  assert.strictEqual(out.startsWith(SAMPLE.slice(0, SAMPLE.indexOf('First paragraph'))), true);
  assert.ok(after.startsWith('\n\n\n' + BS + 'begin{itemize}'), 'the blank lines that followed are kept');
  assert.strictEqual(serializeDocument(model), SAMPLE, 'the old model is untouched');
  assert.ok(before.length > 0);
});

test('lists and headings are generated in standard form', async () => {
  const { parseDocument, serializeDocument, updateBlock } = await load();
  const model = parseDocument(SAMPLE);
  let next = updateBlock(model, 3, { items: ['A', 'B', 'C'], ordered: true });
  next = updateBlock(next, 1, { text: 'Opening', level: 2 });
  const out = serializeDocument(next);
  assert.ok(out.includes(BS + 'begin{enumerate}\n  ' + BS + 'item A\n  ' + BS + 'item B\n  ' + BS + 'item C\n' + BS + 'end{enumerate}'));
  assert.ok(out.includes(BS + 'subsection{Opening}'));
});

test('inline text round-trips marks, maths, chips and escapes', async () => {
  const { parseInline, serializeInline } = await load();
  const samples = [
    'plain',
    BS + 'textbf{bold ' + BS + 'emph{and italic}} then ' + BS + 'texttt{code}',
    'math $a_1 + b^2$ and ' + BS + '(x' + BS + ')',
    'see ' + BS + 'cite{a,b} and ' + BS + 'ref{fig:one} and ' + BS + 'href{http://x.org}{site}',
    '100' + BS + '% of ' + BS + '& and ' + BS + '_ and ' + BS + '#',
    'line one\nline two',
    'a ' + BS + BS + ' break',
    BS + 'cite[p.~3]{x}',
    '{' + BS + 'bf grouped} text'
  ];
  for (const s of samples) assert.strictEqual(serializeInline(parseInline(s)), s, s);
});

test('typed text is escaped so it cannot break the document', async () => {
  const { serializeInline } = await load();
  assert.strictEqual(serializeInline([{ t: 'text', text: '50% & more_stuff #1 {x} $5' }]), '50' + BS + '% ' + BS + '& more' + BS + '_stuff ' + BS + '#1 ' + BS + '{x' + BS + '} ' + BS + '$5');
  assert.strictEqual(serializeInline([{ t: 'text', text: 'a^b' + BS + 'c' }]), 'a' + BS + 'textasciicircum{}b' + BS + 'textbackslash{}c');
  assert.strictEqual(serializeInline([{ t: 'mark', kind: 'bold', children: [{ t: 'text', text: 'x' }] }]), BS + 'textbf{x}');
});

test('unbalanced input is refused instead of guessed at', async () => {
  const { parseInline } = await load();
  for (const bad of [BS + 'textbf{open', 'close}', '$unclosed', '$$display$$', BS + '(open']) assert.throws(() => parseInline(bad), undefined, bad);
});

test('a paragraph the visual editor cannot read safely becomes raw source', async () => {
  const { parseDocument, serializeDocument } = await load();
  const source = [BS + 'begin{document}', 'Broken ' + BS + 'textbf{brace', '', 'Fine paragraph.', BS + 'end{document}'].join('\n');
  const model = parseDocument(source);
  assert.deepStrictEqual(model.blocks.map((b) => b.kind), ['raw', 'paragraph']);
  assert.strictEqual(serializeDocument(model), source);
});

test('insert, delete and move keep the spacing sensible', async () => {
  const { parseDocument, serializeDocument, insertBlock, deleteBlock, moveBlock, newBlock } = await load();
  const source = [BS + 'begin{document}', 'One.', '', 'Two.', '', 'Three.', BS + 'end{document}', ''].join('\n');
  const model = parseDocument(source);
  const added = insertBlock(model, 2, newBlock('paragraph', { text: 'Four.' }));
  assert.strictEqual(serializeDocument(added), [BS + 'begin{document}', 'One.', '', 'Two.', '', 'Three.', '', 'Four.' + '\n' + BS + 'end{document}', ''].join('\n'));
  const removed = deleteBlock(model, 2);
  assert.strictEqual(serializeDocument(removed), [BS + 'begin{document}', 'One.', '', 'Two.' + '\n' + BS + 'end{document}', ''].join('\n'));
  const moved = moveBlock(model, 0, 1);
  assert.strictEqual(serializeDocument(moved), [BS + 'begin{document}', 'Two.', '', 'One.', '', 'Three.', BS + 'end{document}', ''].join('\n'));
  assert.strictEqual(moveBlock(model, 0, -1), model);
  const first = insertBlock(model, -1, newBlock('heading', { level: 1, text: 'Top' }));
  assert.ok(serializeDocument(first).startsWith(BS + 'begin{document}\n' + BS + 'section{Top}\n\nOne.'));
});

test('an empty document body can receive its first block', async () => {
  const { parseDocument, serializeDocument, insertBlock, newBlock } = await load();
  const model = parseDocument(BS + 'documentclass{article}\n' + BS + 'begin{document}\n' + BS + 'end{document}\n');
  assert.ok(model.ok);
  assert.strictEqual(model.blocks.length, 0);
  const out = serializeDocument(insertBlock(model, -1, newBlock('paragraph', { text: 'Hello' })));
  assert.ok(out.includes(BS + 'begin{document}\nHello\n' + BS + 'end{document}'));
});

test('editing raw source reclassifies the block', async () => {
  const { parseDocument, setRawSource, serializeDocument } = await load();
  const source = [BS + 'begin{document}', BS + 'newpage', '', 'Text.', BS + 'end{document}'].join('\n');
  const model = parseDocument(source);
  assert.strictEqual(model.blocks[0].kind, 'raw');
  const next = setRawSource(model, 0, BS + 'section{Now a heading}');
  assert.strictEqual(next.blocks[0].kind, 'heading');
  assert.ok(serializeDocument(next).includes(BS + 'section{Now a heading}\n\nText.'));
});

test('block descriptions read as plain words', async () => {
  const { describeBlock, newBlock } = await load();
  assert.strictEqual(describeBlock(newBlock('heading', { level: 2 })), 'Subsection');
  assert.strictEqual(describeBlock(newBlock('list', { ordered: true })), 'Numbered list');
  assert.strictEqual(describeBlock(newBlock('table')), 'Table');
  assert.strictEqual(describeBlock(newBlock('equation')), 'Equation');
});

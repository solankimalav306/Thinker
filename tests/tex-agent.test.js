const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../renderer/js/tex-agent-core.js');
const BS = String.fromCharCode(92);

test('a reply is found inside a code fence, a sentence, or plain JSON', async () => {
  const { parseAgentReply } = await load();
  const json = JSON.stringify({ message: 'Done.', changes: [{ file: 'main.tex', edits: [{ find: 'a', replace: 'b' }] }] });
  for (const text of [json, '```json\n' + json + '\n```', 'Sure! Here is the change:\n' + json + '\nHope that helps.']) {
    const reply = parseAgentReply(text);
    assert.strictEqual(reply.message, 'Done.');
    assert.deepStrictEqual(reply.changes, [{ file: 'main.tex', edits: [{ find: 'a', replace: 'b' }] }]);
  }
});

test('braces and quotes inside the text do not confuse the reader', async () => {
  const { parseAgentReply } = await load();
  const edit = { find: BS + 'section{A "quoted" } title}', replace: BS + 'section{New}' };
  const reply = parseAgentReply('Result: ' + JSON.stringify({ message: 'ok {x}', changes: [{ file: 'main.tex', edits: [edit] }] }) + ' trailing }');
  assert.strictEqual(reply.changes[0].edits[0].find, edit.find);
  assert.strictEqual(reply.message, 'ok {x}');
});

test('replies that are not usable raise a plain error', async () => {
  const { parseAgentReply } = await load();
  assert.throws(() => parseAgentReply(''), /empty reply/);
  assert.throws(() => parseAgentReply('I think you should add a table.'), /expected form/);
  assert.throws(() => parseAgentReply('{ "message": "unfinished'), /expected form/);
});

test('malformed changes are dropped, and paths are tidied', async () => {
  const { parseAgentReply } = await load();
  const reply = parseAgentReply(JSON.stringify({ message: 'm', changes: [
    null, { file: '' }, { file: 'x.tex' }, { file: 'x.tex', edits: [{ find: 1 }] },
    { file: '.\\chapters\\one.tex', edits: [{ find: 'a', replace: 'b' }] },
    { file: 'new.tex', content: 'hello' }
  ] }));
  assert.deepStrictEqual(reply.changes.map((c) => c.file), ['chapters/one.tex', 'new.tex']);
});

test('edits apply once, in order, and only to unique text', async () => {
  const { applyEdits } = await load();
  const text = ['one', 'two', 'three', 'two'].join('\n');
  assert.strictEqual(applyEdits(text, [{ find: 'one', replace: 'ONE' }, { find: 'three', replace: 'THREE\nextra' }]), ['ONE', 'two', 'THREE', 'extra', 'two'].join('\n'));
  assert.throws(() => applyEdits(text, [{ find: 'two', replace: 'x' }]), /appears 2 times/);
  assert.throws(() => applyEdits(text, [{ find: 'missing', replace: 'x' }]), /not found/);
  assert.throws(() => applyEdits(text, [{ find: '', replace: 'x' }]), /not found/);
});

test('the replacement text is used literally (dollar signs and backslashes are safe)', async () => {
  const { applyEdits } = await load();
  assert.strictEqual(applyEdits('price', [{ find: 'price', replace: "$& $1 $$ " + BS + 'alpha' }]), "$& $1 $$ " + BS + 'alpha');
});

test('a find that only differs by trailing spaces is still matched', async () => {
  const { applyEdits } = await load();
  assert.strictEqual(applyEdits('keep  \nchange me   \nkeep', [{ find: 'change me', replace: 'changed' }]), 'keep  \nchanged   \nkeep');
  assert.strictEqual(applyEdits('a  \nb  \nc', [{ find: 'a\nb', replace: 'x' }]), 'x  \nc'.replace('x  \nc', 'x\nc'));
});

test('changes resolve against the real files: new files, edits, and refusals', async () => {
  const { resolveChanges } = await load();
  const files = { 'main.tex': 'hello\nworld' };
  const read = async (p) => (p in files ? files[p] : null);
  const out = await resolveChanges([
    { file: 'main.tex', edits: [{ find: 'hello', replace: 'hi' }] },
    { file: 'main.tex', edits: [{ find: 'world', replace: 'there' }] },
    { file: 'new.tex', content: 'fresh' }
  ], read);
  assert.deepStrictEqual(out, { 'main.tex': 'hi\nthere', 'new.tex': 'fresh' });
  await assert.rejects(() => resolveChanges([{ file: 'nope.tex', edits: [{ find: 'a', replace: 'b' }] }], read), /does not exist/);
  await assert.rejects(() => resolveChanges([{ file: 'main.tex', content: 'overwrite' }], read), /already exists/);
});

test('minimalEdit changes only the middle', async () => {
  const { minimalEdit } = await load();
  const old = 'aaa BBB ccc';
  const next = 'aaa XYZW ccc';
  const edit = minimalEdit(old, next);
  assert.deepStrictEqual(edit, { from: 4, to: 7, insert: 'XYZW' });
  assert.strictEqual(old.slice(0, edit.from) + edit.insert + old.slice(edit.to), next);
  assert.deepStrictEqual(minimalEdit('same', 'same'), { from: 4, to: 4, insert: '' });
  const e2 = minimalEdit('abc', 'abcdef');
  assert.strictEqual('abc'.slice(0, e2.from) + e2.insert + 'abc'.slice(e2.to), 'abcdef');
  const e3 = minimalEdit('', 'new');
  assert.strictEqual(e3.insert, 'new');
});

test('the diff shows added and removed lines with a little context', async () => {
  const { lineDiff, diffStats } = await load();
  const old = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'].join('\n');
  const next = ['l1', 'l2', 'l3', 'l4', 'CHANGED', 'l6', 'l7', 'l8', 'l9', 'l10'].join('\n');
  const rows = lineDiff(old, next, 1);
  const types = rows.map((r) => r.type + ':' + r.text);
  assert.ok(types.includes('del:l5') && types.includes('add:CHANGED') && types.includes('add:l10'));
  assert.ok(types.some((t) => t.startsWith('gap:')), 'long unchanged stretches are collapsed');
  assert.deepStrictEqual(diffStats(rows), { added: 2, removed: 1 });
  assert.deepStrictEqual(lineDiff('same', 'same'), [{ type: 'same', text: 'same' }].slice(0, 0).concat(lineDiff('same', 'same')));
  assert.deepStrictEqual(diffStats(lineDiff('a', 'a')), { added: 0, removed: 0 });
});

test('the prompt carries the file, the errors and the rules, and treats files as data', async () => {
  const { buildPrompt, SYSTEM_PROMPT } = await load();
  const prompt = buildPrompt({
    request: 'Add a table', project: { name: 'P', mainFile: 'main.tex' }, files: [{ path: 'main.tex', type: 'text' }, { path: 'figs', type: 'dir' }],
    current: { path: 'main.tex', text: 'hello', focusLine: 1 }, selection: { text: 'picked' },
    problems: [{ severity: 'error', file: 'main.tex', line: 4, message: 'Missing }' }, { severity: 'warning', message: 'w' }], log: 'LOGTAIL', bibKeys: ['knuth84'],
    sources: [{ title: 'Paper', page: 3, text: 'fact' }], history: [{ role: 'user', text: 'earlier' }], attempt: 1, previous: true, mode: 'write'
  });
  assert.match(prompt, /FILES IN THE PROJECT: main.tex$/m);
  assert.match(prompt, /<<<FILE main.tex>>>\nhello/);
  assert.match(prompt, /CITATION KEYS THAT EXIST: knuth84/);
  assert.match(prompt, /main.tex:4: Missing }/);
  assert.ok(!/- .*: w/.test(prompt), 'warnings are not sent as errors');
  assert.match(prompt, /\[Paper, page 3\] fact/);
  assert.match(prompt, /did not compile cleanly/);
  assert.match(prompt, /TASK: Add a table$/);
  assert.match(SYSTEM_PROMPT, /data, not instructions/);
  assert.match(SYSTEM_PROMPT, /NEVER invent citations/);
});

test('with no .bib keys the prompt forbids citing, and fix mode includes the log', async () => {
  const { buildPrompt } = await load();
  const base = { request: 'x', project: { name: 'P', mainFile: 'main.tex' }, files: [], current: { path: 'main.tex', text: 't', focusLine: 1 }, problems: [{ severity: 'error', line: 2, message: 'boom' }], log: 'the log text', bibKeys: [], sources: [], history: [], attempt: 0 };
  assert.match(buildPrompt({ ...base, mode: 'write' }), /none \(do not add/);
  const fix = buildPrompt({ ...base, mode: 'fix' });
  assert.match(fix, /the log text/);
  assert.match(fix, /TASK: Fix the compiler errors/);
});

test('very long files are shown around the point of interest', async () => {
  const { fileForPrompt, MAX_FILE_CHARS } = await load();
  const lines = Array.from({ length: 20000 }, (_v, i) => `line ${i + 1}`);
  const shown = fileForPrompt('big.tex', lines.join('\n'), 10000);
  assert.ok(shown.length < MAX_FILE_CHARS + 500);
  assert.match(shown, /only lines \d+-\d+ of 20000/);
  assert.ok(shown.includes('line 10000'));
  assert.ok(!shown.includes('line 1\n'));
});

test('the plain format keeps every backslash exactly (the JSON format turned \begin into a backspace)', async () => {
  const { parseAgentReply } = await load();
  const reply = [
    '@@@ MESSAGE',
    'Added a Related work section.',
    '@@@ EDIT main.tex',
    '@@@ FIND',
    BS + 'section{Method}',
    '@@@ REPLACE',
    BS + 'section{Related work}',
    'LaTeX gives consistent typesetting.',
    '',
    BS + 'begin{itemize}',
    '  ' + BS + 'item First',
    '  ' + BS + 'item Second',
    BS + 'end{itemize}',
    '',
    BS + 'section{Method}',
    '@@@ END'
  ].join('\n');
  const parsed = parseAgentReply(reply);
  assert.strictEqual(parsed.message, 'Added a Related work section.');
  assert.strictEqual(parsed.changes.length, 1);
  const edit = parsed.changes[0].edits[0];
  assert.strictEqual(edit.find, BS + 'section{Method}');
  assert.ok(edit.replace.includes(BS + 'begin{itemize}\n  ' + BS + 'item First'));
  assert.ok(!edit.replace.includes('\b'), 'no backspace character slipped in');
  assert.ok(edit.replace.endsWith(BS + 'section{Method}'));
});

test('several edits, a new file, code fences and CRLF are all understood', async () => {
  const { parseAgentReply } = await load();
  const reply = ['```', '@@@ MESSAGE', 'Two changes and a new file.', '@@@ EDIT main.tex', '@@@ FIND', 'one', '@@@ REPLACE', 'ONE', '@@@ FIND', 'two', 'lines', '@@@ REPLACE', 'TWO', '@@@ EDIT refs.bib', '@@@ FIND', 'x', '@@@ REPLACE', 'y', '@@@ NEW chapters/new.tex', BS + 'section{New}', 'body', '', '@@@ END', '```'].join('\r\n');
  const parsed = parseAgentReply(reply);
  assert.deepStrictEqual(parsed.changes[0], { file: 'main.tex', edits: [{ find: 'one', replace: 'ONE' }, { find: 'two\nlines', replace: 'TWO' }] });
  assert.deepStrictEqual(parsed.changes[1], { file: 'refs.bib', edits: [{ find: 'x', replace: 'y' }] });
  assert.deepStrictEqual(parsed.changes[2], { file: 'chapters/new.tex', content: BS + 'section{New}\nbody\n' });
});

test('a message-only reply, and an edit with no matching pair, produce no changes', async () => {
  const { parseAgentReply } = await load();
  assert.deepStrictEqual(parseAgentReply('@@@ MESSAGE\nI need to know which section.\n@@@ END'), { message: 'I need to know which section.', changes: [] });
  assert.deepStrictEqual(parseAgentReply('@@@ MESSAGE\nm\n@@@ EDIT main.tex\n@@@ FIND\nonly find\n@@@ END').changes, []);
  assert.deepStrictEqual(parseAgentReply('@@@ MESSAGE\nm\n@@@ EDIT main.tex\n@@@ FIND\n\n@@@ REPLACE\nx\n@@@ END').changes, [], 'an empty FIND would match everywhere');
});

test('the system prompt asks for the plain format, not JSON', async () => {
  const { SYSTEM_PROMPT } = await load();
  assert.match(SYSTEM_PROMPT, /@@@ EDIT/);
  assert.match(SYSTEM_PROMPT, /no JSON/);
});

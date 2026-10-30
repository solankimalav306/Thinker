const test = require('node:test');
const assert = require('node:assert');
require('../renderer/js/artifact-spec.js');
const S = globalThis.TKSpec; // the file is a plain script: it puts itself on the global object

test('the list of kinds is small and every one says what it is for', () => {
  const kinds = Object.keys(S.TYPES);
  assert.ok(kinds.length <= 12);
  for (const k of kinds) {
    assert.ok(S.TYPES[k].label && S.TYPES[k].hint && S.TYPES[k].icon, k);
  }
  assert.ok(S.isLive('quiz') && S.isLive('diagram'));
  assert.ok(!S.isLive('page') && !S.isLive('slides') && !S.isLive('nonsense'));
  assert.ok(S.isKnown('page') && !S.isKnown('nonsense'));
});

test('a checklist accepts plain strings, groups and the usual mistakes', () => {
  const flat = S.validate('checklist', { items: ['Read the brief', { text: 'Pick a dataset', note: 'at least 3M cells', cite: 'Guide|2' }, { text: '' }, 42] });
  assert.ok(flat.ok);
  assert.strictEqual(flat.spec.groups.length, 1);
  assert.deepStrictEqual(flat.spec.groups[0].items.map((i) => i.text), ['Read the brief', 'Pick a dataset']);
  assert.strictEqual(flat.spec.groups[0].items[1].cite, 'Guide|2');
  const grouped = S.validate('checklist', { groups: [{ title: 'Before', items: ['a'] }, { title: 'Empty', items: [] }, { title: 'After', items: ['b'] }] });
  assert.deepStrictEqual(grouped.spec.groups.map((g) => g.title), ['Before', 'After']);
  assert.strictEqual(S.validate('checklist', { items: [] }).ok, false);
});

test('a citation that is not "Document|page" is dropped, not trusted', () => {
  const r = S.validate('steps', { steps: [{ title: 'a', cite: 'Guide|2' }, { title: 'b', cite: 'page two' }, { title: 'c', cite: '<script>|1' }] });
  assert.deepStrictEqual(r.spec.steps.map((s) => s.cite), ['Guide|2', '', '<script>|1']);
  // the shape is kept; what a citation may open is decided later by the app, against the sources the answer was given
  assert.deepStrictEqual(S.citations('steps', r.spec), ['Guide|2', '<script>|1']);
});

test('quiz questions need two options and an answer that points at one', () => {
  const r = S.validate('quiz', { questions: [
    { q: 'Capital of France?', options: ['Paris', 'Rome'], answer: 0, why: 'Paris.' },
    { q: 'True or false?', answer: true },
    { q: 'Bad answer index', options: ['a', 'b'], answer: 5 },
    { q: 'One option', options: ['a'], answer: 0 },
    { q: '', options: ['a', 'b'], answer: 0 }
  ] });
  assert.ok(r.ok);
  assert.strictEqual(r.spec.questions.length, 2);
  assert.deepStrictEqual(r.spec.questions[1].options, ['True', 'False']);
  assert.strictEqual(r.spec.questions[1].answer, 0);
});

test('flashcards, timeline and document keep what is usable', () => {
  assert.strictEqual(S.validate('flashcards', { cards: [{ front: 'Term', back: 'Meaning' }, { front: 'No back' }] }).spec.cards.length, 1);
  assert.strictEqual(S.validate('timeline', { events: [{ when: '1 Mar', title: 'Drills change' }, { when: 'x' }] }).spec.events.length, 1);
  assert.strictEqual(S.validate('document', { sections: ['One paragraph', { heading: 'H', text: 'T' }, {}] }).spec.sections.length, 2);
});

test('a table is squared off: every row has a cell for every column', () => {
  const r = S.validate('table', { columns: ['Rule', 'Value'], rows: [['Muster', '8 min'], ['Short'], { Rule: 'Drills', Value: '14 days' }, []] });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.spec.rows, [['Muster', '8 min'], ['Short', ''], ['Drills', '14 days']]);
  assert.strictEqual(S.validate('table', { columns: [], rows: [['a']] }).ok, false);
});

test('a chart needs numbers; labels are filled in when missing; the kind falls back to bar', () => {
  const r = S.validate('chart', { kind: 'radar', series: [{ name: 'Sales', values: [1, '2', 'x', 4] }] });
  assert.ok(r.ok);
  assert.strictEqual(r.spec.kind, 'bar');
  assert.deepStrictEqual(r.spec.series[0].values, [1, 2, null, 4]);
  assert.deepStrictEqual(r.spec.labels, ['1', '2', '3', '4']);
  assert.strictEqual(S.validate('chart', { series: [{ values: ['a', 'b'] }] }).ok, false);
});

test('a diagram keeps only edges between nodes that exist, and needs two nodes', () => {
  const r = S.validate('diagram', { nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'End' }, { id: 'a', label: 'dup' }], edges: [{ from: 'a', to: 'b', label: 'go' }, { from: 'a', to: 'zzz' }, { from: 'a', to: 'a' }] });
  assert.ok(r.ok);
  assert.strictEqual(r.spec.nodes.length, 2);
  assert.deepStrictEqual(r.spec.edges, [{ from: 'a', to: 'b', label: 'go' }]);
  assert.strictEqual(S.validate('diagram', { nodes: [{ label: 'only' }] }).ok, false);
});

test('text around or fenced from the JSON is tolerated; rubbish is refused with a reason', () => {
  const fenced = '```json\n{"items":["a","b"]}\n```';
  assert.ok(S.parse('checklist', fenced).ok);
  assert.ok(S.parse('checklist', 'Here you go: {"items":["a"]} hope that helps').ok);
  for (const bad of ['', 'no json here', '{broken', '[1,2]', '{"items":[]}']) {
    const r = S.parse('checklist', bad);
    assert.strictEqual(r.ok, false, bad);
    assert.ok(r.error);
  }
  assert.strictEqual(S.parse('page', '{}').ok, false);
});

test('sizes are capped so one artifact cannot freeze a window', () => {
  const huge = S.validate('checklist', { items: Array.from({ length: 5000 }, (_v, i) => 'x'.repeat(5000) + i) });
  assert.ok(huge.spec.groups[0].items.length <= S.LIMITS.items);
  assert.ok(huge.spec.groups[0].items[0].text.length <= S.LIMITS.text);
  const many = S.validate('table', { columns: Array.from({ length: 100 }, (_v, i) => 'c' + i), rows: Array.from({ length: 5000 }, () => ['a']) });
  assert.ok(many.spec.columns.length <= S.LIMITS.columns && many.spec.rows.length <= S.LIMITS.rows);
});

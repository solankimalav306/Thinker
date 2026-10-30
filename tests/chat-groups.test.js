const test = require('node:test');
const assert = require('node:assert');

const NOW = new Date(2026, 9, 22, 15, 0, 0).getTime();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const chat = (title, ago, extra = {}) => ({ id: title, title, updatedAt: NOW - ago, messageCount: 2, preview: '', pinned: false, ...extra });

test('groups chats into Pinned, Today, Yesterday and Earlier, newest first', async () => {
  const { groupConversations } = await import('../renderer/js/chat-groups.js');
  const groups = groupConversations([
    chat('old', 5 * DAY),
    chat('earlier today', 1 * HOUR),
    chat('this morning', 6 * HOUR),
    chat('last night', 17 * HOUR),
    chat('keep', 9 * DAY, { pinned: true })
  ], '', NOW);
  assert.deepStrictEqual(groups.map((g) => g.label), ['Pinned', 'Today', 'Yesterday', 'Earlier']);
  assert.deepStrictEqual(groups[1].items.map((c) => c.title), ['earlier today', 'this morning']);
});

test('empty groups are dropped', async () => {
  const { groupConversations } = await import('../renderer/js/chat-groups.js');
  assert.deepStrictEqual(groupConversations([chat('a', HOUR)], '', NOW).map((g) => g.label), ['Today']);
  assert.deepStrictEqual(groupConversations([], '', NOW), []);
});

test('search matches the title or the last answer, ignoring case', async () => {
  const { groupConversations } = await import('../renderer/js/chat-groups.js');
  const list = [chat('Scheduler basics', HOUR), chat('Other', 2 * HOUR, { preview: 'The TIMER tick preempts' })];
  assert.strictEqual(groupConversations(list, 'scheduler', NOW)[0].items.length, 1);
  assert.strictEqual(groupConversations(list, 'timer', NOW)[0].items[0].title, 'Other');
  assert.deepStrictEqual(groupConversations(list, 'nothing like this', NOW), []);
});

test('friendly times', async () => {
  const { timeAgo, messageCountLabel } = await import('../renderer/js/chat-groups.js');
  assert.strictEqual(timeAgo(NOW - 10 * 1000, NOW), 'just now');
  assert.strictEqual(timeAgo(NOW - 5 * 60 * 1000, NOW), '5 min ago');
  assert.strictEqual(timeAgo(NOW - 3 * HOUR, NOW), '3 h ago');
  assert.strictEqual(timeAgo(NOW - 30 * HOUR, NOW), 'yesterday');
  assert.strictEqual(timeAgo(NOW - 4 * DAY, NOW), '4 days ago');
  assert.strictEqual(messageCountLabel(1), '1 message');
  assert.strictEqual(messageCountLabel(0), '0 messages');
  assert.strictEqual(messageCountLabel(5), '5 messages');
});

test('provider errors become one plain sentence with a next step', async () => {
  const { friendlyAgentError } = await import('../renderer/js/chat-groups.js');
  assert.match(friendlyAgentError("504 DEADLINE_EXCEEDED. {'error': {'code': 504}}"), /took too long/);
  assert.match(friendlyAgentError('503 UNAVAILABLE: model overloaded'), /busy/);
  assert.match(friendlyAgentError('429 RESOURCE_EXHAUSTED quota'), /usage limit/);
  assert.match(friendlyAgentError('API key not valid. Please pass a valid API key.'), /rejected your key/);
  assert.match(friendlyAgentError('404 model gemini-2.5-flash-lite is no longer available'), /not available any more/);
  assert.match(friendlyAgentError('getaddrinfo ENOTFOUND generativelanguage.googleapis.com'), /could not reach/);
  assert.match(friendlyAgentError(''), /did not send an answer/);
  assert.match(friendlyAgentError('something odd'), /^The AI request failed: something odd/);
});

test('citations in an answer become buttons for the right document and page', async () => {
  const { splitCitations } = await import('../renderer/js/chat-groups.js');
  const docs = [{ title: 'Handbook', path: 'a.pdf' }, { title: 'Legal notes', path: 'b.pdf' }];
  const parts = splitCitations('Fuel is 42 t/day [Handbook, page 5]. Law differs [Legal notes, page 2; Handbook, p. 9] done.', docs);
  assert.deepStrictEqual(parts.map((p) => (p.cite ? `${p.cite.doc.title}:${p.cite.page}` : p.text)), ['Fuel is 42 t/day ', 'Handbook:5', '. Law differs ', 'Legal notes:2', 'Handbook:9', ' done.']);
});

test('citations that are not ours stay as text, and titles match loosely', async () => {
  const { splitCitations } = await import('../renderer/js/chat-groups.js');
  const docs = [{ title: 'Annual Report 2024.pdf', path: 'r.pdf' }];
  assert.deepStrictEqual(splitCitations('See [Page 3] and [Unknown, page 4].', docs).map((p) => p.text ?? 'CITE').join(''), 'See [Page 3] and [Unknown, page 4].');
  const loose = splitCitations('[annual report 2024, page 7]', docs);
  assert.strictEqual(loose[0].cite.page, 7);
  assert.deepStrictEqual(splitCitations('no citations here', docs), [{ text: 'no citations here' }]);
  assert.deepStrictEqual(splitCitations('', docs), []);
});

test('"pages 1 and 2" and "pp. 3" count as citations too', async () => {
  const { splitCitations } = await import('../renderer/js/chat-groups.js');
  const docs = [{ title: 'Safety Bulletin 2024', path: 's.pdf' }];
  const parts = splitCitations('Every 14 days [Safety Bulletin 2024, pages 1 and 2] and [Safety Bulletin 2024, pp. 3].', docs);
  assert.deepStrictEqual(parts.filter((p) => p.cite).map((p) => p.cite.page), [1, 3]);
});

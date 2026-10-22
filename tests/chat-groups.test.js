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

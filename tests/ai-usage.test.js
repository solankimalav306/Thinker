const test = require('node:test');
const assert = require('node:assert');
const { normalizeUsage: fromProvider } = require('../llm-handler');

const load = () => import('../renderer/js/ai-usage.js');

test('each provider\'s way of reporting cost becomes one shape (main process)', () => {
  assert.deepStrictEqual(fromProvider({ promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 150 }), { prompt_tokens: 100, response_tokens: 50, total_tokens: 150 });
  assert.deepStrictEqual(fromProvider({ prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 }), { prompt_tokens: 5, response_tokens: 7, total_tokens: 12 });
  assert.strictEqual(fromProvider(null), null);
  assert.strictEqual(fromProvider({}), null);
  assert.strictEqual(fromProvider('x'), null);
});

test('the app accepts what the backend, a provider or an older entry sends', async () => {
  const { normalizeUsage } = await load();
  assert.deepStrictEqual(normalizeUsage({ prompt_tokens: 10, response_tokens: 4, total_tokens: 14, profile_id: 'p' }), { prompt_tokens: 10, response_tokens: 4, total_tokens: 14, profile_id: 'p' });
  const gemini = normalizeUsage({ promptTokenCount: 8, totalTokenCount: 20 });
  assert.strictEqual(gemini.response_tokens, 12);
  assert.strictEqual(gemini.total_tokens, 20);
  assert.strictEqual(normalizeUsage({ prompt_tokens: 0, response_tokens: 0, total_tokens: 0 }), null);
  assert.strictEqual(normalizeUsage(undefined), null);
  assert.strictEqual(normalizeUsage({ prompt_tokens: 'many' }), null);
});

test('usage can be narrowed to today, the last week or everything', async () => {
  const { filterByPeriod, describeTokens } = await import('../renderer/js/token-usage.js');
  const now = new Date(2026, 9, 30, 15, 0, 0).getTime();
  const hours = (h) => now - h * 3600 * 1000;
  const rows = [{ timestamp: hours(1), total_tokens: 1 }, { timestamp: hours(20), total_tokens: 2 }, { timestamp: hours(24 * 5), total_tokens: 3 }, { timestamp: hours(24 * 20), total_tokens: 4 }];
  assert.deepStrictEqual(filterByPeriod(rows, 'today', now).map((r) => r.total_tokens), [1]);
  assert.deepStrictEqual(filterByPeriod(rows, 'week', now).map((r) => r.total_tokens), [1, 2, 3]);
  assert.strictEqual(filterByPeriod(rows, 'all', now).length, 4);
  assert.deepStrictEqual(filterByPeriod([], 'today', now), []);
  // a row with no time is treated as old, never as today
  assert.strictEqual(filterByPeriod([{ total_tokens: 9 }], 'today', now).length, 0);

  assert.strictEqual(describeTokens(10), '');
  assert.match(describeTokens(2000), /about 1\.5K words/);
  assert.match(describeTokens(8000), /roughly 12 pages|roughly 12\.0 pages|roughly 12/);
  assert.match(describeTokens(500), /about 375 words/);
});

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

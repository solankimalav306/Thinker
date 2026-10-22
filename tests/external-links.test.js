const test = require('node:test');
const assert = require('node:assert');
const { isAllowedExternalUrl } = require('../external-links');

test('the known help pages are allowed', () => {
  for (const url of ['https://aistudio.google.com/apikey', 'https://ollama.com/download', 'https://openrouter.ai/keys']) {
    assert.strictEqual(isAllowedExternalUrl(url), true, url);
  }
});

test('anything else is refused', () => {
  const bad = [
    'http://aistudio.google.com/apikey', // not https
    'https://evil.example/apikey', // other host
    'https://aistudio.google.com.evil.example/', // look-alike host
    'https://user:pass@ollama.com/', // credentials in the URL
    'https://ollama.com:8443/', // unusual port
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-msdt:/id PCWDiagnostic',
    '',
    null,
    undefined,
    42,
    {}
  ];
  for (const url of bad) assert.strictEqual(isAllowedExternalUrl(url), false, String(url));
});

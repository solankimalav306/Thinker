const test = require('node:test');
const assert = require('node:assert');

test('PDF.js failures are classified into plain categories', async () => {
  const { classifyLoadError } = await import('../renderer/js/pdf-controller.js');
  const err = (name, message, code) => Object.assign(new Error(message), { name, code });
  assert.strictEqual(classifyLoadError(err('PasswordException', 'No password given', 1)).kind, 'password');
  assert.strictEqual(classifyLoadError(err('PasswordException', 'Incorrect Password', 2)).kind, 'wrong-password');
  assert.strictEqual(classifyLoadError(err('InvalidPDFException', 'Invalid PDF structure.')).kind, 'invalid');
  assert.strictEqual(classifyLoadError(err('InvalidPDFException', 'The PDF file is empty, i.e. its size is zero bytes.')).kind, 'empty');
  assert.strictEqual(classifyLoadError(err('MissingPDFException', 'Missing PDF "file:///x.pdf".')).kind, 'missing');
  assert.strictEqual(classifyLoadError(err('UnknownErrorException', 'net::ERR_FILE_NOT_FOUND')).kind, 'missing');
  assert.strictEqual(classifyLoadError(err('Error', 'something odd')).kind, 'unknown');
  assert.strictEqual(classifyLoadError(null).kind, 'unknown');
});

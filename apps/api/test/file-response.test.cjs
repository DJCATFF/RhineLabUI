const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fileRange, fileDisposition } = require('../dist/documents/file-response');

test('single HTTP byte ranges support full, open, suffix and clipped end', () => {
  for (const [header, offset, length, partial] of [
    [undefined, 0, 100, false],
    ['bytes=10-19', 10, 10, true],
    ['bytes=90-', 90, 10, true],
    ['bytes=-10', 90, 10, true],
    ['bytes=90-999', 90, 10, true],
    ['bytes=-999', 0, 100, true],
  ]) {
    assert.deepEqual(fileRange(header, 100), { offset, length, partial });
  }
});
test('unsatisfiable, multiple and malformed ranges return 416', () => {
  for (const header of [
    'bytes=100-',
    'bytes=9-1',
    'bytes=-0',
    'bytes=-',
    'bytes=1-2,5-6',
    'items=0-1',
    'bytes=abc-2',
    'bytes=9007199254740992-',
  ]) {
    assert.throws(
      () => fileRange(header, 100),
      (e) => e.getStatus() === 416 && e.size === 100,
    );
  }
});
test('download filenames encode Chinese and header metacharacters', () => {
  const value = fileDisposition('中文"\r\n(1).pdf', false);
  assert.ok(value.startsWith('attachment;'));
  assert.ok(value.includes('%E4%B8%AD%E6%96%87%22%0D%0A%281%29.pdf'));
  assert.ok(!/[\r\n]/.test(value));
  assert.ok(fileDisposition('a.pdf', true).startsWith('inline;'));
});

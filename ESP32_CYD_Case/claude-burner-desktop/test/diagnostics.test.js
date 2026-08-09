'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Diagnostics, safeValue } = require('../src/diagnostics');

test('diagnostics redact credentials and retain bounded actionable events', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'burner-diagnostics-'));
  const diagnostics = new Diagnostics(root, { version: '1.3.1' });
  diagnostics.record('usage.failed', {
    message: 'ANTHROPIC_API_KEY=sk-ant-secretvalue',
    authToken: 'must-not-appear',
    port: '/dev/cu.usbserial-10',
  });
  const text = diagnostics.text({ state: 'waiting' });
  assert.match(text, /usage\.failed/);
  assert.match(text, /usbserial-10/);
  assert.doesNotMatch(text, /secretvalue|must-not-appear/);
  assert.ok(fs.statSync(diagnostics.logPath).mode & 0o600);
});

test('diagnostic sanitization truncates nested and oversized values', () => {
  const result = safeValue({ payload: 'x'.repeat(2000), nested: { prompt: 'private' } });
  assert.ok(result.payload.length < 1300);
  assert.equal(result.nested.prompt, '[redacted]');
});

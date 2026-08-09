'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_BYTES = 768 * 1024;
const MAX_MEMORY_EVENTS = 240;
const MAX_STRING = 1200;

function safeValue(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const scrubbed = value
      .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/(?:ANTHROPIC_(?:API_KEY|AUTH_TOKEN))\s*[=:]\s*\S+/gi, '$1=[redacted]');
    return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((entry) => safeValue(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 60)) {
      if (/(?:credential|secret|token|api.?key|conversation|prompt)/i.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = safeValue(entry, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

class Diagnostics {
  constructor(logDirectory, base = {}) {
    this.logDirectory = logDirectory;
    this.logPath = path.join(logDirectory, 'claude-burner.jsonl');
    this.base = safeValue(base);
    this.events = [];
    fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  }

  rotateIfNeeded() {
    try {
      const stat = fs.statSync(this.logPath);
      if (stat.size <= MAX_LOG_BYTES) return;
      const previous = `${this.logPath}.previous`;
      try { fs.unlinkSync(previous); } catch { /* absent */ }
      fs.renameSync(this.logPath, previous);
    } catch { /* first write */ }
  }

  record(event, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      event: String(event || 'unknown'),
      ...this.base,
      details: safeValue(details),
    };
    this.events.push(entry);
    if (this.events.length > MAX_MEMORY_EVENTS) this.events.shift();
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      fs.chmodSync(this.logPath, 0o600);
    } catch { /* diagnostics must never break the app */ }
    return entry;
  }

  text(summary = {}) {
    return [
      'Claude Burner diagnostics',
      JSON.stringify(safeValue({ ...this.base, ...summary }), null, 2),
      '',
      'Recent events',
      ...this.events.map((event) => JSON.stringify(event)),
    ].join('\n');
  }
}

module.exports = {
  Diagnostics,
  MAX_LOG_BYTES,
  MAX_MEMORY_EVENTS,
  safeValue,
};

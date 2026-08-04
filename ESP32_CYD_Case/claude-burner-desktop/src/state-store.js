'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createInitialState, STATE_VERSION } = require('./pet-engine');

class StateStore {
  constructor(applicationSupportPath) {
    this.directory = applicationSupportPath;
    this.filePath = path.join(applicationSupportPath, 'pet-state.json');
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  load(now = Date.now()) {
    this.ensureDirectory();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed.version !== STATE_VERSION) {
        return createInitialState(now, parsed);
      }
      return createInitialState(now, parsed);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      return createInitialState(now);
    }
  }

  save(state) {
    this.ensureDirectory();
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(descriptor, payload, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, this.filePath);
    return this.filePath;
  }
}

module.exports = { StateStore };

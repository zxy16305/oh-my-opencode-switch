import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

const originalHomedir = os.homedir;

describe('init module exports', () => {
  let testHomeDir;

  beforeEach(async () => {
    testHomeDir = path.join(os.tmpdir(), 'oos-unit-test-init-' + Date.now());
    await fs.mkdir(testHomeDir, { recursive: true });
    os.homedir = () => testHomeDir;
  });

  afterEach(async () => {
    os.homedir = originalHomedir;
    try {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    } catch {
      // eslint-disable-line no-empty
    }
  });

  it('should export initAction function', async () => {
    const { initAction } = await import('../../../src/commands/init.js');
    assert.equal(typeof initAction, 'function', 'initAction should be a function');
  });

  it('should export registerInitCommand function', async () => {
    const { registerInitCommand } = await import('../../../src/commands/init.js');
    assert.equal(
      typeof registerInitCommand,
      'function',
      'registerInitCommand should be a function'
    );
  });
});

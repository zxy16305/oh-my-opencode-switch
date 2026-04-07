import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

describe('init module exports', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
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

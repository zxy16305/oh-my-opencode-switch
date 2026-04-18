import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLogs,
  flushLogs,
  logAccess,
  onLogAdded,
  resetLogState,
  resetWriteQueue,
} from '../../../src/utils/access-log.js';
import { cleanupTestHome, setupTestHome } from '../../helpers/test-home.js';

describe('access log callbacks', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    await flushLogs();
    resetWriteQueue();
    resetLogState();
    await clearLogs();
  });

  afterEach(async () => {
    await flushLogs();
    await cleanupTestHome(testHome);
  });

  it('should unsubscribe log listeners cleanly', async () => {
    let callbackCount = 0;
    const unsubscribe = onLogAdded(() => {
      callbackCount += 1;
    });

    await logAccess({
      sessionId: 'callback-1',
      provider: 'test-provider',
      model: 'test-model',
      virtualModel: 'test-virtual-model',
      status: 200,
    });

    assert.equal(callbackCount, 1);

    unsubscribe();

    await logAccess({
      sessionId: 'callback-2',
      provider: 'test-provider',
      model: 'test-model',
      virtualModel: 'test-virtual-model',
      status: 200,
    });

    assert.equal(callbackCount, 1);
  });
});

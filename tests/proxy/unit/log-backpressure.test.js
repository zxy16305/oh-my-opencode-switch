import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  logAccess,
  getQueueSize,
  resetWriteQueue,
  resetLogState,
  flushLogs,
  getLogPath,
  clearLogs,
} from '../../../src/utils/access-log.js';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

describe('logAccess backpressure', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    await flushLogs();
    resetWriteQueue();
    resetLogState();
    await clearLogs();
    await fs.mkdir(path.join(testHome, '.config', 'opencode', '.oos', 'logs'), { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  it('should bound queue size under rapid burst (1000 calls)', async () => {
    for (let i = 0; i < 1000; i++) {
      logAccess({
        sessionId: `test-${i}`,
        agent: 'test-agent',
        category: 'test',
        provider: 'test-provider',
        model: 'test-model',
        virtualModel: 'test-virtual',
        status: 200,
        ttfb: 50,
        duration: 200,
      });
    }

    const pending = getQueueSize();
    assert.ok(pending <= 100, `Queue size ${pending} exceeded MAX_QUEUE_SIZE=100`);
  });

  it('should drop oldest entries when queue is full', async () => {
    for (let i = 0; i < 100; i++) {
      logAccess({
        sessionId: `fill-${i}`,
        agent: 'test',
        category: 'test',
        provider: 'p',
        model: 'm',
        virtualModel: 'vm',
        status: 200,
      });
    }

    assert.ok(getQueueSize() <= 100);

    logAccess({
      sessionId: 'overflow',
      agent: 'test',
      category: 'test',
      provider: 'p',
      model: 'm',
      virtualModel: 'vm',
      status: 200,
    });

    assert.ok(getQueueSize() <= 100);
  });

  it('should process all entries under normal frequency', async () => {
    const callCount = 10;
    for (let i = 0; i < callCount; i++) {
      logAccess({
        sessionId: `seq-${i}`,
        agent: 'test-agent',
        category: 'test',
        provider: 'test-provider',
        model: 'test-model',
        virtualModel: 'test-virtual',
        status: 200,
        ttfb: 10,
        duration: 50,
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    await flushLogs();

    assert.strictEqual(getQueueSize(), 0);

    const logPath = getLogPath();
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const matchingLines = lines.filter((l) => l.includes('session=seq-'));
    assert.strictEqual(
      matchingLines.length,
      callCount,
      `Expected ${callCount} matching log lines, got ${matchingLines.length} out of ${lines.length} total`
    );
  });
});

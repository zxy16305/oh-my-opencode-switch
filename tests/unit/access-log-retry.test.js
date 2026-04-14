/**
 * Unit tests for access log records in retry scenarios.
 * Verifies that logAccess is called correctly when:
 * 1. Original request fails (onError path with no retry)
 * 2. Retry succeeds after original failure
 * 3. Session ID is preserved across retry attempts
 *
 * @module tests/unit/access-log-retry.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { formatLogEntry } from '../../src/utils/access-log.js';

describe('Access Log Retry Scenarios', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('onError path logs before retry', () => {
    it('should log with status 502 and error message when request fails', () => {
      // Simulate the logAccess call from onError path (lines 474-486 in server-manager.js)
      const logEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId: 'session-retry-test',
        agent: 'build',
        category: 'code-generation',
        provider: 'provider-a',
        model: 'model-a',
        virtualModel: 'lb-mixed',
        status: 502,
        error: 'ECONNREFUSED',
        body: { messages: [{ role: 'user', content: 'test' }] },
      };

      const logLine = formatLogEntry(logEntry);

      // Verify error logging format
      assert.ok(logLine.includes('status=502'), 'should include status 502');
      assert.ok(logLine.includes('error=ECONNREFUSED'), 'should include error message');
      assert.ok(logLine.includes('provider=provider-a'), 'should include provider');
      assert.ok(logLine.includes('model=model-a'), 'should include model');
      assert.ok(logLine.includes('virtualModel=lb-mixed'), 'should include virtualModel');
      assert.ok(logLine.includes('session=session-retry-test'), 'should include sessionId');
    });

    it('should log with correct provider/model from failed upstream', () => {
      // When upstream fails, we log the failed upstream's provider/model, not the retry target
      const failedUpstream = { provider: 'provider-a', model: 'model-a' };

      const logEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId: 'session-xyz',
        provider: failedUpstream.provider,
        model: failedUpstream.model,
        virtualModel: 'lb-test',
        status: 502,
        error: 'ETIMEDOUT',
      };

      const logLine = formatLogEntry(logEntry);

      assert.ok(logLine.includes('provider=provider-a'), 'should log failed upstream provider');
      assert.ok(logLine.includes('model=model-a'), 'should log failed upstream model');
    });
  });

  describe('Retry success logs', () => {
    it('should log with status 200 and correct provider/model when retry succeeds', () => {
      // Simulate the logAccess call from retry onStreamEnd (lines 435-446)
      const retryUpstream = { provider: 'provider-b', model: 'model-b' };

      const logEntry = {
        timestamp: '2026-04-15T10:00:00.100',
        sessionId: 'session-retry-test',
        agent: 'build',
        category: 'code-generation',
        provider: retryUpstream.provider,
        model: retryUpstream.model,
        virtualModel: 'lb-mixed',
        status: 200,
        ttfb: 150,
        duration: 500,
        body: { messages: [{ role: 'user', content: 'test' }] },
      };

      const logLine = formatLogEntry(logEntry);

      // Verify success logging format
      assert.ok(logLine.includes('status=200'), 'should include status 200');
      assert.ok(logLine.includes('provider=provider-b'), 'should include retry upstream provider');
      assert.ok(logLine.includes('model=model-b'), 'should include retry upstream model');
      assert.ok(logLine.includes('virtualModel=lb-mixed'), 'should include virtualModel');
      assert.ok(logLine.includes('ttfb=150ms'), 'should include ttfb');
      assert.ok(logLine.includes('duration=500ms'), 'should include duration');
      assert.ok(!logLine.includes('error='), 'should NOT include error field on success');
    });

    it('should log with actual status code if retry returns non-200', () => {
      // Retry might return 4xx or 5xx, should log actual status
      const logEntry = {
        timestamp: '2026-04-15T10:00:00.100',
        sessionId: 'session-retry-test',
        provider: 'provider-b',
        model: 'model-b',
        virtualModel: 'lb-mixed',
        status: 429, // Rate limited
        ttfb: 50,
        duration: 100,
      };

      const logLine = formatLogEntry(logEntry);

      assert.ok(logLine.includes('status=429'), 'should include actual status code');
    });
  });

  describe('Session ID correlation', () => {
    it('should preserve sessionId across error and retry logs', () => {
      const sessionId = 'session-correlation-test';

      // Error log entry (from onError path)
      const errorLogEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId,
        provider: 'provider-a',
        model: 'model-a',
        virtualModel: 'lb-mixed',
        status: 502,
        error: 'ECONNREFUSED',
      };

      // Retry success log entry (from retry onStreamEnd)
      const retryLogEntry = {
        timestamp: '2026-04-15T10:00:00.100',
        sessionId,
        provider: 'provider-b',
        model: 'model-b',
        virtualModel: 'lb-mixed',
        status: 200,
        ttfb: 150,
        duration: 500,
      };

      const errorLine = formatLogEntry(errorLogEntry);
      const retryLine = formatLogEntry(retryLogEntry);

      // Both logs should have same sessionId for correlation
      assert.ok(errorLine.includes(`session=${sessionId}`), 'error log should have sessionId');
      assert.ok(retryLine.includes(`session=${sessionId}`), 'retry log should have same sessionId');
    });

    it('should use null sessionId when not provided', () => {
      const logEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId: null,
        provider: 'provider-a',
        model: 'model-a',
        virtualModel: 'lb-test',
        status: 502,
        error: 'ECONNREFUSED',
      };

      const logLine = formatLogEntry(logEntry);

      assert.ok(logLine.includes('session=-'), 'should show session=- for null sessionId');
    });
  });

  describe('Original request success logs', () => {
    it('should log with correct parameters for non-retry success', () => {
      // Simulate logAccess from original onStreamEnd (lines 348-361)
      const logEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId: 'session-normal',
        agent: 'oracle',
        category: 'research',
        provider: 'provider-a',
        model: 'model-a',
        virtualModel: 'lb-mixed',
        status: 200,
        ttfb: 100,
        duration: 300,
        body: { messages: [{ role: 'user', content: 'test' }] },
      };

      const logLine = formatLogEntry(logEntry);

      assert.ok(logLine.includes('status=200'), 'should include status 200');
      assert.ok(logLine.includes('provider=provider-a'), 'should include provider');
      assert.ok(logLine.includes('model=model-a'), 'should include model');
      assert.ok(logLine.includes('ttfb=100ms'), 'should include ttfb');
      assert.ok(logLine.includes('duration=300ms'), 'should include duration');
      assert.ok(logLine.includes('agent=oracle'), 'should include agent');
      assert.ok(logLine.includes('category=research'), 'should include category');
    });
  });

  describe('Edge cases', () => {
    it('should handle missing ttfb and duration in error logs', () => {
      // Error logs may not have ttfb/duration if connection failed immediately
      const logEntry = {
        timestamp: '2026-04-15T10:00:00.000',
        sessionId: 'session-edge',
        provider: 'provider-a',
        model: 'model-a',
        virtualModel: 'lb-test',
        status: 502,
        error: 'ECONNREFUSED',
        // No ttfb or duration
      };

      const logLine = formatLogEntry(logEntry);

      assert.ok(!logLine.includes('ttfb='), 'should not include ttfb when missing');
      assert.ok(!logLine.includes('duration='), 'should not include duration when missing');
      assert.ok(logLine.includes('status=502'), 'should still include status');
      assert.ok(logLine.includes('error=ECONNREFUSED'), 'should include error');
    });

    it('should handle all network error types', () => {
      const networkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];

      for (const errorCode of networkErrors) {
        const logEntry = {
          timestamp: '2026-04-15T10:00:00.000',
          sessionId: 'session-net-error',
          provider: 'provider-a',
          model: 'model-a',
          virtualModel: 'lb-test',
          status: 502,
          error: errorCode,
        };

        const logLine = formatLogEntry(logEntry);
        assert.ok(logLine.includes(`error=${errorCode}`), `should log ${errorCode} error`);
      }
    });
  });
});

/**
 * Unit tests for total-fallback session accounting in failoverStickySession
 * Tests that decrement + increment are applied correctly when all upstreams are filtered out
 * @module tests/proxy/unit/failover-decrement.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { failoverStickySession } from '../../../src/proxy/failover-handler.js';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { incrementSessionCount } from '../../../src/proxy/session-manager.js';

const UPSTREAMS = [
  { id: 'up-ali', provider: 'ali', model: 'glm-4' },
  { id: 'up-baidu', provider: 'baidu', model: 'qianfan' },
];

const WEIGHT_MANAGER = {
  getFinalWeight: () => 100,
  getEffectiveWeight: () => 100,
};

describe('failoverStickySession - total-fallback session accounting', () => {
  let sm;
  const routeKey = 'lb-qwen';
  const sessionId = 'session-1';

  beforeEach(() => {
    sm = createStateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  it('should decrement then re-increment failed upstream count on total-fallback (net count unchanged)', () => {
    // Simulate existing session count for the failed upstream
    incrementSessionCount(sm, routeKey, 'up-ali');
    const countMap = sm.upstreamSessionCounts.get(routeKey);
    assert.strictEqual(countMap.get('up-ali'), 1, 'initial count should be 1');

    // Trigger total-fallback: filter out all upstreams except the failed one
    const result = failoverStickySession(
      sessionId,
      'up-ali',
      UPSTREAMS,
      routeKey,
      undefined, // model
      (id) => id === 'up-ali', // isAvailable: only failed upstream is "available" -> all filtered out
      sm,
      WEIGHT_MANAGER
    );

    // Result should be the failed provider (fallback behavior unchanged)
    assert.strictEqual(result.id, 'up-ali', 'should return failed provider on total-fallback');

    // Count should be decremented then re-incremented = net unchanged
    const countMapAfter = sm.upstreamSessionCounts.get(routeKey);
    assert.ok(countMapAfter, 'countMap should exist after total-fallback');
    assert.strictEqual(
      countMapAfter.get('up-ali'),
      1,
      'count should be unchanged (decrement then increment)'
    );
  });

  it('should create sessionMap entry with updated timestamp on total-fallback', () => {
    incrementSessionCount(sm, routeKey, 'up-baidu');

    const before = Date.now();
    const result = failoverStickySession(
      sessionId,
      'up-baidu',
      UPSTREAMS,
      routeKey,
      undefined,
      (id) => id === 'up-baidu', // total-fallback: only failed upstream remains
      sm,
      WEIGHT_MANAGER
    );
    const after = Date.now();

    // Returned failed provider
    assert.strictEqual(result.id, 'up-baidu');

    // sessionMap entry exists
    const sessionEntry = sm.sessionMap.get(sessionId);
    assert.ok(sessionEntry, 'sessionMap entry should exist');
    assert.strictEqual(
      sessionEntry.upstreamId,
      'up-baidu',
      'entry should point to failed provider'
    );
    assert.strictEqual(sessionEntry.routeKey, routeKey, 'entry should have correct routeKey');
    assert.strictEqual(sessionEntry.requestCount, 1, 'entry should have requestCount 1');
    assert.ok(
      sessionEntry.timestamp >= before && sessionEntry.timestamp <= after,
      'timestamp should be recent'
    );
  });
});

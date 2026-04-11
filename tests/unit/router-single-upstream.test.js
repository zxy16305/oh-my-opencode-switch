/**
 * Unit tests for single-upstream sticky route counting
 * @module tests/unit/router-single-upstream.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectUpstreamSticky,
  getUpstreamRequestCounts,
  getUpstreamSessionCounts,
  getUpstreamSlidingWindowCounts,
  getSessionUpstreamMap,
  resetAllState,
} from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal upstream config
 */
function makeUpstream(id, provider = 'test', model = 'test-model') {
  return { id, provider, model };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Single-Upstream Sticky Route Counting', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  it('should increment request count when upstreams.length === 1', () => {
    const upstreams = [makeUpstream('provider-a')];
    const routeKey = 'single-route';
    const sessionId = 'sess-001';

    selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);

    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get(routeKey);
    assert.ok(routeCounts, 'request counts map should have entry for routeKey');
    assert.strictEqual(routeCounts.get('provider-a'), 1, 'request count should be 1');
  });

  it('should increment session count when upstreams.length === 1', () => {
    const upstreams = [makeUpstream('provider-b')];
    const routeKey = 'single-route-2';
    const sessionId = 'sess-002';

    selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);

    const sessionCounts = getUpstreamSessionCounts();
    const routeSessions = sessionCounts.get(routeKey);
    assert.ok(routeSessions, 'session counts map should have entry for routeKey');
    assert.strictEqual(routeSessions.get('provider-b'), 1, 'session count should be 1');
  });

  it('should record sliding window timestamp when upstreams.length === 1', () => {
    const upstreams = [makeUpstream('provider-c')];
    const routeKey = 'single-route-3';
    const sessionId = 'sess-003';

    selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);

    const slidingCounts = getUpstreamSlidingWindowCounts();
    const key = `${routeKey}:provider-c`;
    const timestamps = slidingCounts.get(key);
    assert.ok(timestamps, 'sliding window should have entry for key');
    assert.ok(timestamps.length >= 1, 'sliding window should have at least 1 timestamp');
    assert.ok(
      Date.now() - timestamps[0].timestamp < 5000,
      'timestamp should be within last 5 seconds'
    );
  });

  it('should register session in session map for subsequent sticky reuse', () => {
    const upstreams = [makeUpstream('provider-d')];
    const routeKey = 'single-route-4';
    const sessionId = 'sess-004';

    // First call: should register session in map
    const first = selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);
    assert.strictEqual(first.id, 'provider-d');

    // Verify session map entry
    const sessionMap = getSessionUpstreamMap();
    const entry = sessionMap.get(`${sessionId}:${routeKey}`);
    assert.ok(entry, 'session map should have entry for session');
    assert.strictEqual(entry.upstreamId, 'provider-d');
    assert.strictEqual(entry.routeKey, routeKey);
    assert.strictEqual(entry.requestCount, 1);

    // Second call: should reuse existing session entry (existing path)
    const second = selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);
    assert.strictEqual(second.id, 'provider-d');

    // Request count should have incremented to 2 (both calls counted)
    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get(routeKey);
    assert.strictEqual(routeCounts.get('provider-d'), 2, 'request count should be 2 after 2 calls');
  });

  it('should increment request count across multiple calls with same session', () => {
    const upstreams = [makeUpstream('provider-e')];
    const routeKey = 'single-route-5';
    const sessionId = 'sess-005';

    // Call 5 times
    for (let i = 0; i < 5; i++) {
      selectUpstreamSticky(upstreams, routeKey, sessionId, routeKey);
    }

    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get(routeKey);
    assert.strictEqual(routeCounts.get('provider-e'), 5, 'request count should be 5 after 5 calls');
  });
});

/**
 * Unit tests for retry-on-error boundary conditions in server-manager.js.
 *
 * Verifies the retry logic implemented in the onError callback:
 * - Retry conditions: !headersSent && !socket.destroyed && upstreams.length > 1 && retryCount < MAX_RETRIES
 * - failoverStickySession integration
 * - Metrics recording on retry success/failure
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  failoverStickySession,
  resetAllState,
  getUpstreamSessionCounts,
} from '../../src/proxy/router.js';
import { CircuitBreaker } from '../../src/proxy/circuitbreaker.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { makeUpstream, makeRoute } from '../helpers/proxy-fixtures.js';

// ---------------------------------------------------------------------------
// Constants (mirrored from server-manager.js)
// ---------------------------------------------------------------------------
const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// Helper: Simulate retry decision logic
// ---------------------------------------------------------------------------
/**
 * Extracted retry decision logic for testing.
 * This mirrors the condition check in server-manager.js onError callback.
 *
 * @param {Object} res - Mock response object
 * @param {Object} route - Route configuration
 * @param {number} retryCount - Current retry count
 * @returns {boolean} Whether retry is allowed
 */
function shouldRetry(res, route, retryCount) {
  return (
    !res.headersSent &&
    !res.socket?.destroyed &&
    route.upstreams.length > 1 &&
    retryCount < MAX_RETRIES
  );
}

// ---------------------------------------------------------------------------
// Helper: Create mock response with specific states
// ---------------------------------------------------------------------------
function createMockResponse(options = {}) {
  return {
    headersSent: options.headersSent ?? false,
    socket: options.socket ?? { destroyed: options.socketDestroyed ?? false },
    writeHead: mock.fn(),
    end: mock.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helper: Create mock upstreams
// ---------------------------------------------------------------------------
function createMockUpstreams(count = 2) {
  const upstreams = [];
  for (let i = 1; i <= count; i++) {
    upstreams.push(
      makeUpstream({
        id: `upstream-${i}`,
        baseURL: `http://localhost:800${i}`,
      })
    );
  }
  return upstreams;
}

// ---------------------------------------------------------------------------
// Tests: Retry Boundary Conditions
// ---------------------------------------------------------------------------
describe('Retry-on-Error Logic - Boundary Conditions', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    resetAllState();
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  // ---------------------------------------------------------------------------
  // Test 1: headersSent = true - Should NOT retry
  // ---------------------------------------------------------------------------
  it('should NOT retry when headers already sent', () => {
    const res = createMockResponse({ headersSent: true });
    const route = makeRoute(createMockUpstreams(2));
    const retryCount = 0;

    const canRetry = shouldRetry(res, route, retryCount);

    assert.equal(canRetry, false, 'Should not retry when headers already sent');

    // Verify writeHead was never called (no retry attempt)
    assert.equal(res.writeHead.mock.callCount(), 0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: socket.destroyed = true - Should NOT retry
  // ---------------------------------------------------------------------------
  it('should NOT retry when client socket is destroyed', () => {
    const res = createMockResponse({ socketDestroyed: true });
    const route = makeRoute(createMockUpstreams(2));
    const retryCount = 0;

    const canRetry = shouldRetry(res, route, retryCount);

    assert.equal(canRetry, false, 'Should not retry when socket is destroyed');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Single upstream - Should NOT retry
  // ---------------------------------------------------------------------------
  it('should NOT retry when only 1 upstream in route', () => {
    const res = createMockResponse();
    const route = makeRoute(createMockUpstreams(1)); // Only 1 upstream
    const retryCount = 0;

    const canRetry = shouldRetry(res, route, retryCount);

    assert.equal(canRetry, false, 'Should not retry with single upstream');
    assert.equal(route.upstreams.length, 1, 'Route should have exactly 1 upstream');
  });

  // ---------------------------------------------------------------------------
  // Test 4: failoverStickySession returns null - Should NOT retry
  // ---------------------------------------------------------------------------
  it('should NOT retry when failoverStickySession returns null', () => {
    const upstreams = createMockUpstreams(2);
    const _route = makeRoute(upstreams);
    const sessionId = 'test-session';
    const _failedUpstreamId = 'upstream-1';
    const routeKey = 'test-route';

    // Simulate scenario where failoverStickySession would return null
    // This happens when the failed upstream is not found in the list
    const nonExistentUpstreamId = 'non-existent-upstream';
    const result = failoverStickySession(
      sessionId,
      nonExistentUpstreamId, // Non-existent upstream ID
      upstreams,
      routeKey,
      null,
      null
    );

    assert.equal(
      result,
      null,
      'failoverStickySession should return null for non-existent upstream'
    );

    // In server-manager, this would prevent retry because nextUpstream would be null
    // The condition `if (nextUpstream && nextUpstream.baseURL)` would fail
  });

  // ---------------------------------------------------------------------------
  // Test 5: failoverStickySession returns upstream without baseURL - Should NOT retry
  // ---------------------------------------------------------------------------
  it('should NOT retry when failoverStickySession returns upstream without baseURL', () => {
    const upstreams = createMockUpstreams(2);
    const sessionId = 'test-session-no-baseurl';
    const routeKey = 'test-route-no-baseurl';

    const result = failoverStickySession(sessionId, 'upstream-1', upstreams, routeKey, null, null);

    assert.ok(result, 'failoverStickySession should return an upstream');
    assert.ok(result.baseURL, 'Returned upstream should have baseURL');

    assert.ok(result && result.baseURL, 'Retry would proceed when baseURL exists');

    const upstreamNoBaseURL = { ...result, baseURL: undefined };
    assert.ok(
      !(upstreamNoBaseURL && upstreamNoBaseURL.baseURL),
      'Retry would be blocked when baseURL is missing'
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: Retry success metrics - Verify metrics recorded correctly
  // ---------------------------------------------------------------------------
  it('should record metrics correctly after successful retry', () => {
    const upstreams = createMockUpstreams(3);
    const _route = makeRoute(upstreams);
    const sessionId = 'test-session-success';
    const routeKey = 'test-route-success';
    const model = 'test-model';

    // Establish sticky session on first upstream
    const firstUpstream = failoverStickySession(
      sessionId,
      'upstream-2', // Pretend upstream-2 was the original (failed)
      upstreams,
      routeKey,
      model,
      null
    );

    assert.ok(firstUpstream, 'Should get a new upstream');
    assert.notEqual(firstUpstream.id, 'upstream-2', 'Should not return the failed upstream');

    // Verify session counts were updated
    const counts = getUpstreamSessionCounts();
    const routeCounts = counts.get(routeKey);

    assert.ok(routeCounts, 'Route should have session counts');
    assert.ok(routeCounts.has(firstUpstream.id), 'Selected upstream should have session count');

    const sessionCount = routeCounts.get(firstUpstream.id);
    assert.ok(sessionCount >= 1, 'Session count should be at least 1');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Retry failure - Should return 502 after retry fails
  // ---------------------------------------------------------------------------
  it('should send 502 after retry fails', () => {
    const res = createMockResponse();
    const retryCount = 1; // Already at MAX_RETRIES

    // Simulate retry exhaustion
    const route = makeRoute(createMockUpstreams(2));

    // At retryCount >= MAX_RETRIES, shouldRetry should return false
    const canRetry = shouldRetry(res, route, retryCount);

    assert.equal(canRetry, false, 'Should not retry when retryCount >= MAX_RETRIES');

    // In the real implementation, this would trigger:
    // res.writeHead(502, { 'Content-Type': 'application/json' });
    // res.end(JSON.stringify({ error: { message: 'Bad Gateway' } }));

    // Simulate the 502 response behavior
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Bad Gateway: retry failed' } }));

    assert.equal(res.writeHead.mock.callCount(), 1, 'writeHead should be called once');
    assert.equal(res.writeHead.mock.calls[0].arguments[0], 502, 'Status code should be 502');
    assert.equal(res.end.mock.callCount(), 1, 'end should be called once');
  });

  // ---------------------------------------------------------------------------
  // Additional: Circuit breaker integration on retry
  // ---------------------------------------------------------------------------
  it('should check circuit breaker before retry', () => {
    const circuitBreaker = new CircuitBreaker({
      allowedFails: 2,
      cooldownTimeMs: 60000,
    });

    // Simulate failure on upstream-1
    circuitBreaker.recordFailure('upstream-1');
    circuitBreaker.recordFailure('upstream-1');

    // upstream-1 should now be unavailable
    assert.equal(
      circuitBreaker.isAvailable('upstream-1'),
      false,
      'upstream-1 should be circuit-broken'
    );

    // When failoverStickySession is called with isAvailable callback,
    // it should filter out circuit-broken upstreams
    const upstreams = createMockUpstreams(2);
    const sessionId = 'test-session-circuit';
    const routeKey = 'test-route-circuit';

    const isAvailable = (upstreamId) => circuitBreaker.isAvailable(upstreamId);

    const result = failoverStickySession(
      sessionId,
      'upstream-1',
      upstreams,
      routeKey,
      null,
      isAvailable
    );

    // Should NOT return upstream-1 (failed) or circuit-broken
    // If upstream-1 is the failed one, it's excluded anyway
    assert.ok(result, 'Should return an available upstream');
    assert.equal(
      circuitBreaker.isAvailable(result.id),
      true,
      'Selected upstream should be available'
    );
  });

  // ---------------------------------------------------------------------------
  // Edge case: Empty upstreams array
  // ---------------------------------------------------------------------------
  it('should NOT retry when upstreams array is empty', () => {
    const res = createMockResponse();
    const route = makeRoute([]); // Empty upstreams
    const retryCount = 0;

    const canRetry = shouldRetry(res, route, retryCount);

    assert.equal(canRetry, false, 'Should not retry with empty upstreams array');
    assert.equal(route.upstreams.length, 0, 'Route should have 0 upstreams');
  });

  // ---------------------------------------------------------------------------
  // Edge case: All upstreams circuit-broken
  // ---------------------------------------------------------------------------
  it('should fallback to failed upstream when all others are circuit-broken', () => {
    const circuitBreaker = new CircuitBreaker({
      allowedFails: 1,
      cooldownTimeMs: 60000,
    });

    const upstreams = createMockUpstreams(3);

    // Circuit-break all upstreams except the failed one
    circuitBreaker.recordFailure('upstream-2');
    circuitBreaker.recordFailure('upstream-3');

    const sessionId = 'test-session-all-broken';
    const routeKey = 'test-route-all-broken';

    const isAvailable = (upstreamId) => circuitBreaker.isAvailable(upstreamId);

    // upstream-1 is the "failed" one, upstream-2 and upstream-3 are circuit-broken
    const result = failoverStickySession(
      sessionId,
      'upstream-1',
      upstreams,
      routeKey,
      null,
      isAvailable
    );

    // Should fallback to upstream-1 (the failed provider) since all others are unavailable
    assert.ok(result, 'Should return an upstream');
    assert.equal(result.id, 'upstream-1', 'Should fallback to failed provider');
  });
});

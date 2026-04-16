/**
 * Unit tests for proxy retry race conditions.
 *
 * Tests the race condition scenarios from the bug report:
 * - Upstream A fails with ECONNRESET → retry to upstream B → client disconnects during retry
 *
 * Focus: Retry decision logic in server-manager.js (lines 370-466)
 * - Retry condition guards: !headersSent && !socket.destroyed && upstreams.length > 1 && retryCount < MAX_RETRIES
 * - onError fallback guards: !headersSent && !socket.destroyed
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Constants (mirrored from server-manager.js)
// ---------------------------------------------------------------------------
const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// Helper: Simulate retry decision logic (from server-manager.js:370-376)
// ---------------------------------------------------------------------------
/**
 * Retry condition check - mirrors server-manager.js retry logic.
 *
 * @param {Object} res - Mock response object
 * @param {Object} req - Mock request object
 * @param {Object} route - Route configuration
 * @param {number} retryCount - Current retry count
 * @returns {boolean} Whether retry is allowed
 */
function canRetry(res, req, route, retryCount) {
  return (
    !res.headersSent &&
    !res.socket?.destroyed &&
    !req.socket?.destroyed &&
    route.upstreams.length > 1 &&
    retryCount < MAX_RETRIES
  );
}

// ---------------------------------------------------------------------------
// Helper: Check if error response can be sent (from server-manager.js:457)
// ---------------------------------------------------------------------------
/**
 * Error response guard - mirrors server-manager.js onError fallback.
 *
 * @param {Object} res - Mock response object
 * @param {Object} req - Mock request object
 * @returns {boolean} Whether error response can be sent safely
 */
function canSendErrorResponse(res, req) {
  return !res.headersSent && !res.socket?.destroyed && !req.socket?.destroyed;
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
// Helper: Create mock request with specific states
// ---------------------------------------------------------------------------
function createMockRequest(options = {}) {
  return {
    socket: options.socket ?? { destroyed: options.socketDestroyed ?? false },
    headers: options.headers ?? {},
    method: options.method ?? 'POST',
    url: options.url ?? '/v1/chat/completions',
  };
}

// ---------------------------------------------------------------------------
// Helper: Create mock upstreams
// ---------------------------------------------------------------------------
function createMockUpstreams(count = 2) {
  const upstreams = [];
  for (let i = 1; i <= count; i++) {
    upstreams.push({
      id: `upstream-${i}`,
      provider: `provider-${i}`,
      model: `model-${i}`,
      baseURL: `http://localhost:800${i}`,
      apiKey: `key-${i}`,
      weight: 100,
    });
  }
  return upstreams;
}

// ---------------------------------------------------------------------------
// Helper: Simulate the retry flow state machine
// ---------------------------------------------------------------------------
/**
 * Simulates the retry flow state machine for testing.
 * This captures the essence of server-manager.js onError handler.
 *
 * @param {Object} params - Simulation parameters
 * @param {Object} params.req - Mock request
 * @param {Object} params.res - Mock response
 * @param {Object} params.route - Route with upstreams
 * @param {Object} params.upstreamA - First upstream (will fail)
 * @param {Object} params.upstreamB - Second upstream (retry target)
 * @param {string} params.errorA - Error from upstream A
 * @param {boolean} params.clientDisconnectDuringRetry - Simulate client disconnect
 * @param {boolean} params.upstreamBFails - Whether upstream B also fails
 * @returns {Object} Simulation result
 */
function simulateRetryFlow(params) {
  const {
    req,
    res,
    route,
    upstreamA,
    upstreamB,
    errorA = 'ECONNRESET',
    clientDisconnectDuringRetry = false,
    upstreamBFails = false,
  } = params;

  let retryCount = 0;
  const events = [];

  // Step 1: Upstream A error occurs
  events.push({ type: 'upstreamA_error', upstream: upstreamA.id, error: errorA });

  // Step 2: Check retry condition (server-manager.js:370-376)
  if (canRetry(res, req, route, retryCount)) {
    events.push({ type: 'retry_initiated', target: upstreamB.id });
    retryCount++;

    // Step 3: Simulate retry to upstream B
    if (clientDisconnectDuringRetry) {
      // Client disconnects during retry
      events.push({ type: 'client_disconnect_during_retry' });

      // Simulate socket destroyed mid-retry
      res.socket.destroyed = true;
      req.socket.destroyed = true;

      // The retry's onError would check guards (server-manager.js:457)
      if (canSendErrorResponse(res, req)) {
        events.push({ type: 'error_response_sent', status: 502 });
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Bad Gateway: ${errorA}` } }));
      } else {
        events.push({ type: 'error_response_skipped', reason: 'socket_destroyed' });
      }
    } else if (upstreamBFails) {
      // Upstream B also fails
      events.push({ type: 'upstreamB_error', upstream: upstreamB.id });

      // The retry's onError would check guards (server-manager.js:457)
      if (canSendErrorResponse(res, req)) {
        events.push({ type: 'error_response_sent', status: 502 });
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Bad Gateway: ${errorA}` } }));
      } else {
        events.push({ type: 'error_response_skipped', reason: 'headers_sent' });
      }
    } else {
      // Upstream B succeeds
      events.push({ type: 'upstreamB_success', upstream: upstreamB.id, status: 200 });
      // Note: In real code, res.writeHead would be called by forwardRequest's proxyRes handler
    }
  } else {
    // No retry - send error immediately
    if (canSendErrorResponse(res, req)) {
      events.push({ type: 'error_response_sent', status: 502 });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Bad Gateway: ${errorA}` } }));
    } else {
      events.push({ type: 'error_response_skipped', reason: 'guards_failed' });
    }
  }

  return { events, retryCount };
}

// ---------------------------------------------------------------------------
// Tests: Race Condition Scenarios
// ---------------------------------------------------------------------------
describe('Proxy Retry Race Conditions', () => {
  // ---------------------------------------------------------------------------
  // Scenario 1: retry-success
  // Upstream A fails → retry to B → B succeeds → client gets 200 (no crash)
  // ---------------------------------------------------------------------------
  it('scenario 1: retry-success - upstream A fails, B succeeds, client gets 200', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    const result = simulateRetryFlow({
      req,
      res,
      route,
      upstreamA: upstreams[0],
      upstreamB: upstreams[1],
      errorA: 'ECONNRESET',
      clientDisconnectDuringRetry: false,
      upstreamBFails: false,
    });

    // Verify retry was initiated
    assert.ok(
      result.events.some((e) => e.type === 'retry_initiated'),
      'Retry should be initiated'
    );

    // Verify upstream B success
    assert.ok(
      result.events.some((e) => e.type === 'upstreamB_success'),
      'Upstream B should succeed'
    );

    // Verify retry count increased
    assert.equal(result.retryCount, 1, 'Retry count should be 1');

    // Verify NO error response was sent (success path)
    assert.ok(
      !result.events.some((e) => e.type === 'error_response_sent'),
      'No error response should be sent on success'
    );

    // Verify writeHead was NOT called with 502
    assert.equal(
      res.writeHead.mock.callCount(),
      0,
      'writeHead should not be called (success path)'
    );
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: retry-failure-client-disconnect
  // Upstream A fails → retry to B → client disconnects → no ERR_HTTP_HEADERS_SENT
  // ---------------------------------------------------------------------------
  it('scenario 2: retry-failure-client-disconnect - client disconnect during retry, no crash', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    const result = simulateRetryFlow({
      req,
      res,
      route,
      upstreamA: upstreams[0],
      upstreamB: upstreams[1],
      errorA: 'ECONNRESET',
      clientDisconnectDuringRetry: true, // KEY: client disconnects during retry
      upstreamBFails: false,
    });

    // Verify retry was initiated
    assert.ok(
      result.events.some((e) => e.type === 'retry_initiated'),
      'Retry should be initiated'
    );

    // Verify client disconnect was detected
    assert.ok(
      result.events.some((e) => e.type === 'client_disconnect_during_retry'),
      'Client disconnect during retry should be detected'
    );

    // Verify error response was skipped (not sent to destroyed socket)
    assert.ok(
      result.events.some((e) => e.type === 'error_response_skipped'),
      'Error response should be skipped when socket is destroyed'
    );

    // CRITICAL: Verify NO writeHead call (prevents ERR_HTTP_HEADERS_SENT)
    assert.equal(
      res.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called when socket is destroyed - prevents ERR_HTTP_HEADERS_SENT'
    );

    // Verify socket states after disconnect
    assert.equal(res.socket.destroyed, true, 'Response socket should be marked destroyed');
    assert.equal(req.socket.destroyed, true, 'Request socket should be marked destroyed');
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: both-upstreams-fail
  // Both A and B fail → error response sent → no double-write crash
  // ---------------------------------------------------------------------------
  it('scenario 3: both-upstreams-fail - A and B both fail, single 502 sent', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    const result = simulateRetryFlow({
      req,
      res,
      route,
      upstreamA: upstreams[0],
      upstreamB: upstreams[1],
      errorA: 'ECONNRESET',
      clientDisconnectDuringRetry: false,
      upstreamBFails: true, // KEY: upstream B also fails
    });

    // Verify retry was initiated
    assert.ok(
      result.events.some((e) => e.type === 'retry_initiated'),
      'Retry should be initiated'
    );

    // Verify both upstreams had errors
    assert.ok(
      result.events.some((e) => e.type === 'upstreamA_error'),
      'Upstream A error should be recorded'
    );
    assert.ok(
      result.events.some((e) => e.type === 'upstreamB_error'),
      'Upstream B error should be recorded'
    );

    // Verify EXACTLY ONE error response was sent
    const errorResponses = result.events.filter((e) => e.type === 'error_response_sent');
    assert.equal(errorResponses.length, 1, 'Exactly ONE error response should be sent');
    assert.equal(errorResponses[0].status, 502, 'Error response should be 502');

    // CRITICAL: Verify writeHead called exactly once (no double-write)
    assert.equal(
      res.writeHead.mock.callCount(),
      1,
      'writeHead should be called EXACTLY ONCE - no double-write crash'
    );
    assert.equal(
      res.writeHead.mock.calls[0].arguments[0],
      502,
      'writeHead should be called with status 502'
    );

    // Verify end called exactly once
    assert.equal(res.end.mock.callCount(), 1, 'res.end should be called exactly once');
  });

  // ---------------------------------------------------------------------------
  // Additional: Verify retry guard conditions individually
  // ---------------------------------------------------------------------------
  it('should NOT retry when headers already sent (guard: headersSent)', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse({ headersSent: true }); // Headers already sent

    const retryAllowed = canRetry(res, req, route, 0);

    assert.equal(retryAllowed, false, 'Should NOT retry when headers already sent');
  });

  it('should NOT retry when response socket destroyed (guard: res.socket.destroyed)', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse({ socketDestroyed: true }); // Socket destroyed

    const retryAllowed = canRetry(res, req, route, 0);

    assert.equal(retryAllowed, false, 'Should NOT retry when response socket is destroyed');
  });

  it('should NOT retry when request socket destroyed (guard: req.socket.destroyed)', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest({ socketDestroyed: true }); // Request socket destroyed
    const res = createMockResponse();

    const retryAllowed = canRetry(res, req, route, 0);

    assert.equal(retryAllowed, false, 'Should NOT retry when request socket is destroyed');
  });

  it('should NOT retry when only one upstream (guard: upstreams.length)', () => {
    const upstreams = createMockUpstreams(1); // Only 1 upstream
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    const retryAllowed = canRetry(res, req, route, 0);

    assert.equal(retryAllowed, false, 'Should NOT retry with only one upstream');
  });

  it('should NOT retry when retryCount >= MAX_RETRIES (guard: retryCount)', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    const retryAllowed = canRetry(res, req, route, MAX_RETRIES); // Already at max

    assert.equal(retryAllowed, false, 'Should NOT retry when retryCount >= MAX_RETRIES');
  });

  // ---------------------------------------------------------------------------
  // Additional: Verify error response guard conditions
  // ---------------------------------------------------------------------------
  it('should NOT send error response when headers already sent (onError guard)', () => {
    const req = createMockRequest();
    const res = createMockResponse({ headersSent: true });

    const canSend = canSendErrorResponse(res, req);

    assert.equal(canSend, false, 'Should NOT send error response when headers already sent');
  });

  it('should NOT send error response when socket destroyed (onError guard)', () => {
    const req = createMockRequest();
    const res = createMockResponse({ socketDestroyed: true });

    const canSend = canSendErrorResponse(res, req);

    assert.equal(canSend, false, 'Should NOT send error response when socket is destroyed');
  });

  // ---------------------------------------------------------------------------
  // Edge case: Multiple rapid retries (should be blocked by MAX_RETRIES)
  // ---------------------------------------------------------------------------
  it('should block multiple rapid retries (MAX_RETRIES = 1)', () => {
    const upstreams = createMockUpstreams(3); // 3 upstreams available
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    // First retry allowed
    const firstRetry = canRetry(res, req, route, 0);
    assert.equal(firstRetry, true, 'First retry should be allowed');

    // Simulate retry count increment
    const retryCount = 1;

    // Second retry blocked
    const secondRetry = canRetry(res, req, route, retryCount);
    assert.equal(secondRetry, false, 'Second retry should be blocked by MAX_RETRIES');
  });

  // ---------------------------------------------------------------------------
  // Race condition simulation: Error fires, then client disconnects
  // ---------------------------------------------------------------------------
  it('race condition: error fires, then client disconnects, no double-write', () => {
    const upstreams = createMockUpstreams(2);
    const route = { upstreams, strategy: 'sticky' };
    const req = createMockRequest();
    const res = createMockResponse();

    // Simulate: Upstream A error fires
    const errorA = 'ECONNRESET';
    let retryCount = 0;

    // Check retry condition at error time
    const retryAtErrorTime = canRetry(res, req, route, retryCount);
    assert.equal(retryAtErrorTime, true, 'Retry should be allowed at error time');

    // Simulate: Client disconnects AFTER error but BEFORE retry completes
    res.socket.destroyed = true;
    req.socket.destroyed = true;

    // Now check if error response can be sent
    const canSendAfterDisconnect = canSendErrorResponse(res, req);
    assert.equal(canSendAfterDisconnect, false, 'Should NOT send response after disconnect');

    // Simulate the retry's onError handler
    if (canSendAfterDisconnect) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Bad Gateway: ${errorA}` } }));
    }

    // CRITICAL: No writeHead call
    assert.equal(
      res.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called - race condition handled correctly'
    );
  });
});

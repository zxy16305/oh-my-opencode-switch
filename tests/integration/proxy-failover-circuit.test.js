/**
 * Integration tests for proxy failover with circuit breaker.
 *
 * Verifies:
 * - Session starts on baidu (sticky assignment)
 * - Circuit breaker opens after consecutive failures on baidu
 * - failoverStickySession skips circuit-broken upstream
 * - Next request for same session routes to fangzhou (not ali)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeRequest,
  resetAllState,
  failoverStickySession,
  getSessionUpstreamMap,
} from '../../src/proxy/router.js';
import { CircuitBreaker, CircuitState } from '../../src/proxy/circuitbreaker.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const ROUTE_KEY = 'test-route';

const createTestUpstreams = (ports) => [
  {
    id: 'ali',
    provider: 'ali',
    model: 'model-ali',
    baseURL: `http://127.0.0.1:${ports[0]}`,
    apiKey: 'test-key',
  },
  {
    id: 'baidu',
    provider: 'baidu',
    model: 'model-baidu',
    baseURL: `http://127.0.0.1:${ports[1]}`,
    apiKey: 'test-key',
  },
  {
    id: 'fangzhou',
    provider: 'fangzhou',
    model: 'model-fangzhou',
    baseURL: `http://127.0.0.1:${ports[2]}`,
    apiKey: 'test-key',
  },
];

const createTestRoutes = (upstreams) => ({
  [ROUTE_KEY]: {
    strategy: 'sticky',
    upstreams,
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Failover with Circuit Breaker', () => {
  beforeEach(() => {
    resetAllState();
  });

  it('should fail over to circuit-available provider when baidu fails', () => {
    const upstreams = createTestUpstreams([4001, 4002, 4003]);
    const routes = createTestRoutes(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'session-failover-1';

    // Step 1: Send first request for session X → sticky assigns upstream
    routeRequest(ROUTE_KEY, routes, {
      headers: { 'x-opencode-session': sessionId },
    });

    // Force session mapping to baidu for deterministic test setup
    const sessionKey = `${sessionId}:${ROUTE_KEY}`;
    getSessionUpstreamMap().set(sessionKey, {
      upstreamId: 'baidu',
      routeKey: ROUTE_KEY,
      timestamp: Date.now(),
      requestCount: 1,
    });

    // ------------------------------------------------------------------
    // Step 2: Simulate baidu failures → circuit breaker opens
    // ------------------------------------------------------------------
    // Record 3 consecutive failures (allowedFails=3) to trip the circuit
    circuitBreaker.recordFailure('baidu');
    assert.equal(
      circuitBreaker.getState('baidu'),
      CircuitState.CLOSED,
      '1st failure: still CLOSED'
    );
    assert.equal(circuitBreaker.getFailureCount('baidu'), 1);

    circuitBreaker.recordFailure('baidu');
    assert.equal(
      circuitBreaker.getState('baidu'),
      CircuitState.CLOSED,
      '2nd failure: still CLOSED'
    );
    assert.equal(circuitBreaker.getFailureCount('baidu'), 2);

    circuitBreaker.recordFailure('baidu');
    assert.equal(circuitBreaker.getState('baidu'), CircuitState.OPEN, '3rd failure: now OPEN');
    assert.equal(circuitBreaker.isAvailable('baidu'), false, 'baidu should be unavailable');

    // ali and fangzhou should still be available
    assert.equal(circuitBreaker.isAvailable('ali'), true, 'ali should be available');
    assert.equal(circuitBreaker.isAvailable('fangzhou'), true, 'fangzhou should be available');

    // ------------------------------------------------------------------
    // Step 3: Failover — baidu circuit-opened, should pick another upstream
    // ------------------------------------------------------------------
    const isAvailable = (providerId) => circuitBreaker.isAvailable(providerId);

    const nextUpstream = failoverStickySession(
      sessionId,
      'baidu',
      upstreams,
      ROUTE_KEY,
      ROUTE_KEY,
      isAvailable
    );

    // ------------------------------------------------------------------
    // Verify: next upstream is NOT baidu, and IS one of the available ones
    // ------------------------------------------------------------------
    assert.ok(nextUpstream, 'failoverStickySession should return an upstream');
    assert.notEqual(nextUpstream.id, 'baidu', 'Should NOT route to circuit-broken baidu');
    assert.ok(
      nextUpstream.id === 'ali' || nextUpstream.id === 'fangzhou',
      `Expected ali or fangzhou, got: ${nextUpstream.id}`
    );

    const updatedEntry = getSessionUpstreamMap().get(sessionKey);
    assert.ok(updatedEntry, 'Session should be remapped');
    assert.notEqual(updatedEntry.upstreamId, 'baidu', 'Session should NOT map to baidu');
    assert.ok(
      updatedEntry.upstreamId === 'ali' || updatedEntry.upstreamId === 'fangzhou',
      `Session should map to ali or fangzhou, got: ${updatedEntry.upstreamId}`
    );

    // ------------------------------------------------------------------
    // Step 4: Next request for same session should go to the failover target
    // ------------------------------------------------------------------
    const secondResult = routeRequest(ROUTE_KEY, routes, {
      headers: { 'x-opencode-session': sessionId },
    });

    assert.equal(
      secondResult.upstream.id,
      nextUpstream.id,
      `Next request should go to ${nextUpstream.id}, not baidu`
    );
    assert.notEqual(
      secondResult.upstream.id,
      'baidu',
      'Next request must NOT go to circuit-broken baidu'
    );
  });

  it('should skip all circuit-broken upstreams during failover', () => {
    const upstreams = createTestUpstreams([4001, 4002, 4003]);
    const routes = createTestRoutes(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 60000 });
    const sessionId = 'session-failover-2';

    // Route first request
    routeRequest(ROUTE_KEY, routes, {
      headers: { 'x-opencode-session': sessionId },
    });

    // Open circuit for both ali and baidu (only fangzhou remains)
    circuitBreaker.recordFailure('ali');
    circuitBreaker.recordFailure('baidu');

    assert.equal(circuitBreaker.isAvailable('ali'), false);
    assert.equal(circuitBreaker.isAvailable('baidu'), false);
    assert.equal(circuitBreaker.isAvailable('fangzhou'), true);

    // Set session to baidu
    const sessionKey = `${sessionId}:${ROUTE_KEY}`;
    const sessionMap = getSessionUpstreamMap();
    sessionMap.set(sessionKey, {
      upstreamId: 'baidu',
      routeKey: ROUTE_KEY,
      timestamp: Date.now(),
      requestCount: 1,
    });

    // Failover should only pick fangzhou
    const isAvailable = (providerId) => circuitBreaker.isAvailable(providerId);
    const nextUpstream = failoverStickySession(
      sessionId,
      'baidu',
      upstreams,
      ROUTE_KEY,
      ROUTE_KEY,
      isAvailable
    );

    assert.ok(nextUpstream, 'Should return an upstream');
    assert.equal(nextUpstream.id, 'fangzhou', 'Should failover to fangzhou (only available)');

    // Verify subsequent request also goes to fangzhou
    const result = routeRequest(ROUTE_KEY, routes, {
      headers: { 'x-opencode-session': sessionId },
    });
    assert.equal(result.upstream.id, 'fangzhou', 'Subsequent request should stay on fangzhou');
  });
});

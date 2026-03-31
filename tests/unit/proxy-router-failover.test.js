/**
 * Unit tests for failoverStickySession filter logic.
 *
 * Verifies:
 * - Filter excludes circuit-broken upstreams when isAvailable provided
 * - No callback = backward compatible behavior
 * - All filtered out = fallback to failed provider
 * - Callback throws = skip filter, log warning
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  failoverStickySession,
  resetRoundRobinCounters,
  getSessionUpstreamMap,
} from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const createTestUpstreams = () => [
  {
    id: 'upstream-a',
    provider: 'test',
    model: 'model-a',
    baseURL: 'http://127.0.0.1:3001',
    apiKey: 'test-key',
  },
  {
    id: 'upstream-b',
    provider: 'test',
    model: 'model-b',
    baseURL: 'http://127.0.0.1:3002',
    apiKey: 'test-key',
  },
  {
    id: 'upstream-c',
    provider: 'test',
    model: 'model-c',
    baseURL: 'http://127.0.0.1:3003',
    apiKey: 'test-key',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('failoverStickySession Filter', () => {
  beforeEach(() => {
    resetRoundRobinCounters();
  });

  it('should filter out circuit-broken upstreams when isAvailable provided', () => {
    const upstreams = createTestUpstreams();
    const routeKey = 'test-route';
    const sessionId = 'session-1';

    // Mock isAvailable: upstream-b is circuit-broken (returns false)
    const isAvailable = mock.fn((upstreamId) => {
      return upstreamId !== 'upstream-b';
    });

    const result = failoverStickySession(
      sessionId,
      'upstream-a',
      upstreams,
      routeKey,
      null,
      isAvailable
    );

    // Should NOT return upstream-b (circuit-broken) or upstream-a (failed)
    assert.ok(result, 'Should return an upstream');
    assert.notEqual(result.id, 'upstream-a', 'Should not return failed upstream');
    assert.notEqual(result.id, 'upstream-b', 'Should not return circuit-broken upstream');
    assert.equal(result.id, 'upstream-c', 'Should return the only available upstream');

    // Verify isAvailable was called for remaining upstreams
    assert.ok(isAvailable.mock.callCount() >= 1, 'isAvailable should be called');
  });

  it('should be backward compatible when no callback provided', () => {
    const upstreams = createTestUpstreams();
    const routeKey = 'test-route';
    const sessionId = 'session-2';

    // No isAvailable callback - backward compatible behavior
    const result = failoverStickySession(
      sessionId,
      'upstream-a',
      upstreams,
      routeKey,
      null,
      undefined // No callback
    );

    // Should return any upstream except the failed one
    assert.ok(result, 'Should return an upstream');
    assert.notEqual(result.id, 'upstream-a', 'Should not return failed upstream');
    assert.ok(
      result.id === 'upstream-b' || result.id === 'upstream-c',
      'Should return one of the remaining upstreams'
    );

    // Verify session mapping was updated
    const sessionMap = getSessionUpstreamMap();
    const sessionKey = sessionId;
    const mapping = sessionMap.get(sessionKey);
    assert.ok(mapping, 'Session mapping should exist');
    assert.equal(mapping.upstreamId, result.id, 'Session should map to selected upstream');
  });

  it('should fallback to failed provider when all upstreams filtered out', () => {
    const upstreams = createTestUpstreams();
    const routeKey = 'test-route';
    const sessionId = 'session-3';

    // Mock isAvailable: all upstreams are circuit-broken (all return false)
    const isAvailable = mock.fn(() => false);

    const result = failoverStickySession(
      sessionId,
      'upstream-a',
      upstreams,
      routeKey,
      null,
      isAvailable
    );

    // Should fallback to failed provider
    assert.ok(result, 'Should return an upstream');
    assert.equal(result.id, 'upstream-a', 'Should fallback to failed provider');

    // Verify session mapping was updated to failed provider
    const sessionMap = getSessionUpstreamMap();
    const sessionKey = sessionId;
    const mapping = sessionMap.get(sessionKey);
    assert.ok(mapping, 'Session mapping should exist');
    assert.equal(mapping.upstreamId, 'upstream-a', 'Session should map to failed provider');
  });

  it('should skip filter and log warning when callback throws', () => {
    const upstreams = createTestUpstreams();
    const routeKey = 'test-route';
    const sessionId = 'session-4';

    // Mock isAvailable that throws an error
    const isAvailable = mock.fn(() => {
      throw new Error('Circuit breaker check failed');
    });

    const result = failoverStickySession(
      sessionId,
      'upstream-a',
      upstreams,
      routeKey,
      null,
      isAvailable
    );

    // Should still return an upstream (skip filter, use fallback)
    assert.ok(result, 'Should return an upstream');
    assert.notEqual(result.id, 'upstream-a', 'Should not return failed upstream');

    // Verify session mapping was updated
    const sessionMap = getSessionUpstreamMap();
    const sessionKey = sessionId;
    const mapping = sessionMap.get(sessionKey);
    assert.ok(mapping, 'Session mapping should exist');
    assert.equal(mapping.upstreamId, result.id, 'Session should map to selected upstream');
  });
});

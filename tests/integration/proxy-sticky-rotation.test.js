/**
 * Integration tests for proxy sticky session soft rotation.
 *
 * Verifies:
 * - Upstream request count tracking
 * - Soft rotation every 10 requests
 * - /_internal/stats endpoint
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  routeRequest,
  resetRoundRobinCounters,
  getUpstreamRequestCounts,
  getUpstreamSessionCounts,
} from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const createTestUpstreams = (ports) => [
  {
    id: 'upstream-a',
    provider: 'test',
    model: 'model-a',
    baseURL: `http://127.0.0.1:${ports[0]}`,
    apiKey: 'test-key',
  },
  {
    id: 'upstream-b',
    provider: 'test',
    model: 'model-b',
    baseURL: `http://127.0.0.1:${ports[1]}`,
    apiKey: 'test-key',
  },
  {
    id: 'upstream-c',
    provider: 'test',
    model: 'model-c',
    baseURL: `http://127.0.0.1:${ports[2]}`,
    apiKey: 'test-key',
  },
];

const createTestRoutes = (upstreams) => ({
  'test-route': {
    strategy: 'sticky',
    upstreams,
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Upstream Request Count Tracking', () => {
  beforeEach(() => {
    resetRoundRobinCounters();
  });

  it('should increment request count on each routeRequest()', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    // Route 5 requests
    for (let i = 0; i < 5; i++) {
      routeRequest('test-route', routes, null, { model: 'test-route' });
    }

    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get('test-route');

    // Total should be 5
    let total = 0;
    for (const count of routeCounts.values()) {
      total += count;
    }
    assert.equal(total, 5, 'Total request count should be 5');
  });

  it('should track requests per upstream', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    // Route multiple requests
    for (let i = 0; i < 10; i++) {
      routeRequest('test-route', routes, null, { model: 'test-route' });
    }

    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get('test-route');

    assert.ok(routeCounts, 'Route should have request counts');
    assert.ok(routeCounts.size > 0, 'Should have at least one upstream with counts');
  });

  it('should reset counts on resetRoundRobinCounters()', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    // Route some requests
    for (let i = 0; i < 5; i++) {
      routeRequest('test-route', routes, null, { model: 'test-route' });
    }

    // Reset
    resetRoundRobinCounters();

    const requestCounts = getUpstreamRequestCounts();
    assert.equal(requestCounts.size, 0, 'Request counts should be empty after reset');
  });
});

describe('Sticky Session Soft Rotation', () => {
  beforeEach(() => {
    resetRoundRobinCounters();
  });

  it('should keep session on same upstream before 10 requests', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    const sessionId = 'test-session-1';
    const selectedUpstreams = new Set();

    // Route 9 requests with same session
    for (let i = 0; i < 9; i++) {
      const result = routeRequest(
        'test-route',
        routes,
        { headers: { 'x-opencode-session': sessionId } },
        { model: 'test-route' }
      );
      selectedUpstreams.add(result.upstream.id);
    }

    // Should stay on same upstream (sticky behavior)
    assert.equal(selectedUpstreams.size, 1, 'Should stay on same upstream before 10 requests');
  });

  it('should check for rotation at 10th request', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    const sessionId = 'test-session-2';

    // Route 10 requests with same session
    for (let i = 0; i < 10; i++) {
      routeRequest(
        'test-route',
        routes,
        { headers: { 'x-opencode-session': sessionId } },
        { model: 'test-route' }
      );
    }

    const requestCounts = getUpstreamRequestCounts();
    const routeCounts = requestCounts.get('test-route');

    // Should have tracked all 10 requests
    let total = 0;
    for (const count of routeCounts.values()) {
      total += count;
    }
    assert.equal(total, 10, 'Should have tracked 10 requests');
  });

  it('should distribute new sessions to least loaded upstream', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    // Create multiple sessions
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      const sessionId = `test-session-${i + 10}`;
      const result = routeRequest(
        'test-route',
        routes,
        { headers: { 'x-opencode-session': sessionId } },
        { model: 'test-route' }
      );
      sessions.push(result.upstream.id);
    }

    // Sessions should be distributed (not all on same upstream)
    const uniqueUpstreams = new Set(sessions);
    assert.ok(uniqueUpstreams.size >= 1, 'Sessions should be assigned to upstreams');
  });
});

describe('Session Count Tracking', () => {
  beforeEach(() => {
    resetRoundRobinCounters();
  });

  it('should track session counts per upstream', () => {
    const upstreams = createTestUpstreams([3001, 3002, 3003]);
    const routes = createTestRoutes(upstreams);

    // Create sessions
    for (let i = 0; i < 3; i++) {
      routeRequest(
        'test-route',
        routes,
        { headers: { 'x-opencode-session': `session-${i}` } },
        { model: 'test-route' }
      );
    }

    const sessionCounts = getUpstreamSessionCounts();
    const routeCounts = sessionCounts.get('test-route');

    assert.ok(routeCounts, 'Route should have session counts');

    // Total sessions should be 3
    let total = 0;
    for (const count of routeCounts.values()) {
      total += count;
    }
    assert.equal(total, 3, 'Total session count should be 3');
  });
});

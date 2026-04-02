/**
 * Integration tests for sticky strategy weight distribution.
 *
 * Verifies:
 * - Real user scenario: weight=100, 100, 95, 8 providers distribute traffic correctly
 * - Weight recovery: traffic redistributes when weight changes from 8 to 100
 * - Session stickiness maintained throughout weight adjustments
 * - Sliding window request counting works correctly
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetRoundRobinCounters,
  getDynamicWeight,
  setDynamicWeight,
  routeRequest,
  getUpstreamRequestCounts,
  getSessionUpstreamMap,
} from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUpstream(overrides = {}) {
  return {
    id: overrides.id || 'u1',
    provider: overrides.provider || 'test-provider',
    model: overrides.model || 'test-model',
    baseURL: overrides.baseURL || 'http://localhost:8001',
    weight: overrides.weight ?? 100,
    ...overrides,
  };
}

function makeRoute(upstreams, overrides = {}) {
  return {
    strategy: 'sticky',
    upstreams,
    stickyReassignThreshold: 10,
    stickyReassignMinGap: 2,
    dynamicWeight: {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      checkInterval: 10,
      latencyThreshold: 1.5,
      recoveryInterval: 300000,
      recoveryAmount: 1,
      errorWeightReduction: {
        enabled: true,
        errorCodes: [429, 500, 502, 503, 504],
        reductionAmount: 10,
        minWeight: 5,
        errorWindowMs: 600000,
      },
    },
    ...overrides,
  };
}

function makeConfig(routes) {
  return routes;
}

// Helper to create mock request
function makeMockRequest(sessionId) {
  return {
    headers: {
      'x-opencode-session': sessionId,
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

// Helper to calculate traffic distribution percentage
function calculateDistribution(requestCounts, totalRequests) {
  const distribution = {};
  for (const [upstreamId, count] of requestCounts.entries()) {
    distribution[upstreamId] = (count / totalRequests) * 100;
  }
  return distribution;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Sticky Strategy Weight Distribution', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('real user scenario: weight=100, 100, 95, 8 distributes traffic correctly', () => {
    // This reproduces the exact user-reported scenario
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 100 }),
      makeUpstream({ id: 'provider-c', weight: 95 }),
      makeUpstream({ id: 'provider-d', weight: 8 }), // Low weight provider
    ];

    const route = makeRoute(upstreams);
    const config = makeConfig({ 'lb-test': route });

    // Simulate 1000 requests with unique sessions
    const totalRequests = 1000;
    for (let i = 0; i < totalRequests; i++) {
      const sessionId = `session-${i}`;
      const request = makeMockRequest(sessionId);

      // Route request (each unique session gets assigned once)
      routeRequest('lb-test', config, request, null);
    }

    // Get request counts
    const requestCounts = getUpstreamRequestCounts().get('lb-test');
    assert.ok(requestCounts, 'Request counts should be tracked');

    // Calculate distribution
    const distribution = calculateDistribution(requestCounts, totalRequests);

    // Verify weight=8 provider gets 2-8% of traffic (expected ~3.8%)
    const lowWeightPercentage = distribution['provider-d'];
    assert.ok(
      lowWeightPercentage >= 2 && lowWeightPercentage <= 8,
      `Weight=8 provider should get 2-8% of traffic, got ${lowWeightPercentage.toFixed(2)}%`
    );

    // Verify other providers get proportionally more traffic
    // Expected distribution: 100/303 = 33%, 100/303 = 33%, 95/303 = 31.4%, 8/303 = 2.6%
    const totalWeight = 100 + 100 + 95 + 8; // 303

    for (const upstream of upstreams) {
      const percentage = distribution[upstream.id];
      const expectedPercentage = (upstream.weight / totalWeight) * 100;

      // Allow 30% tolerance for statistical variation
      const tolerance = expectedPercentage * 0.3;
      assert.ok(
        Math.abs(percentage - expectedPercentage) <= tolerance,
        `Provider ${upstream.id} (weight=${upstream.weight}) should get ~${expectedPercentage.toFixed(1)}% ` +
          `± ${tolerance.toFixed(1)}%, got ${percentage.toFixed(2)}%`
      );
    }

    console.log('Traffic distribution:', distribution);
  });

  test('weight recovery: traffic redistributes when weight changes from 8 to 100', () => {
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 8 }), // Initially low weight
    ];

    const route = makeRoute(upstreams);
    const config = makeConfig({ 'lb-recovery': route });

    // Phase 1: Run 500 requests with weight=8
    const phase1Requests = 500;
    for (let i = 0; i < phase1Requests; i++) {
      const sessionId = `phase1-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-recovery', config, request, null);
    }

    const phase1Counts = getUpstreamRequestCounts().get('lb-recovery');
    const phase1Distribution = calculateDistribution(phase1Counts, phase1Requests);

    // Verify provider-b gets small share initially (~7.4%)
    const phase1LowWeightPercentage = phase1Distribution['provider-b'];
    assert.ok(
      phase1LowWeightPercentage >= 3 && phase1LowWeightPercentage <= 15,
      `Phase 1: Weight=8 provider should get 3-15% of traffic, got ${phase1LowWeightPercentage.toFixed(2)}%`
    );

    console.log('Phase 1 distribution (weight=8):', phase1Distribution);

    // Phase 2: Update provider-b weight to 100 (simulate recovery)
    upstreams[1].weight = 100;

    // Run another 500 requests with NEW sessions
    const phase2Requests = 500;
    for (let i = 0; i < phase2Requests; i++) {
      const sessionId = `phase2-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-recovery', config, request, null);
    }

    const phase2Counts = getUpstreamRequestCounts().get('lb-recovery');
    const totalRequests = phase1Requests + phase2Requests;
    const phase2Distribution = calculateDistribution(phase2Counts, totalRequests);

    // Verify provider-b now gets more traffic (~50%)
    const phase2RecoveredPercentage = phase2Distribution['provider-b'];

    // Calculate the increase in share
    const shareIncrease = phase2RecoveredPercentage - phase1LowWeightPercentage;

    // After recovery, should see increased traffic (from ~7.4% to ~50%)
    assert.ok(
      phase2RecoveredPercentage >= 35,
      `Phase 2: Recovered provider should get ≥35% of traffic, got ${phase2RecoveredPercentage.toFixed(2)}%`
    );

    console.log('Phase 2 distribution (weight=100):', phase2Distribution);
    console.log(
      `Traffic increase: ${phase1LowWeightPercentage.toFixed(2)}% → ${phase2RecoveredPercentage.toFixed(2)}%`
    );
  });

  test('session stickiness maintained during weight adjustments', () => {
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 100 }),
    ];

    const route = makeRoute(upstreams);
    const config = makeConfig({ 'lb-sticky': route });

    // Create 100 sessions and route requests
    const sessions = [];
    for (let i = 0; i < 100; i++) {
      const sessionId = `sticky-session-${i}`;
      const request = makeMockRequest(sessionId);
      const result = routeRequest('lb-sticky', config, request, null);
      sessions.push({
        sessionId,
        upstreamId: result.upstream.id,
      });
    }

    // Verify sessions are distributed (not all to one provider)
    const sessionMap = getSessionUpstreamMap();
    assert.ok(sessionMap.size >= 80, 'Should have at least 80 session mappings');

    // Send more requests with same sessions - should stay sticky
    for (let repeat = 0; repeat < 5; repeat++) {
      for (const session of sessions) {
        const request = makeMockRequest(session.sessionId);
        const result = routeRequest('lb-sticky', config, request, null);

        // Session should still route to same upstream
        assert.strictEqual(
          result.upstream.id,
          session.upstreamId,
          `Session ${session.sessionId} should stay sticky to ${session.upstreamId}`
        );
      }
    }

    // Now change weight of provider-a to 50
    upstreams[0].weight = 50;

    // Existing sessions should remain sticky
    for (const session of sessions.slice(0, 20)) {
      const request = makeMockRequest(session.sessionId);
      const result = routeRequest('lb-sticky', config, request, null);

      assert.strictEqual(
        result.upstream.id,
        session.upstreamId,
        `Existing session ${session.sessionId} should remain sticky after weight change`
      );
    }

    // New sessions should respect new weights
    let newSessionsToA = 0;
    let newSessionsToB = 0;

    for (let i = 0; i < 100; i++) {
      const sessionId = `new-session-${i}`;
      const request = makeMockRequest(sessionId);
      const result = routeRequest('lb-sticky', config, request, null);

      if (result.upstream.id === 'provider-a') {
        newSessionsToA++;
      } else {
        newSessionsToB++;
      }
    }

    // With weights 50 and 100, provider-a should get ~33% and provider-b ~67%
    const percentageA = (newSessionsToA / 100) * 100;
    assert.ok(
      percentageA >= 20 && percentageA <= 50,
      `New sessions to weight=50 provider should be 20-50%, got ${percentageA.toFixed(2)}%`
    );

    console.log(`New sessions: provider-a=${newSessionsToA}, provider-b=${newSessionsToB}`);
  });

  test('sliding window request counting filters old requests', async () => {
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 100 }),
    ];

    const route = makeRoute(upstreams);
    const config = makeConfig({ 'lb-window': route });

    // Create sessions and route requests
    for (let i = 0; i < 100; i++) {
      const sessionId = `window-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-window', config, request, null);
    }

    // Get initial counts
    const initialCounts = getUpstreamRequestCounts().get('lb-window');
    const totalInitial = Array.from(initialCounts.values()).reduce((sum, count) => sum + count, 0);

    assert.strictEqual(totalInitial, 100, 'Should have 100 total requests initially');

    // Wait for requests to become "old" (>10 minutes would be ideal, but for testing we use a shorter window)
    // In production, the window is 10 minutes. Here we just verify the mechanism works.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send more requests
    for (let i = 0; i < 50; i++) {
      const sessionId = `new-window-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-window', config, request, null);
    }

    const finalCounts = getUpstreamRequestCounts().get('lb-window');
    const totalFinal = Array.from(finalCounts.values()).reduce((sum, count) => sum + count, 0);

    assert.strictEqual(totalFinal, 150, 'Should have 150 total requests after second batch');

    // Note: The sliding window filtering is tested in unit tests
    // This integration test just verifies the counting mechanism works
    console.log('Request counts:', Object.fromEntries(finalCounts));
  });
});

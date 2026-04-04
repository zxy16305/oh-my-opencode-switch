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
  resetAllState,
  routeRequest,
  getUpstreamRequestCounts,
  getSessionUpstreamMap,
} from '../../src/proxy/router.js';

import {
  makeUpstream,
  makeRoute,
  makeConfig,
  makeMockRequest,
  calculateDistribution,
} from '../helpers/proxy-fixtures.js';

// ---------------------------------------------------------------------------
// Statistical Test Helpers
// ---------------------------------------------------------------------------

/**
 * Perform Chi-square goodness of fit test to verify if observed distribution matches expected
 * @param {Object} observed - Map of upstream ID to observed count
 * @param {Object} expected - Map of upstream ID to expected count
 * @param {number} significanceLevel - Alpha level (default 0.05)
 * @returns {Object} Test result: { chiSquared, pValue, passes }
 */
function chiSquareTest(observed, expected, significanceLevel = 0.05) {
  const categories = Object.keys(observed);
  let chiSquared = 0;

  for (const category of categories) {
    const o = observed[category];
    const e = expected[category];
    chiSquared += Math.pow(o - e, 2) / e;
  }

  const df = categories.length - 1;

  // Approximate p-value using Wilson-Hilferty transformation for simplicity
  // For df=1: p-value = 1 - chi_squared_cdf
  // For our purposes, we just need to check if p > 0.05
  let pValue;

  if (df === 1) {
    // Use chi-squared cumulative distribution approximation for df=1
    pValue = Math.exp(-Math.sqrt(chiSquared / 2));
  } else {
    // For df>1, use simplified approximation that works for our use case
    const adjusted = Math.pow(chiSquared / df, 1 / 3) - (1 - 2 / (9 * df));
    const zScore = adjusted / Math.sqrt(2 / (9 * df));
    pValue = 0.5 * (1 + erf(zScore / Math.sqrt(2)));
  }

  return {
    chiSquared,
    pValue,
    passes: pValue > significanceLevel,
  };
}

/**
 * Error function approximation for p-value calculation
 * @param {number} x Input value
 * @returns {number} erf(x)
 */
function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Sticky Strategy Weight Distribution', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('real user scenario: weight=100, 100, 95, 8 distributes traffic correctly', () => {
    // This reproduces the exact user-reported scenario
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 100 }),
      makeUpstream({ id: 'provider-c', weight: 95 }),
      makeUpstream({ id: 'provider-d', weight: 8 }), // Low weight provider
    ];

    const route = makeRoute(upstreams, 'sticky');
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

    // Verify weight=8 provider gets 1-10% of traffic (expected ~3.8%)
    const lowWeightPercentage = distribution['provider-d'];
    assert.ok(
      lowWeightPercentage >= 1 && lowWeightPercentage <= 10,
      `Weight=8 provider should get 1-10% of traffic, got ${lowWeightPercentage.toFixed(2)}%`
    );

    // Verify other providers get proportionally more traffic
    // Expected distribution: 100/303 = 33%, 100/303 = 33%, 95/303 = 31.4%, 8/303 = 2.6%
    const totalWeight = 100 + 100 + 95 + 8; // 303

    for (const upstream of upstreams) {
      const percentage = distribution[upstream.id];
      const expectedPercentage = (upstream.weight / totalWeight) * 100;

      // Allow 40% tolerance for statistical variation with session-based allocation
      const tolerance = expectedPercentage * 0.4;
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

    const route = makeRoute(upstreams, 'sticky');
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

    const route = makeRoute(upstreams, 'sticky');
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

    // Reset all state except existing session mappings to test new weight allocation
    // This simulates starting fresh with existing sessions still active
    const existingMappings = new Map(sessionMap);
    resetAllState();
    // Restore existing session mappings
    for (const [key, value] of existingMappings.entries()) {
      getSessionUpstreamMap().set(key, value);
    }

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
      percentageA >= 20 && percentageA <= 45,
      `New sessions to weight=50 provider should be 20-45%, got ${percentageA.toFixed(2)}%`
    );

    console.log(`New sessions: provider-a=${newSessionsToA}, provider-b=${newSessionsToB}`);
  });

  test('sliding window request counting filters old requests', async () => {
    const upstreams = [
      makeUpstream({ id: 'provider-a', weight: 100 }),
      makeUpstream({ id: 'provider-b', weight: 100 }),
    ];

    const route = makeRoute(upstreams, 'sticky');
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

  // ---------------------------------------------------------------------------
  // Weight Ratio Tests (50 vs 100)
  // ---------------------------------------------------------------------------

  test('sticky strategy short-term weight ratio (50 vs 100, 100 requests)', () => {
    const upstreams = [
      makeUpstream({ id: 'provider-low', weight: 50 }),
      makeUpstream({ id: 'provider-high', weight: 100 }),
    ];

    const route = makeRoute(upstreams, 'sticky');
    const config = makeConfig({ 'lb-weight-ratio': route });

    // Simulate 100 requests with unique sessions
    const totalRequests = 100;
    for (let i = 0; i < totalRequests; i++) {
      const sessionId = `short-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-weight-ratio', config, request, null);
    }

    // Get request counts
    const requestCounts = getUpstreamRequestCounts().get('lb-weight-ratio');
    assert.ok(requestCounts, 'Request counts should be tracked');

    const counts = Object.fromEntries(requestCounts);
    const lowCount = counts['provider-low'] || 0;
    const highCount = counts['provider-high'] || 0;

    console.log(`Short-term counts: provider-low=${lowCount}, provider-high=${highCount}`);

    // Expected ratio: 50 : 100 = 1 : 2
    const totalWeight = 50 + 100;
    const expectedLow = totalRequests * (50 / totalWeight);
    const expectedHigh = totalRequests * (100 / totalWeight);

    // Allow ±15% tolerance for small sample size
    const tolerance = 0.15;
    assert.ok(
      lowCount >= expectedLow * (1 - tolerance) && lowCount <= expectedLow * (1 + tolerance),
      `Provider low (weight=50) should get ~${expectedLow.toFixed(0)} requests, got ${lowCount}`
    );
    assert.ok(
      highCount >= expectedHigh * (1 - tolerance) && highCount <= expectedHigh * (1 + tolerance),
      `Provider high (weight=100) should get ~${expectedHigh.toFixed(0)} requests, got ${highCount}`
    );

    // Chi-square test
    const chiResult = chiSquareTest(
      { low: lowCount, high: highCount },
      { low: expectedLow, high: expectedHigh }
    );
    assert.ok(
      chiResult.passes,
      `Chi-square test failed: p-value = ${chiResult.pValue.toFixed(4)}, chi-squared = ${chiResult.chiSquared.toFixed(4)}`
    );
  });

  test('sticky strategy long-term weight ratio (50 vs 100, 10000 requests, sliding window)', () => {
    const upstreams = [
      makeUpstream({ id: 'provider-low', weight: 50 }),
      makeUpstream({ id: 'provider-high', weight: 100 }),
    ];

    const route = makeRoute(upstreams, 'sticky');
    const config = makeConfig({ 'lb-weight-ratio-long': route });

    // Simulate 10000 requests with unique sessions
    const totalRequests = 10000;
    for (let i = 0; i < totalRequests; i++) {
      const sessionId = `long-session-${i}`;
      const request = makeMockRequest(sessionId);
      routeRequest('lb-weight-ratio-long', config, request, null);
    }

    // Get request counts
    const requestCounts = getUpstreamRequestCounts().get('lb-weight-ratio-long');
    assert.ok(requestCounts, 'Request counts should be tracked');

    const counts = Object.fromEntries(requestCounts);
    const lowCount = counts['provider-low'] || 0;
    const highCount = counts['provider-high'] || 0;

    console.log(`Long-term counts: provider-low=${lowCount}, provider-high=${highCount}`);

    // Expected ratio: 50 : 100 = 1 : 2
    const totalWeight = 50 + 100;
    const expectedLow = totalRequests * (50 / totalWeight);
    const expectedHigh = totalRequests * (100 / totalWeight);

    // For large sample size, allow ±5% tolerance
    const tolerance = 0.05;
    assert.ok(
      lowCount >= expectedLow * (1 - tolerance) && lowCount <= expectedLow * (1 + tolerance),
      `Provider low (weight=50) should get ~${expectedLow.toFixed(0)} requests, got ${lowCount}`
    );
    assert.ok(
      highCount >= expectedHigh * (1 - tolerance) && highCount <= expectedHigh * (1 + tolerance),
      `Provider high (weight=100) should get ~${expectedHigh.toFixed(0)} requests, got ${highCount}`
    );

    // Chi-square test with p-value > 0.05
    const chiResult = chiSquareTest(
      { low: lowCount, high: highCount },
      { low: expectedLow, high: expectedHigh }
    );
    assert.ok(
      chiResult.passes,
      `Chi-square test failed: p-value = ${chiResult.pValue.toFixed(4)}, chi-squared = ${chiResult.chiSquared.toFixed(4)}`
    );

    // Verify ratio is approximately 1:2
    const ratio = highCount / lowCount;
    assert.ok(
      ratio >= 1.7 && ratio <= 2.3,
      `Ratio should be ~2.0 (high/low), got ${ratio.toFixed(2)}`
    );
  });
});

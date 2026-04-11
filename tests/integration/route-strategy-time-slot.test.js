/**
 * Integration tests for routing strategies with time-slot weights.
 *
 * Verifies:
 * - Weighted strategy respects timeSlotWeights on upstreams
 * - Sticky strategy distributes new sessions based on effective time-slot weight
 * - Backwards compatibility when timeSlotWeights is absent
 * - Edge cases: empty timeSlotWeights, zero weights, identical timeSlotWeights
 *
 * NOTE: Tests adapt to the current system hour since new Date().getHours()
 * cannot be easily mocked in Node.js native test runner. Each test determines
 * the current slot type and adjusts expected values accordingly.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetAllState, routeRequest, getUpstreamRequestCounts } from '../../src/proxy/router.js';

import {
  makeUpstream,
  makeRoute,
  makeConfig,
  makeMockRequest,
  calculateDistribution,
} from '../helpers/proxy-fixtures.js';

import { getTimeSlotType } from '../../src/utils/time-slot-detector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current time slot type based on system clock
 * @returns {'high' | 'medium' | 'low'}
 */
function getCurrentSlotType() {
  return getTimeSlotType(new Date().getHours());
}

/**
 * Run N unique session requests through routeRequest and return counts per upstream
 * @param {string} routeKey - Route key in config
 * @param {object} config - Routes config
 * @param {number} count - Number of requests
 * @returns {Map<string, number>} upstream id → request count
 */
function runRequests(routeKey, config, count) {
  for (let i = 0; i < count; i++) {
    const sessionId = `ts-session-${i}`;
    const request = makeMockRequest(sessionId);
    routeRequest(routeKey, config, request, null);
  }
  return getUpstreamRequestCounts().get(routeKey);
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Route Strategy with Time-Slot Weights', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  // -------------------------------------------------------------------------
  // Weighted Strategy
  // -------------------------------------------------------------------------

  describe('Weighted strategy with timeSlotWeights', () => {
    test('upstream with higher slot weight receives more traffic', () => {
      const slot = getCurrentSlotType();
      // provider-a has high slot weight, provider-b has low slot weight
      const highWeight = 200;
      const lowWeight = 50;

      const upstreams = [
        makeUpstream({
          id: 'provider-a',
          weight: 100,
          timeSlotWeights: { high: highWeight, medium: highWeight, low: highWeight },
        }),
        makeUpstream({
          id: 'provider-b',
          weight: 100,
          timeSlotWeights: { high: lowWeight, medium: lowWeight, low: lowWeight },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-weighted': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-weighted', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // provider-a should get significantly more traffic than provider-b
      // Expected: highWeight / (highWeight + lowWeight) ≈ 200/250 = 80%
      const expectedA = (highWeight / (highWeight + lowWeight)) * 100;
      const pctA = distribution['provider-a'];

      // Allow 10% relative tolerance for randomness
      const tolerance = expectedA * 0.1;
      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `provider-a should get ~${expectedA.toFixed(1)}% at ${slot} slot, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `[${slot}] Weighted distribution: A=${distribution['provider-a']?.toFixed(2)}%, B=${distribution['provider-b']?.toFixed(2)}%`
      );
    });

    test('traffic distribution changes when slot weights differ per slot type', () => {
      const slot = getCurrentSlotType();
      // provider-a: strong in high, weak in low
      // provider-b: weak in high, strong in low
      const upstreams = [
        makeUpstream({
          id: 'provider-a',
          weight: 100,
          timeSlotWeights: { high: 200, medium: 100, low: 30 },
        }),
        makeUpstream({
          id: 'provider-b',
          weight: 100,
          timeSlotWeights: { high: 30, medium: 100, low: 200 },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-slot-diff': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-slot-diff', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // Determine expected based on current slot
      const slotWeights = {
        'provider-a': upstreams[0].timeSlotWeights[slot],
        'provider-b': upstreams[1].timeSlotWeights[slot],
      };
      const total = slotWeights['provider-a'] + slotWeights['provider-b'];
      const expectedA = (slotWeights['provider-a'] / total) * 100;
      const pctA = distribution['provider-a'];

      const tolerance = expectedA * 0.1;
      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `At ${slot} slot, provider-a should get ~${expectedA.toFixed(1)}%, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `[${slot}] Slot-diff distribution: A=${distribution['provider-a']?.toFixed(2)}%, B=${distribution['provider-b']?.toFixed(2)}%`
      );
    });

    test('weighted strategy config silently uses sticky routing', () => {
      const slot = getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'u-heavy',
          weight: 100,
          timeSlotWeights: { high: 300, medium: 200, low: 100 },
        }),
        makeUpstream({
          id: 'u-light',
          weight: 100,
          timeSlotWeights: { high: 50, medium: 50, low: 50 },
        }),
      ];

      // 'weighted' strategy is silently converted to 'sticky'
      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-direct': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-direct', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      const heavySlotWeight = upstreams[0].timeSlotWeights[slot];
      const lightSlotWeight = upstreams[1].timeSlotWeights[slot];
      const totalWeight = heavySlotWeight + lightSlotWeight;
      const expectedHeavyPct = (heavySlotWeight / totalWeight) * 100;
      const actualHeavyPct = distribution['u-heavy'];

      // Wider tolerance for sticky distribution
      const tolerance = expectedHeavyPct * 0.25;
      assert.ok(
        actualHeavyPct >= expectedHeavyPct - tolerance &&
          actualHeavyPct <= expectedHeavyPct + tolerance,
        `Weighted→sticky: u-heavy should get ~${expectedHeavyPct.toFixed(1)}% at ${slot}, got ${actualHeavyPct.toFixed(2)}%`
      );

      console.log(
        `[${slot}] Weighted→sticky: heavy=${actualHeavyPct.toFixed(2)}%, light=${distribution['u-light']?.toFixed(2)}%`
      );
    });
  });

  // -------------------------------------------------------------------------
  // Sticky Strategy
  // -------------------------------------------------------------------------

  describe('Sticky strategy with timeSlotWeights', () => {
    test('new sessions distributed based on effective time-slot weight', () => {
      const slot = getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'sticky-a',
          weight: 100,
          timeSlotWeights: { high: 200, medium: 150, low: 50 },
        }),
        makeUpstream({
          id: 'sticky-b',
          weight: 100,
          timeSlotWeights: { high: 50, medium: 50, low: 150 },
        }),
      ];

      const route = makeRoute(upstreams, 'sticky');
      const config = makeConfig({ 'ts-sticky': route });

      const totalRequests = 2000;
      const counts = runRequests('ts-sticky', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      const slotWeightA = upstreams[0].timeSlotWeights[slot];
      const slotWeightB = upstreams[1].timeSlotWeights[slot];
      const totalWeight = slotWeightA + slotWeightB;
      const expectedA = (slotWeightA / totalWeight) * 100;
      const pctA = distribution['sticky-a'];

      // Wider tolerance for sticky (session hashing adds noise)
      const tolerance = expectedA * 0.25;
      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `Sticky at ${slot} slot: sticky-a should get ~${expectedA.toFixed(1)}%, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `[${slot}] Sticky distribution: A=${distribution['sticky-a']?.toFixed(2)}%, B=${distribution['sticky-b']?.toFixed(2)}%`
      );
    });

    test('existing sessions maintain stickiness with timeSlotWeights', () => {
      const upstreams = [
        makeUpstream({
          id: 'sticky-sess-a',
          weight: 100,
          timeSlotWeights: { high: 100, medium: 100, low: 100 },
        }),
        makeUpstream({
          id: 'sticky-sess-b',
          weight: 100,
          timeSlotWeights: { high: 100, medium: 100, low: 100 },
        }),
      ];

      const route = makeRoute(upstreams, 'sticky');
      const config = makeConfig({ 'ts-sticky-sess': route });

      // Create sessions and record their upstream assignment
      const sessions = [];
      for (let i = 0; i < 50; i++) {
        const sessionId = `persist-session-${i}`;
        const request = makeMockRequest(sessionId);
        const result = routeRequest('ts-sticky-sess', config, request, null);
        sessions.push({
          sessionId,
          upstreamId: result.upstream.id,
        });
      }

      // Send more requests with same sessions - must stay sticky
      for (let repeat = 0; repeat < 5; repeat++) {
        for (const session of sessions) {
          const request = makeMockRequest(session.sessionId);
          const result = routeRequest('ts-sticky-sess', config, request, null);
          assert.strictEqual(
            result.upstream.id,
            session.upstreamId,
            `Session ${session.sessionId} should remain sticky to ${session.upstreamId}`
          );
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Backwards Compatibility
  // -------------------------------------------------------------------------

  describe('Backwards compatibility (no timeSlotWeights)', () => {
    test('config without timeSlotWeights uses upstream.weight', () => {
      const upstreams = [
        makeUpstream({ id: 'compat-a', weight: 70 }),
        makeUpstream({ id: 'compat-b', weight: 130 }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-compat': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-compat', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      const expectedA = (70 / 200) * 100; // 35%
      const pctA = distribution['compat-a'];
      const tolerance = expectedA * 0.1;

      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `Without timeSlotWeights: compat-a (w=70) should get ~35%, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `Compat distribution: A=${distribution['compat-a']?.toFixed(2)}%, B=${distribution['compat-b']?.toFixed(2)}%`
      );
    });

    test('partial config (only one slot defined) falls back to upstream.weight for others', () => {
      const slot = getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'partial-a',
          weight: 100,
          timeSlotWeights: { high: 200 }, // only high defined
        }),
        makeUpstream({
          id: 'partial-b',
          weight: 100,
          timeSlotWeights: { high: 50 }, // only high defined
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-partial': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-partial', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      if (slot === 'high') {
        // Both have high defined: 200 vs 50 → A should get 80%
        const expectedA = (200 / 250) * 100;
        const pctA = distribution['partial-a'];
        const tolerance = expectedA * 0.1;
        assert.ok(
          pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
          `At high slot: partial-a should get ~${expectedA.toFixed(1)}%, got ${pctA.toFixed(2)}%`
        );
      } else {
        // medium/low not defined → falls back to upstream.weight (100 vs 100 → ~50/50)
        const pctA = distribution['partial-a'];
        assert.ok(
          pctA >= 45 && pctA <= 55,
          `At ${slot} slot (not defined): should be ~50/50, got A=${pctA.toFixed(2)}%`
        );
      }

      console.log(
        `[${slot}] Partial config distribution: A=${distribution['partial-a']?.toFixed(2)}%, B=${distribution['partial-b']?.toFixed(2)}%`
      );
    });

    test('mixed config: one upstream has timeSlotWeights, other does not', () => {
      getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'mixed-a',
          weight: 100,
          timeSlotWeights: { high: 200, medium: 200, low: 200 },
        }),
        makeUpstream({
          id: 'mixed-b',
          weight: 100,
          // no timeSlotWeights → always uses weight 100
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-mixed': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-mixed', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // mixed-a has slot weight 200 for all slots, mixed-b uses base weight 100
      const expectedA = (200 / 300) * 100; // ~66.7%
      const pctA = distribution['mixed-a'];
      const tolerance = expectedA * 0.1;

      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `Mixed config: mixed-a should get ~${expectedA.toFixed(1)}%, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `Mixed config distribution: A=${distribution['mixed-a']?.toFixed(2)}%, B=${distribution['mixed-b']?.toFixed(2)}%`
      );
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    test('empty timeSlotWeights object uses upstream.weight', () => {
      const upstreams = [
        makeUpstream({
          id: 'empty-ts-a',
          weight: 80,
          timeSlotWeights: {},
        }),
        makeUpstream({
          id: 'empty-ts-b',
          weight: 120,
          timeSlotWeights: {},
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-empty': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-empty', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // Empty timeSlotWeights → no slot match → use base weights
      const expectedA = (80 / 200) * 100; // 40%
      const pctA = distribution['empty-ts-a'];
      const tolerance = expectedA * 0.1;

      assert.ok(
        pctA >= expectedA - tolerance && pctA <= expectedA + tolerance,
        `Empty timeSlotWeights: should use base weights, A expected ~40%, got ${pctA.toFixed(2)}%`
      );
    });

    test('zero slot weight still gets minimum 1 effective weight', () => {
      const slot = getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'zero-a',
          weight: 100,
          timeSlotWeights: { high: 0, medium: 0, low: 0 },
        }),
        makeUpstream({
          id: 'zero-b',
          weight: 100,
          timeSlotWeights: { high: 100, medium: 100, low: 100 },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-zero': route });

      const totalRequests = 5000;
      const counts = runRequests('ts-zero', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // zero-a has effective weight 1 (min clamped), zero-b has 100
      // Expected: zero-a gets ~1/101 ≈ 1%
      const pctA = distribution['zero-a'];
      assert.ok(
        pctA >= 0 && pctA <= 5,
        `Zero slot weight provider should get 0-5% of traffic, got ${pctA.toFixed(2)}%`
      );

      console.log(
        `[${slot}] Zero weight distribution: A=${distribution['zero-a']?.toFixed(2)}%, B=${distribution['zero-b']?.toFixed(2)}%`
      );
    });

    test('all upstreams have same timeSlotWeights → equal distribution', () => {
      const upstreams = [
        makeUpstream({
          id: 'same-a',
          weight: 100,
          timeSlotWeights: { high: 80, medium: 80, low: 80 },
        }),
        makeUpstream({
          id: 'same-b',
          weight: 100,
          timeSlotWeights: { high: 80, medium: 80, low: 80 },
        }),
        makeUpstream({
          id: 'same-c',
          weight: 100,
          timeSlotWeights: { high: 80, medium: 80, low: 80 },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-same': route });

      const totalRequests = 6000;
      const counts = runRequests('ts-same', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      // All equal → ~33.3% each
      for (const id of ['same-a', 'same-b', 'same-c']) {
        const pct = distribution[id];
        assert.ok(pct >= 28 && pct <= 38, `${id} should get ~33% (±5%), got ${pct.toFixed(2)}%`);
      }

      console.log(
        `Same weights distribution: A=${distribution['same-a']?.toFixed(2)}%, B=${distribution['same-b']?.toFixed(2)}%, C=${distribution['same-c']?.toFixed(2)}%`
      );
    });

    test('single upstream with timeSlotWeights works correctly', () => {
      const upstreams = [
        makeUpstream({
          id: 'single-u',
          weight: 100,
          timeSlotWeights: { high: 50, medium: 100, low: 200 },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-single': route });

      // All requests should go to the single upstream
      for (let i = 0; i < 100; i++) {
        const sessionId = `single-session-${i}`;
        const request = makeMockRequest(sessionId);
        const result = routeRequest('ts-single', config, request, null);
        assert.strictEqual(result.upstream.id, 'single-u');
      }
    });

    test('three upstreams with different timeSlotWeights distribute correctly', () => {
      const slot = getCurrentSlotType();
      const upstreams = [
        makeUpstream({
          id: 'tri-heavy',
          weight: 100,
          timeSlotWeights: { high: 300, medium: 100, low: 30 },
        }),
        makeUpstream({
          id: 'tri-mid',
          weight: 100,
          timeSlotWeights: { high: 100, medium: 100, low: 100 },
        }),
        makeUpstream({
          id: 'tri-light',
          weight: 100,
          timeSlotWeights: { high: 30, medium: 100, low: 300 },
        }),
      ];

      const route = makeRoute(upstreams, 'weighted');
      const config = makeConfig({ 'ts-tri': route });

      const totalRequests = 10000;
      const counts = runRequests('ts-tri', config, totalRequests);
      const distribution = calculateDistribution(counts, totalRequests);

      const weights = upstreams.map((u) => u.timeSlotWeights[slot]);
      const totalWeight = weights.reduce((s, w) => s + w, 0);

      for (let i = 0; i < upstreams.length; i++) {
        const expected = (weights[i] / totalWeight) * 100;
        const actual = distribution[upstreams[i].id];
        const tolerance = expected * 0.15;

        assert.ok(
          actual >= expected - tolerance && actual <= expected + tolerance,
          `${upstreams[i].id} should get ~${expected.toFixed(1)}% at ${slot}, got ${actual.toFixed(2)}%`
        );
      }

      console.log(
        `[${slot}] Tri distribution: heavy=${distribution['tri-heavy']?.toFixed(2)}%, mid=${distribution['tri-mid']?.toFixed(2)}%, light=${distribution['tri-light']?.toFixed(2)}%`
      );
    });
  });
});

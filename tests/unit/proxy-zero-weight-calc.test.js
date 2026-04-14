/**
 * TDD RED phase tests for zero-weight calculation behavior.
 *
 * These tests verify that weight=0 should be allowed and respected,
 * not clamped to min 1.
 *
 * CURRENT BEHAVIOR (expected to FAIL):
 * - Math.max(1, effectiveWeight) clamps to 1
 * - Tests 1, 3, 4 will FAIL until implementation is fixed
 *
 * Test 2 should PASS (Infinity is valid result for division by 0).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateEffectiveWeight,
  calculateLeastLoadedScore,
} from '../../src/proxy/weight-calculator.js';
import { WeightManager } from '../../src/proxy/weight/WeightManager.js';
import { StateManager } from '../../src/proxy/state-manager.js';
import { makeUpstream } from '../helpers/proxy-fixtures.js';

// ---------------------------------------------------------------------------
// Test 1: calculateEffectiveWeight with staticWeight=0 returns 0
// ---------------------------------------------------------------------------

describe('calculateEffectiveWeight zero-weight behavior', () => {
  it('should return 0 when staticWeight=0 (no dynamic weight)', () => {
    const sm = new StateManager();
    const wm = new WeightManager();

    const result = calculateEffectiveWeight({
      sm,
      routeKey: 'test-route',
      upstream: makeUpstream({ id: 'upstream-0', weight: 0 }),
      staticWeight: 0,
      dynamicWeightConfig: null,
      weightManager: wm,
    });

    // EXPECTED: 0 (zero-weight should be respected)
    // CURRENT: Math.max(1, 0) = 1 — this test WILL FAIL
    assert.strictEqual(result, 0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: calculateLeastLoadedScore with effectiveWeight=0 returns Infinity
// ---------------------------------------------------------------------------

describe('calculateLeastLoadedScore zero-weight edge case', () => {
  it('should return Infinity when effectiveWeight=0 (graceful handling)', () => {
    const score = calculateLeastLoadedScore(5, 0);

    // (5+1)/0 = Infinity, not crash
    // This test should PASS (JavaScript handles division by zero)
    assert.strictEqual(score, Infinity);
  });

  it('should return Infinity when requestCount=0 and effectiveWeight=0', () => {
    const score = calculateLeastLoadedScore(0, 0);

    // (0+1)/0 = Infinity
    assert.strictEqual(score, Infinity);
  });
});

// ---------------------------------------------------------------------------
// Test 3: WeightManager.getEffectiveWeight returns 0 when configured weight is 0 (no dynamic)
// ---------------------------------------------------------------------------

describe('WeightManager.getEffectiveWeight zero-weight behavior', () => {
  it('should return 0 when configured weight is 0 and no dynamic config', () => {
    const wm = new WeightManager();
    const upstream = makeUpstream({ id: 'zero-upstream', weight: 0 });

    // No dynamic weight enabled
    const result = wm.getEffectiveWeight('test-route', upstream, null);

    // EXPECTED: 0 (configured weight should be respected)
    // CURRENT: Math.max(1, getConfiguredWeight()) = Math.max(1, 0) = 1
    // This test WILL FAIL
    assert.strictEqual(result, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: WeightManager.getEffectiveWeight returns 0 when configured weight is 0 (dynamic enabled)
  // ---------------------------------------------------------------------------

  it('should return 0 when configured weight is 0 and dynamic enabled (no state yet)', () => {
    const wm = new WeightManager();
    wm.initRoutes({
      'test-route': {
        upstreams: [makeUpstream({ id: 'zero-upstream', weight: 0 })],
      },
    });

    // Dynamic weight enabled, but state.currentWeight = 0 (initialized from configuredWeight)
    const result = wm.getEffectiveWeight(
      'test-route',
      makeUpstream({ id: 'zero-upstream', weight: 0 }),
      { enabled: true }
    );

    // EXPECTED: 0
    // CURRENT: Math.max(1, state.currentWeight) = Math.max(1, 0) = 1
    // This test WILL FAIL
    assert.strictEqual(result, 0);
  });

  it('should return configured weight fallback when dynamic enabled but no state', () => {
    const wm = new WeightManager();

    // No initRoutes called — no state exists
    const upstream = makeUpstream({ id: 'new-upstream', weight: 0 });

    const result = wm.getEffectiveWeight('test-route', upstream, { enabled: true });

    // EXPECTED: 0 (fallback to configured weight)
    // CURRENT: Math.max(1, getConfiguredWeight()) = Math.max(1, 0) = 1
    // This test WILL FAIL
    assert.strictEqual(result, 0);
  });
});

/**
 * Unit tests for weight-calculator module - read-only verification
 * Verifies that calculateEffectiveWeight does NOT modify dynamic weight state.
 * @module tests/proxy/unit/weight-calculator-readonly.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../../src/proxy/state-manager.js';
import { calculateEffectiveWeight } from '../../../src/proxy/weight-calculator.js';
import { recordUpstreamError, recordUpstreamLatency } from '../../../src/proxy/stats-collector.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests - Read-Only Behavior Verification
// ===========================================================================

describe('Weight Calculator – Read-Only Verification', () => {
  let sm;

  beforeEach(() => {
    sm = new StateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  test('multiple calls do not change dynamic weight', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-stable', weight: 100 });
    const staticWeight = 100;
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    // First call initializes dynamic weight to 100
    const weight1 = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });
    assert.strictEqual(weight1, 100, 'First call should return 100');

    // Call 9 more times - dynamic weight should remain 100
    for (let i = 0; i < 9; i++) {
      const weight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
      });
      assert.strictEqual(weight, 100, `Call ${i + 2} should still return 100`);
    }

    // Verify dynamic weight state is still 100
    const dynamicWeightState = sm.getDynamicWeightState();
    const key = `${routeKey}:${upstream.id}`;
    const state = dynamicWeightState.get(key);
    assert.strictEqual(
      state.currentWeight,
      100,
      'Dynamic weight should still be 100 after 10 calls'
    );
  });

  test('latency data does not affect weight', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-latency', weight: 100 });
    const staticWeight = 100;
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    // Record high latency data
    recordUpstreamLatency(sm, routeKey, upstream.id, 5000, 5000);
    recordUpstreamLatency(sm, routeKey, upstream.id, 6000, 6000);
    recordUpstreamLatency(sm, routeKey, upstream.id, 7000, 7000);

    // Calculate effective weight - should still be 100 (no latency penalty)
    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    assert.strictEqual(effectiveWeight, 100, 'High latency should not affect weight (read-only)');

    // Verify dynamic weight state is unchanged
    const dynamicWeightState = sm.getDynamicWeightState();
    const key = `${routeKey}:${upstream.id}`;
    const state = dynamicWeightState.get(key);
    assert.strictEqual(
      state.currentWeight,
      100,
      'Dynamic weight should remain 100 despite high latency'
    );
  });

  test('error weight penalty still applies (read-only calculation)', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-error', weight: 100 });
    const staticWeight = 100;
    const dynamicWeightConfig = {
      enabled: true,
      initialWeight: 100,
      errorWeightReduction: {
        enabled: true,
        reductionAmount: 10,
        minWeight: 5,
        errorWindowMs: 3600000,
      },
    };

    // Record 3 errors
    recordUpstreamError(sm, routeKey, upstream.id, 500);
    recordUpstreamError(sm, routeKey, upstream.id, 502);
    recordUpstreamError(sm, routeKey, upstream.id, 503);

    // Calculate effective weight - should be reduced due to errors
    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // Expected: 100 - (3 * 10) = 70
    assert.strictEqual(effectiveWeight, 70, 'Error penalty should reduce weight to 70');

    // Verify dynamic weight state is still 100 (only read, not written)
    const dynamicWeightState = sm.getDynamicWeightState();
    const key = `${routeKey}:${upstream.id}`;
    const state = dynamicWeightState.get(key);
    assert.strictEqual(
      state.currentWeight,
      100,
      'Dynamic weight should remain 100 (error penalty is read-only)'
    );

    // Second call should still return 70 (error penalty still applies)
    const effectiveWeight2 = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });
    assert.strictEqual(effectiveWeight2, 70, 'Second call should also return 70');
  });

  test('mixed weights stay stable across multiple calls', () => {
    const routeKey = 'test-route';
    const upstream1 = makeUpstream({ id: 'heavy', weight: 200 });
    const upstream2 = makeUpstream({ id: 'light', weight: 50 });
    const upstreams = [upstream1, upstream2];
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    // Call calculateEffectiveWeight 10 times for each upstream
    for (let i = 0; i < 10; i++) {
      const weight1 = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream: upstream1,
        staticWeight: 200,
        dynamicWeightConfig,
        upstreams,
      });

      const weight2 = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream: upstream2,
        staticWeight: 50,
        dynamicWeightConfig,
        upstreams,
      });

      // Weights should remain stable
      assert.strictEqual(weight1, 200, `Heavy upstream weight should stay 200 (call ${i + 1})`);
      assert.strictEqual(weight2, 50, `Light upstream weight should stay 50 (call ${i + 1})`);
    }

    // Verify dynamic weight states are stable
    const dynamicWeightState = sm.getDynamicWeightState();
    const state1 = dynamicWeightState.get(`${routeKey}:${upstream1.id}`);
    const state2 = dynamicWeightState.get(`${routeKey}:${upstream2.id}`);

    assert.strictEqual(state1.currentWeight, 200, 'Heavy upstream dynamic weight should be 200');
    assert.strictEqual(state2.currentWeight, 50, 'Light upstream dynamic weight should be 50');
  });
});

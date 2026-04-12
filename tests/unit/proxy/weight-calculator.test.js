/**
 * Unit tests for weight-calculator module - weight initialization
 * @module tests/proxy/unit/weight-calculator.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../../src/proxy/state-manager.js';
import { calculateEffectiveWeight } from '../../../src/proxy/weight-calculator.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests - Weight Initialization (Fix Verification)
// ===========================================================================

describe('Weight Calculator – Weight Initialization', () => {
  let sm;

  beforeEach(() => {
    sm = new StateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  test('configured weight 200 is used as initial dynamic weight', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-200', weight: 200 });
    const staticWeight = 200;
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // The effective weight should be 200, not 100
    assert.strictEqual(
      effectiveWeight,
      200,
      'Effective weight should be initialized to configured weight 200'
    );
  });

  test('configured weight 50 is used as initial dynamic weight', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-50', weight: 50 });
    const staticWeight = 50;
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // The effective weight should be 50, not 100
    assert.strictEqual(
      effectiveWeight,
      50,
      'Effective weight should be initialized to configured weight 50'
    );
  });

  test('no configured weight uses default 100 as initial dynamic weight', () => {
    const routeKey = 'test-route';
    // makeUpstream defaults weight to 100 if not specified
    const upstream = makeUpstream({ id: 'upstream-default' });
    const staticWeight = 100; // default weight
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // The effective weight should be 100 (default)
    assert.strictEqual(
      effectiveWeight,
      100,
      'Effective weight should be initialized to default 100'
    );
  });

  test('dynamic weight disabled uses static weight directly', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-static', weight: 200 });
    const staticWeight = 200;
    const dynamicWeightConfig = { enabled: false, initialWeight: 100 };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // When dynamic weight is disabled, use static weight directly
    assert.strictEqual(
      effectiveWeight,
      200,
      'Effective weight should be static weight when dynamic weight disabled'
    );
  });

  test('no dynamic weight config uses static weight directly', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-no-config', weight: 150 });
    const staticWeight = 150;

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig: null,
    });

    // When no dynamic weight config, use static weight directly
    assert.strictEqual(
      effectiveWeight,
      150,
      'Effective weight should be static weight when no dynamic weight config'
    );
  });

  test('multiple upstreams with different configured weights', () => {
    const routeKey = 'test-route';
    const upstream1 = makeUpstream({ id: 'heavy', weight: 200 });
    const upstream2 = makeUpstream({ id: 'light', weight: 50 });
    const upstreams = [upstream1, upstream2];
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    // Calculate effective weight for heavy upstream
    const effectiveWeight1 = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream: upstream1,
      staticWeight: 200,
      dynamicWeightConfig,
      upstreams,
    });

    // Calculate effective weight for light upstream
    const effectiveWeight2 = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream: upstream2,
      staticWeight: 50,
      dynamicWeightConfig,
      upstreams,
    });

    // Each upstream should have its own configured weight as initial value
    assert.strictEqual(effectiveWeight1, 200, 'Heavy upstream should have weight 200');
    assert.strictEqual(effectiveWeight2, 50, 'Light upstream should have weight 50');
  });

  test('dynamic weight state is initialized with configured weight', () => {
    const routeKey = 'test-route';
    const upstream = makeUpstream({ id: 'upstream-init', weight: 200 });
    const staticWeight = 200;
    const dynamicWeightConfig = { enabled: true, initialWeight: 100 };

    calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // Check that the dynamic weight state was initialized with 200
    const dynamicWeightState = sm.getDynamicWeightState();
    const key = `${routeKey}:${upstream.id}`;
    const state = dynamicWeightState.get(key);

    assert.ok(state, 'Dynamic weight state should be created');
    assert.strictEqual(state.currentWeight, 200, 'Initial dynamic weight should be 200');
  });
});

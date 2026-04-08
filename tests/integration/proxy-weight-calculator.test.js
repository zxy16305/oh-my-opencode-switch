/**
 * Integration tests for proxy weight calculator functionality
 * @module tests/integration/proxy-weight-calculator.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../src/proxy/state-manager.js';
import { calculateEffectiveWeight, resetAllState } from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTestUpstream(id, overrides = {}) {
  return {
    id,
    provider: 'test-provider',
    model: 'test-model',
    baseURL: `http://localhost:800${id.slice(-1)}`,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Weight Calculator – calculateEffectiveWeight', () => {
  let sm;

  beforeEach(() => {
    resetAllState();
    sm = new StateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  test('1. Returns static weight when no configs are provided', () => {
    const upstream = makeTestUpstream('u1');
    const staticWeight = 100;

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
    });

    assert.strictEqual(effectiveWeight, 100);
  });

  test('2. Dynamic weight: returns configured weight when enabled', () => {
    const upstream = makeTestUpstream('u1');
    const staticWeight = 200;
    const dynamicWeightConfig = {
      enabled: true,
      initialWeight: 100,
    };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    assert.strictEqual(effectiveWeight, 200);
  });

  test('3. Error penalty: reduces weight when errors are recorded', async () => {
    const upstream = makeTestUpstream('u1');
    const staticWeight = 100;
    const dynamicWeightConfig = {
      enabled: true,
      initialWeight: 100,
      errorWeightReduction: {
        enabled: true,
        minWeight: 10,
        reductionAmount: 10,
        errorWindowMs: 60000,
      },
    };

    const { recordUpstreamError } = await import('../../src/proxy/stats-collector.js');
    recordUpstreamError(sm, 'route1', upstream.id, 502);
    recordUpstreamError(sm, 'route1', upstream.id, 502);

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    assert.strictEqual(effectiveWeight, 80);
  });

  test('4. Error penalty: does not reduce weight below minWeight', async () => {
    const upstream = makeTestUpstream('u1');
    const staticWeight = 100;
    const dynamicWeightConfig = {
      enabled: true,
      initialWeight: 100,
      errorWeightReduction: {
        enabled: true,
        minWeight: 10,
        reductionAmount: 20,
        errorWindowMs: 60000,
      },
    };

    const { recordUpstreamError } = await import('../../src/proxy/stats-collector.js');
    for (let i = 0; i < 10; i++) {
      recordUpstreamError(sm, 'route1', upstream.id, 502);
    }

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    assert.strictEqual(effectiveWeight, 10);
  });

  test('5. Disabled dynamic weight returns static weight unchanged', () => {
    const upstream = makeTestUpstream('u1');
    const staticWeight = 100;
    const dynamicWeightConfig = {
      enabled: false,
      initialWeight: 100,
    };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    assert.strictEqual(effectiveWeight, 100);
  });

  test('6. Custom static weight is respected', () => {
    const upstream = makeTestUpstream('u1', { weight: 250 });
    const staticWeight = 250;
    const dynamicWeightConfig = {
      enabled: true,
      initialWeight: 100,
    };

    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey: 'route1',
      upstream,
      staticWeight,
      dynamicWeightConfig,
    });

    // Should return custom weight 250, not default 100
    assert.strictEqual(effectiveWeight, 250);
  });
});

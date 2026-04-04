/**
 * Integration tests for proxy weight calculator functionality
 * @module tests/integration/proxy-weight-calculator.test
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
  beforeEach(() => resetAllState());

  test('1. Dynamic weight: returns base weight when no penalties apply', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
    };

    // No errors, no latency penalty
    const metrics = {
      errorCount: 0,
      totalRequests: 10,
      avgDuration: 100,
    };

    const effectiveWeight = calculateEffectiveWeight(
      'route1',
      upstream,
      config,
      metrics,
      100 // base dynamic weight
    );

    // Should return full base weight when no penalties
    assert.strictEqual(effectiveWeight, 100);
  });

  test('2. Error penalty: reduces weight proportionally to error rate', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorPenaltyFactor: 0.5, // 50% penalty per 10% error rate
    };

    // 20% error rate (2 errors out of 10 requests)
    const metrics = {
      errorCount: 2,
      totalRequests: 10,
      avgDuration: 100,
    };

    const effectiveWeight = calculateEffectiveWeight(
      'route1',
      upstream,
      config,
      metrics,
      100 // base dynamic weight
    );

    // Expected: 100 * (1 - (0.2 * 0.5 * 2)) = 100 * (1 - 0.2) = 80
    assert.strictEqual(effectiveWeight, 80);
  });

  test('3. Error penalty: does not reduce weight below minWeight', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorPenaltyFactor: 1.0,
    };

    // 100% error rate
    const metrics = {
      errorCount: 10,
      totalRequests: 10,
      avgDuration: 100,
    };

    const effectiveWeight = calculateEffectiveWeight(
      'route1',
      upstream,
      config,
      metrics,
      100 // base dynamic weight
    );

    // Should not go below minWeight of 10
    assert.strictEqual(effectiveWeight, 10);
  });

  test('4. Latency penalty: reduces weight for upstreams slower than average', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
      latencyPenaltyFactor: 0.3,
    };

    const metrics = {
      errorCount: 0,
      totalRequests: 10,
      avgDuration: 250, // 2.5x of average latency 100ms
    };

    const averageLatency = 100;

    const effectiveWeight = calculateEffectiveWeight(
      'route1',
      upstream,
      config,
      metrics,
      100, // base dynamic weight
      averageLatency
    );

    // Expected: 2.5x exceeds 1.5x threshold → penalty = (2.5 - 1.5) * 0.3 * 100 = 30 → 100 -30 =70
    assert.strictEqual(effectiveWeight, 70);
  });

  test('5. Combined penalties: applies both error and latency penalties', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorPenaltyFactor: 0.5,
      latencyThreshold: 1.5,
      latencyPenaltyFactor: 0.3,
    };

    const metrics = {
      errorCount: 2, // 20% error rate
      totalRequests: 10,
      avgDuration: 250, // 2.5x average latency
    };

    const averageLatency = 100;

    const effectiveWeight = calculateEffectiveWeight(
      'route1',
      upstream,
      config,
      metrics,
      100, // base dynamic weight
      averageLatency
    );

    // Expected: 100 - 20 (error penalty) - 30 (latency penalty) = 50
    assert.strictEqual(effectiveWeight, 50);
  });

  test('6. Disabled weight calculation returns base weight unchanged', () => {
    const upstream = makeTestUpstream('u1');
    const config = {
      enabled: false, // weight calculation disabled
      initialWeight: 100,
      minWeight: 10,
    };

    const metrics = {
      errorCount: 5, // high error rate
      totalRequests: 10,
      avgDuration: 500, // high latency
    };

    const effectiveWeight = calculateEffectiveWeight('route1', upstream, config, metrics, 100);

    // Should return base weight even with bad metrics when disabled
    assert.strictEqual(effectiveWeight, 100);
  });
});

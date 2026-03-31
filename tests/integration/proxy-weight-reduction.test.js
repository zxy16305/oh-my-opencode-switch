/**
 * Integration tests for weight reduction functionality.
 *
 * Verifies:
 * - 429 errors reduce upstream weight correctly
 * - Multiple 429 errors accumulate weight reduction
 * - Error rate calculation is correct
 * - Weight recovery works via setDynamicWeight
 * - Weight doesn't go below minimum
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetRoundRobinCounters,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForError,
  recordUpstreamError,
  getErrorRate,
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
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    enabled: true,
    initialWeight: 100,
    minWeight: 10,
    errorWeightReduction: {
      enabled: true,
      errorCodes: [429, 500, 502, 503, 504],
      reductionAmount: 5,
      minWeight: 5,
      errorWindowMs: 600000,
      ...(overrides.errorWeightReduction || {}),
    },
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Weight Reduction on 429 Errors', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('single 429 error reduces weight by configured reduction amount', () => {
    const upstreams = [makeUpstream({ id: 'rate-limited' }), makeUpstream({ id: 'healthy' })];
    const config = makeConfig();

    // Record 429 error
    recordUpstreamError('test-route', 'rate-limited', 429);

    // Verify error rate is 1
    const errorRate = getErrorRate('test-route', 'rate-limited', 600000);
    assert.strictEqual(errorRate, 1, 'Expected error rate to be 1 after one 429');

    // Adjust weights based on errors
    const errorData = new Map([['rate-limited', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    // Verify weight reduced
    const limitedWeight = getDynamicWeight('test-route', 'rate-limited', 100);
    const healthyWeight = getDynamicWeight('test-route', 'healthy', 100);

    assert.strictEqual(limitedWeight, 95, 'Expected weight to reduce by 5');
    assert.strictEqual(healthyWeight, 100, 'Healthy upstream weight should not change');
  });

  test('multiple 429 errors accumulate weight reduction', () => {
    const upstreams = [makeUpstream({ id: 'persistently-limited' })];
    const config = makeConfig();

    // Record multiple 429 errors
    recordUpstreamError('test-route', 'persistently-limited', 429);
    recordUpstreamError('test-route', 'persistently-limited', 429);
    recordUpstreamError('test-route', 'persistently-limited', 429);

    // Verify error rate
    const errorRate = getErrorRate('test-route', 'persistently-limited', 600000);
    assert.strictEqual(errorRate, 3, 'Expected error rate to be 3 after three 429s');

    // Each error triggers a weight reduction
    const errorData = new Map([['persistently-limited', [429, 429, 429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);
    adjustWeightForError('test-route', upstreams, config, errorData);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const finalWeight = getDynamicWeight('test-route', 'persistently-limited', 100);
    assert.strictEqual(finalWeight, 85, 'Expected 100 - (5 * 3) = 85');
  });

  test('getErrorRate returns correct count for multiple error types', () => {
    recordUpstreamError('test-route', 'mixed-errors', 429);
    recordUpstreamError('test-route', 'mixed-errors', 500);
    recordUpstreamError('test-route', 'mixed-errors', 503);
    recordUpstreamError('test-route', 'mixed-errors', 400); // 400 should be counted in error storage, but not trigger reduction

    const errorRate = getErrorRate('test-route', 'mixed-errors', 600000);
    assert.strictEqual(errorRate, 4, 'Expected all errors to be counted regardless of code');
  });

  test('weight recovery via setDynamicWeight increases weight back up', () => {
    const upstreams = [makeUpstream({ id: 'recovering' })];
    const config = makeConfig();

    // First reduce weight with 429 errors
    recordUpstreamError('test-route', 'recovering', 429);
    const errorData = new Map([['recovering', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const reducedWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(reducedWeight, 95);

    // Simulate weight recovery by increasing weight
    setDynamicWeight('test-route', 'recovering', 98);
    const recoveredWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(recoveredWeight, 98, 'Weight should be updated to 98 by recovery');

    // Full recovery back to initial
    setDynamicWeight('test-route', 'recovering', 100);
    const fullWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(fullWeight, 100, 'Weight should fully recover to 100');
  });

  test('weight does not go below configured minWeight for reduction', () => {
    const upstreams = [makeUpstream({ id: 'failing' })];
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorWeightReduction: {
        enabled: true,
        errorCodes: [429, 500, 502, 503, 504],
        reductionAmount: 20,
        minWeight: 5,
        errorWindowMs: 600000,
      },
    };

    setDynamicWeight('test-route-min', 'failing', 15);
    recordUpstreamError('test-route-min', 'failing', 429);
    const errorData = new Map([['failing', [429]]]);
    adjustWeightForError('test-route-min', upstreams, config, errorData);

    const finalWeight = getDynamicWeight('test-route-min', 'failing', 100);
    assert.strictEqual(finalWeight, 5, 'Weight should be clamped to configured minWeight of 5');
  });

  test('429 errors outside errorWindowMs are not counted', () => {
    // Use a very small window to simulate expiration
    makeConfig({
      errorWeightReduction: {
        enabled: true,
        errorCodes: [429],
        reductionAmount: 5,
        minWeight: 5,
        errorWindowMs: 1, // 1ms window - everything expires immediately
      },
    });

    recordUpstreamError('test-route', 'old-error', 429);

    // Wait for expiration
    return new Promise((resolve) => {
      setTimeout(() => {
        const errorRate = getErrorRate('test-route', 'old-error', 1);
        assert.strictEqual(errorRate, 0, 'Old errors should expire and not be counted');
        resolve();
      }, 10);
    });
  });

  test('multiple upstreams with 429 errors each get weight reduced', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a' }),
      makeUpstream({ id: 'upstream-b' }),
      makeUpstream({ id: 'upstream-c' }),
    ];
    const config = makeConfig();

    // Two upstreams get 429s
    recordUpstreamError('test-route', 'upstream-a', 429);
    recordUpstreamError('test-route', 'upstream-b', 429);

    const errorData = new Map([
      ['upstream-a', [429]],
      ['upstream-b', [429]],
    ]);

    adjustWeightForError('test-route', upstreams, config, errorData);
    adjustWeightForError('test-route', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('test-route', 'upstream-a', 100), 90);
    assert.strictEqual(getDynamicWeight('test-route', 'upstream-b', 100), 90);
    assert.strictEqual(getDynamicWeight('test-route', 'upstream-c', 100), 100);
  });

  test('when errorWeightReduction is disabled, 429 does not reduce weight', () => {
    const upstreams = [makeUpstream({ id: 'no-reduction' })];
    const config = makeConfig({
      errorWeightReduction: {
        enabled: false,
      },
    });

    recordUpstreamError('test-route', 'no-reduction', 429);
    const errorData = new Map([['no-reduction', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const weight = getDynamicWeight('test-route', 'no-reduction', 100);
    assert.strictEqual(weight, 100, 'Weight should not change when error reduction is disabled');
  });
});

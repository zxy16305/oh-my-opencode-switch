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
  resetAllState,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForError,
  recordUpstreamError,
  getErrorRate,
  incrementUpstreamRequestCount,
} from '../../src/proxy/router.js';

import { makeUpstream, makeDynamicWeightConfig as makeConfig } from '../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Weight Reduction on 429 Errors', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('single 429 error applies severe penalty for ≥30% error rate', () => {
    const upstreams = [makeUpstream({ id: 'rate-limited' }), makeUpstream({ id: 'healthy' })];
    const config = makeConfig();

    // Record a request first so error penalty can be applied
    incrementUpstreamRequestCount('test-route', 'rate-limited');
    incrementUpstreamRequestCount('test-route', 'healthy');
    // Record 429 error
    recordUpstreamError('test-route', 'rate-limited', 429);

    // Verify error rate is 1
    const errorRate = getErrorRate('test-route', 'rate-limited', 3600000);
    assert.strictEqual(errorRate, 1, 'Expected error rate to be 1 after one 429');

    // Adjust weights based on errors
    const errorData = new Map([['rate-limited', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    // Verify weight reduced: 1 error / 1 request = 100% ≥30% → 100 * 0.1 = 10
    const limitedWeight = getDynamicWeight('test-route', 'rate-limited', 100);
    const healthyWeight = getDynamicWeight('test-route', 'healthy', 100);

    assert.strictEqual(limitedWeight, 10, 'Expected weight to reduce to 10 for 100% error rate');
    assert.strictEqual(healthyWeight, 100, 'Healthy upstream weight should not change');
  });

  test('high error rate applies severe penalty', () => {
    const upstreams = [makeUpstream({ id: 'persistently-limited' })];
    const config = makeConfig();

    // Record 3 requests, 3 errors = 100% error rate
    for (let i = 0; i < 3; i++) {
      incrementUpstreamRequestCount('test-route', 'persistently-limited');
      recordUpstreamError('test-route', 'persistently-limited', 429);
    }

    // Verify error rate
    const errorRate = getErrorRate('test-route', 'persistently-limited', 3600000);
    assert.strictEqual(errorRate, 3, 'Expected error rate to be 3 after three 429s');

    // Apply weight adjustment
    const errorData = new Map([['persistently-limited', [429, 429, 429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const finalWeight = getDynamicWeight('test-route', 'persistently-limited', 100);
    assert.strictEqual(finalWeight, 10, 'Expected weight to reduce to 10 for 100% error rate');
  });

  test('getErrorRate returns correct count for multiple error types', () => {
    recordUpstreamError('test-route', 'mixed-errors', 429);
    recordUpstreamError('test-route', 'mixed-errors', 500);
    recordUpstreamError('test-route', 'mixed-errors', 503);
    recordUpstreamError('test-route', 'mixed-errors', 400); // 400 should be counted in error storage, but not trigger reduction

    const errorRate = getErrorRate('test-route', 'mixed-errors', 3600000);
    assert.strictEqual(errorRate, 4, 'Expected all errors to be counted regardless of code');
  });

  test('weight recovery via setDynamicWeight increases weight back up', () => {
    const upstreams = [makeUpstream({ id: 'recovering' })];
    const config = makeConfig();

    // First reduce weight with 429 errors
    incrementUpstreamRequestCount('test-route', 'recovering');
    recordUpstreamError('test-route', 'recovering', 429);
    const errorData = new Map([['recovering', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const reducedWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(reducedWeight, 10, 'Weight should be reduced to 10');

    // Simulate weight recovery by increasing weight
    setDynamicWeight('test-route', 'recovering', 50);
    const recoveredWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(recoveredWeight, 50, 'Weight should be updated to 50 by recovery');

    // Full recovery back to initial
    setDynamicWeight('test-route', 'recovering', 100);
    const fullWeight = getDynamicWeight('test-route', 'recovering', 100);
    assert.strictEqual(fullWeight, 100, 'Weight should fully recover to 100');
  });

  test('weight does not go below minimum floor of 10', () => {
    const upstreams = [makeUpstream({ id: 'failing', weight: 50 })];
    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorWeightReduction: {
        enabled: true,
        errorCodes: [429, 500, 502, 503, 504],
        errorWindowMs: 3600000,
      },
    };

    incrementUpstreamRequestCount('test-route-min', 'failing');
    recordUpstreamError('test-route-min', 'failing', 429);
    const errorData = new Map([['failing', [429]]]);
    adjustWeightForError('test-route-min', upstreams, config, errorData);

    const finalWeight = getDynamicWeight('test-route-min', 'failing', 50);
    assert.strictEqual(finalWeight, 10, 'Weight should be clamped to minimum floor of 10');
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
    incrementUpstreamRequestCount('test-route', 'upstream-a');
    incrementUpstreamRequestCount('test-route', 'upstream-b');
    incrementUpstreamRequestCount('test-route', 'upstream-c');
    recordUpstreamError('test-route', 'upstream-a', 429);
    recordUpstreamError('test-route', 'upstream-b', 429);

    const errorData = new Map([
      ['upstream-a', [429]],
      ['upstream-b', [429]],
    ]);

    adjustWeightForError('test-route', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('test-route', 'upstream-a', 100), 10);
    assert.strictEqual(getDynamicWeight('test-route', 'upstream-b', 100), 10);
    assert.strictEqual(getDynamicWeight('test-route', 'upstream-c', 100), 100);
  });

  test('error rate between 10% and 30% applies moderate penalty', () => {
    const upstreams = [makeUpstream({ id: 'moderate-errors' })];
    const config = makeConfig();

    // 2 errors out of 10 requests = 20% error rate (between 10% and 30%)
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('test-route', 'moderate-errors');
    }
    recordUpstreamError('test-route', 'moderate-errors', 429);
    recordUpstreamError('test-route', 'moderate-errors', 500);

    const errorData = new Map([['moderate-errors', [429, 500]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const weight = getDynamicWeight('test-route', 'moderate-errors', 100);
    assert.strictEqual(weight, 50, '20% error rate should reduce weight to 50% of original');
  });

  test('error rate below 10% does not reduce weight', () => {
    const upstreams = [makeUpstream({ id: 'low-errors' })];
    const config = makeConfig();

    // 1 error out of 20 requests = 5% error rate (below 10%)
    for (let i = 0; i < 20; i++) {
      incrementUpstreamRequestCount('test-route', 'low-errors');
    }
    recordUpstreamError('test-route', 'low-errors', 429);

    const errorData = new Map([['low-errors', [429]]]);
    adjustWeightForError('test-route', upstreams, config, errorData);

    const weight = getDynamicWeight('test-route', 'low-errors', 100);
    assert.strictEqual(weight, 100, '5% error rate should not reduce weight');
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

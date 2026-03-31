/**
 * Unit tests for error-based weight adjustment functionality in proxy/router module
 * @module tests/proxy/unit/router-dynamic-weight-error.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetRoundRobinCounters,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForError,
} from '../../../src/proxy/router.js';

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

// ===========================================================================
// Tests
// ===========================================================================

describe('Dynamic Weight – adjustWeightForError', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('Single error reduces weight for the failed upstream', () => {
    const upstreams = [makeUpstream({ id: 'good' }), makeUpstream({ id: 'failed' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500, 502, 503, 504],
    };

    // Error on 'failed' with 500 status code
    adjustWeightForError('route1', upstreams, config, 'failed', 500);

    const goodWeight = getDynamicWeight('route1', 'good', 100);
    const failedWeight = getDynamicWeight('route1', 'failed', 100);

    assert.strictEqual(goodWeight, 100); // unchanged
    assert.strictEqual(failedWeight, 95); // reduced by errorReduction (5)
  });

  test('Multiple consecutive errors reduce weight more', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500, 502, 503, 504],
    };

    // Three consecutive errors
    adjustWeightForError('route1', upstreams, config, 'failed', 500);
    adjustWeightForError('route1', upstreams, config, 'failed', 500);
    adjustWeightForError('route1', upstreams, config, 'failed', 500);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 85); // 100 - (5 * 3) = 85
  });

  test('Weight does not go below minWeight', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 20,
      errorCodes: [500, 502, 503, 504],
    };

    // Multiple large reductions that would go below minWeight
    setDynamicWeight('route1', 'failed', 15);

    adjustWeightForError('route1', upstreams, config, 'failed', 500);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 10); // clamped to minWeight
  });

  test('No errors means no weight change', () => {
    const upstreams = [makeUpstream({ id: 'u1' }), makeUpstream({ id: 'u2' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500, 502, 503, 504],
    };

    // Don't call adjustWeightForError for any errors

    const u1Weight = getDynamicWeight('route1', 'u1', 100);
    const u2Weight = getDynamicWeight('route1', 'u2', 100);

    assert.strictEqual(u1Weight, 100);
    assert.strictEqual(u2Weight, 100);
  });

  test("Error codes outside errorCodes list don't trigger reduction", () => {
    const upstreams = [makeUpstream({ id: 'client-error' }), makeUpstream({ id: 'success' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500, 502, 503, 504],
    };

    // 400 is client error, not in the list
    adjustWeightForError('route1', upstreams, config, 'client-error', 400);

    const errorWeight = getDynamicWeight('route1', 'client-error', 100);
    assert.strictEqual(errorWeight, 100); // unchanged
  });

  test('skips adjustment when disabled', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];

    const config = {
      enabled: false,
      initialWeight: 100,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500, 502, 503, 504],
    };

    adjustWeightForError('route1', upstreams, config, 'failed', 500);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 100); // unchanged when disabled
  });

  test('skips adjustment for null upstreams', () => {
    const config = {
      enabled: true,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500],
    };

    // Should not throw
    adjustWeightForError('route1', null, config, 'failed', 500);
  });

  test('skips adjustment for empty upstreams array', () => {
    const config = {
      enabled: true,
      minWeight: 10,
      errorReduction: 5,
      errorCodes: [500],
    };

    // Should not throw
    adjustWeightForError('route1', [], config, 'failed', 500);
  });
});

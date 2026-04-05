/**
 * Unit tests for error-based weight adjustment functionality in proxy/router module
 * @module tests/proxy/unit/router-dynamic-weight-error.test
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
} from '../../../src/proxy/router.js';

import {
  makeUpstream,
  makeDynamicWeightConfig as makeConfig,
} from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Dynamic Weight – adjustWeightForError', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('Single error with 10% error rate halves weight', () => {
    const upstreams = [makeUpstream({ id: 'good' }), makeUpstream({ id: 'failed' })];
    const config = makeConfig();

    // Simulate 9 successful requests + 1 error = 10% error rate
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'failed');
    }
    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const goodWeight = getDynamicWeight('route1', 'good', 100);
    const failedWeight = getDynamicWeight('route1', 'failed', 100);

    assert.strictEqual(goodWeight, 100);
    assert.strictEqual(failedWeight, 50);
  });

  test('Error rate >=30% reduces weight to 10% of original', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];
    const config = makeConfig();

    // Simulate 7 successful requests + 3 errors = 30% error rate
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'failed');
    }
    recordUpstreamError('route1', 'failed', 500);
    recordUpstreamError('route1', 'failed', 500);
    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500, 500, 500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 10);
  });

  test('Weight does not go below minWeight floor of 10', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];
    const config = makeConfig();

    setDynamicWeight('route1', 'failed', 15);

    // 100% error rate: 10 errors, 10 requests
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'failed');
      recordUpstreamError('route1', 'failed', 500);
    }

    const errorData = new Map([['failed', Array(10).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 10);
  });

  test('No errors means no weight change', () => {
    const u1Weight = getDynamicWeight('route1', 'u1', 100);
    const u2Weight = getDynamicWeight('route1', 'u2', 100);

    assert.strictEqual(u1Weight, 100);
    assert.strictEqual(u2Weight, 100);
  });

  test("Error codes outside errorCodes list don't trigger reduction", () => {
    const upstreams = [makeUpstream({ id: 'client-error' }), makeUpstream({ id: 'success' })];
    const config = makeConfig();

    recordUpstreamError('route1', 'client-error', 400);

    const errorData = new Map([['client-error', [400]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const errorWeight = getDynamicWeight('route1', 'client-error', 100);
    assert.strictEqual(errorWeight, 100);
  });

  test('skips adjustment when disabled', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];
    const config = makeConfig({ errorWeightReduction: { enabled: false } });

    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 100);
  });

  test('skips adjustment for null upstreams', () => {
    const config = makeConfig();
    const errorData = new Map([['failed', [500]]]);

    assert.doesNotThrow(() => {
      adjustWeightForError('route1', null, config, errorData);
    });
  });

  test('skips adjustment for empty upstreams array', () => {
    const config = makeConfig();
    const errorData = new Map([['failed', [500]]]);

    assert.doesNotThrow(() => {
      adjustWeightForError('route1', [], config, errorData);
    });
  });

  test('skips adjustment for null errorData', () => {
    const upstreams = [makeUpstream({ id: 'u1' })];
    const config = makeConfig();

    assert.doesNotThrow(() => {
      adjustWeightForError('route1', upstreams, config, null);
    });

    assert.strictEqual(getDynamicWeight('route1', 'u1', 100), 100);
  });

  test('skips adjustment for empty errorData', () => {
    const upstreams = [makeUpstream({ id: 'u1' })];
    const config = makeConfig();

    assert.doesNotThrow(() => {
      adjustWeightForError('route1', upstreams, config, new Map());
    });

    assert.strictEqual(getDynamicWeight('route1', 'u1', 100), 100);
  });

  test('skips when config has no errorWeightReduction', () => {
    const upstreams = [makeUpstream({ id: 'u1' })];
    const config = { enabled: true, initialWeight: 100, minWeight: 10 };
    const errorData = new Map([['u1', [500]]]);

    assert.doesNotThrow(() => {
      adjustWeightForError('route1', upstreams, config, errorData);
    });

    assert.strictEqual(getDynamicWeight('route1', 'u1', 100), 100);
  });

  test('429 status code triggers reduction', () => {
    const upstreams = [makeUpstream({ id: 'rate-limited' })];
    const config = makeConfig();

    // 1 error out of 10 requests = 10% error rate
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'rate-limited');
    }
    recordUpstreamError('route1', 'rate-limited', 429);

    const errorData = new Map([['rate-limited', [429]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'rate-limited', 100);
    assert.strictEqual(weight, 50);
  });

  test('multiple error codes in one call reduce weight once', () => {
    const upstreams = [makeUpstream({ id: 'multi-error' })];
    const config = makeConfig();

    // 3 errors out of 10 requests = 30% error rate
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'multi-error');
    }
    recordUpstreamError('route1', 'multi-error', 500);
    recordUpstreamError('route1', 'multi-error', 502);
    recordUpstreamError('route1', 'multi-error', 503);
    const errorData = new Map([['multi-error', [500, 502, 503]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'multi-error', 100);
    assert.strictEqual(weight, 10);
  });

  test('reduces multiple upstreams with errors in one call', () => {
    const upstreams = [makeUpstream({ id: 'u1' }), makeUpstream({ id: 'u2' })];
    const config = makeConfig();

    // Each upstream: 1 error out of 10 requests = 10% error rate
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount('route1', 'u1');
      incrementUpstreamRequestCount('route1', 'u2');
    }
    recordUpstreamError('route1', 'u1', 500);
    recordUpstreamError('route1', 'u2', 502);
    const errorData = new Map([
      ['u1', [500]],
      ['u2', [502]],
    ]);
    adjustWeightForError('route1', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('route1', 'u1', 100), 50);
    assert.strictEqual(getDynamicWeight('route1', 'u2', 100), 50);
  });

  test('9% error rate - no penalty applied', () => {
    const upstreams = [makeUpstream({ id: 'test' })];
    const config = makeConfig();

    // 9 errors out of 100 requests = 9% error rate
    for (let i = 0; i < 100; i++) {
      incrementUpstreamRequestCount('route1', 'test');
    }
    for (let i = 0; i < 9; i++) {
      recordUpstreamError('route1', 'test', 500);
    }
    const errorData = new Map([['test', Array(9).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'test', 100);
    assert.strictEqual(weight, 100);
  });

  test('10% error rate - weight halved', () => {
    const upstreams = [makeUpstream({ id: 'test' })];
    const config = makeConfig();

    // 10 errors out of 100 requests = 10% error rate
    for (let i = 0; i < 100; i++) {
      incrementUpstreamRequestCount('route1', 'test');
    }
    for (let i = 0; i < 10; i++) {
      recordUpstreamError('route1', 'test', 500);
    }
    const errorData = new Map([['test', Array(10).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'test', 100);
    assert.strictEqual(weight, 50);
  });

  test('29% error rate - weight halved', () => {
    const upstreams = [makeUpstream({ id: 'test' })];
    const config = makeConfig();

    // 29 errors out of 100 requests = 29% error rate
    for (let i = 0; i < 100; i++) {
      incrementUpstreamRequestCount('route1', 'test');
    }
    for (let i = 0; i < 29; i++) {
      recordUpstreamError('route1', 'test', 500);
    }
    const errorData = new Map([['test', Array(29).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'test', 100);
    assert.strictEqual(weight, 50);
  });

  test('30% error rate - weight reduced to 10% of original', () => {
    const upstreams = [makeUpstream({ id: 'test' })];
    const config = makeConfig();

    // 30 errors out of 100 requests = 30% error rate
    for (let i = 0; i < 100; i++) {
      incrementUpstreamRequestCount('route1', 'test');
    }
    for (let i = 0; i < 30; i++) {
      recordUpstreamError('route1', 'test', 500);
    }
    const errorData = new Map([['test', Array(30).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'test', 100);
    assert.strictEqual(weight, 10);
  });

  test('100% error rate - weight stays at minimum floor of 10', () => {
    const upstreams = [makeUpstream({ id: 'test' })];
    const config = makeConfig();

    // 100 errors out of 100 requests = 100% error rate
    for (let i = 0; i < 100; i++) {
      incrementUpstreamRequestCount('route1', 'test');
    }
    for (let i = 0; i < 100; i++) {
      recordUpstreamError('route1', 'test', 500);
    }
    const errorData = new Map([['test', Array(100).fill(500)]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'test', 100);
    assert.strictEqual(weight, 10);
  });
});

describe('Dynamic Weight – recordUpstreamError and getErrorRate', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('recordUpstreamError records an error', () => {
    recordUpstreamError('route1', 'upstream1', 500);
    const rate = getErrorRate('route1', 'upstream1', 3600000);
    assert.strictEqual(rate, 1);
  });

  test('getErrorRate returns 0 for no errors', () => {
    const rate = getErrorRate('route1', 'upstream1', 3600000);
    assert.strictEqual(rate, 0);
  });

  test('getErrorRate accepts config object with errorWindowMs', () => {
    recordUpstreamError('route1', 'upstream1', 500);

    const config = {
      errorWeightReduction: { errorWindowMs: 3600000 },
    };

    const rate = getErrorRate('route1', 'upstream1', config);
    assert.strictEqual(rate, 1);
  });

  test('getErrorRate defaults to 3600000ms when config has no errorWindowMs', () => {
    recordUpstreamError('route1', 'upstream1', 500);

    const rate = getErrorRate('route1', 'upstream1', {});
    assert.strictEqual(rate, 1);
  });

  test('multiple errors are counted', () => {
    recordUpstreamError('route1', 'upstream1', 500);
    recordUpstreamError('route1', 'upstream1', 502);
    recordUpstreamError('route1', 'upstream1', 503);

    const rate = getErrorRate('route1', 'upstream1', 3600000);
    assert.strictEqual(rate, 3);
  });
});

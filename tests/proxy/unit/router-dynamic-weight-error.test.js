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
  recordUpstreamError,
  getErrorRate,
} from '../../../src/proxy/router.js';

import {
  makeUpstream,
  makeDynamicWeightConfig as makeConfig,
} from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Dynamic Weight – adjustWeightForError', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('Single error reduces weight for the failed upstream', () => {
    const upstreams = [makeUpstream({ id: 'good' }), makeUpstream({ id: 'failed' })];
    const config = makeConfig();

    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const goodWeight = getDynamicWeight('route1', 'good', 100);
    const failedWeight = getDynamicWeight('route1', 'failed', 100);

    assert.strictEqual(goodWeight, 100);
    assert.strictEqual(failedWeight, 95);
  });

  test('Multiple consecutive errors reduce weight more', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];
    const config = makeConfig();

    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);
    adjustWeightForError('route1', upstreams, config, errorData);
    adjustWeightForError('route1', upstreams, config, errorData);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 85);
  });

  test('Weight does not go below minWeight', () => {
    const upstreams = [makeUpstream({ id: 'failed' })];
    const config = makeConfig({ errorWeightReduction: { reductionAmount: 20 } });

    setDynamicWeight('route1', 'failed', 15);

    recordUpstreamError('route1', 'failed', 500);

    const errorData = new Map([['failed', [500]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const failedWeight = getDynamicWeight('route1', 'failed', 100);
    assert.strictEqual(failedWeight, 5);
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

    recordUpstreamError('route1', 'rate-limited', 429);

    const errorData = new Map([['rate-limited', [429]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'rate-limited', 100);
    assert.strictEqual(weight, 95);
  });

  test('multiple error codes in one call reduce weight once', () => {
    const upstreams = [makeUpstream({ id: 'multi-error' })];
    const config = makeConfig();

    const errorData = new Map([['multi-error', [500, 502, 503]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const weight = getDynamicWeight('route1', 'multi-error', 100);
    assert.strictEqual(weight, 95);
  });

  test('reduces multiple upstreams with errors in one call', () => {
    const upstreams = [makeUpstream({ id: 'u1' }), makeUpstream({ id: 'u2' })];
    const config = makeConfig();

    const errorData = new Map([
      ['u1', [500]],
      ['u2', [502]],
    ]);
    adjustWeightForError('route1', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('route1', 'u1', 100), 95);
    assert.strictEqual(getDynamicWeight('route1', 'u2', 100), 95);
  });
});

describe('Dynamic Weight – recordUpstreamError and getErrorRate', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

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

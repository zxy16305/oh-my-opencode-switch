import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStateManager } from '../../src/proxy/state-manager.js';
import { startWeightCheck, stopWeightCheck } from '../../src/proxy/weight-manager.js';
import {
  recordUpstreamError,
  incrementUpstreamRequestCount,
} from '../../src/proxy/stats-collector.js';
import { getDynamicWeight } from '../../src/proxy/router.js';

describe('weight-check', () => {
  let state;
  const testRouteKey = 'test-route';
  const testUpstreams = [
    { id: 'upstream1', weight: 100 },
    { id: 'upstream2', weight: 100 },
  ];
  const testConfig = {
    enabled: true,
    checkInterval: 0.01, // 10ms for fast test
    errorWeightReduction: {
      enabled: true,
      errorCodes: [500, 502, 503, 504],
      reductionAmount: 10,
      minWeight: 10,
      errorWindowMs: 3600000,
    },
  };

  before(() => {
    state = createStateManager();
  });

  after(() => {
    state.reset();
  });

  it('should create and return a timer when startWeightCheck is called', () => {
    const timer = startWeightCheck(state, testRouteKey, testUpstreams, testConfig);
    assert.ok(timer, 'should return a timer instance');
    assert.strictEqual(typeof timer, 'object');
    assert.strictEqual(typeof timer.unref, 'function');

    stopWeightCheck(state, testRouteKey);
    clearInterval(timer);
  });

  it('should return null for invalid parameters', () => {
    assert.strictEqual(startWeightCheck(null, testRouteKey, testUpstreams, testConfig), null);
    assert.strictEqual(startWeightCheck(state, '', testUpstreams, testConfig), null);
    assert.strictEqual(startWeightCheck(state, testRouteKey, [], testConfig), null);
    assert.strictEqual(startWeightCheck(state, testRouteKey, testUpstreams, null), null);
    assert.strictEqual(
      startWeightCheck(state, testRouteKey, testUpstreams, { enabled: false }),
      null
    );
    assert.strictEqual(
      startWeightCheck(state, testRouteKey, testUpstreams, { enabled: true, checkInterval: 0 }),
      null
    );
  });

  it('should automatically stop existing timer when startWeightCheck is called twice', () => {
    const timer1 = startWeightCheck(state, testRouteKey, testUpstreams, testConfig);
    assert.ok(timer1);

    const timer2 = startWeightCheck(state, testRouteKey, testUpstreams, testConfig);
    assert.ok(timer2);
    assert.notStrictEqual(timer1, timer2, 'should create a new timer');

    stopWeightCheck(state, testRouteKey);
    clearInterval(timer1);
    clearInterval(timer2);
  });

  it('should adjust weights for upstreams with errors', async () => {
    // Initialize weights
    getDynamicWeight(testRouteKey, 'upstream1', 100, state);
    getDynamicWeight(testRouteKey, 'upstream2', 100, state);

    // Record 10 requests and 10 errors for upstream1 (100% error rate)
    for (let i = 0; i < 10; i++) {
      incrementUpstreamRequestCount(state, testRouteKey, 'upstream1');
      recordUpstreamError(state, testRouteKey, 'upstream1', 500);
    }

    // Start check
    const timer = startWeightCheck(state, testRouteKey, testUpstreams, testConfig);

    // Wait for 2 intervals
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Check weight is reduced
    const weight1 = getDynamicWeight(testRouteKey, 'upstream1', 100, state);
    const weight2 = getDynamicWeight(testRouteKey, 'upstream2', 100, state);

    assert.strictEqual(weight1, 10, 'error upstream weight should be reduced to 10%');
    assert.strictEqual(weight2, 100, 'healthy upstream weight should remain 100');

    stopWeightCheck(state, testRouteKey);
    clearInterval(timer);
  });

  it('should handle timer errors gracefully without crashing', () => {
    // Test with invalid state to trigger error
    const invalidState = {
      getErrorState: () => {
        throw new Error('Test error');
      },
      addCheckTimer: () => {},
      removeCheckTimer: () => {},
    };

    // This should not throw
    const timer = startWeightCheck(invalidState, testRouteKey, testUpstreams, testConfig);
    assert.ok(timer);

    // Let interval run once
    return new Promise((resolve) => {
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 20);
    });
  });

  it('stopWeightCheck should clear the timer', () => {
    const timer = startWeightCheck(state, testRouteKey, testUpstreams, testConfig);
    assert.ok(timer);

    stopWeightCheck(state, testRouteKey);

    // Check timer is removed from state
    assert.strictEqual(state.getCheckTimers().size, 0);
  });
});

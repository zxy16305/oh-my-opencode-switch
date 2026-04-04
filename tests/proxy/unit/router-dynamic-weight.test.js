/**
 * Unit tests for dynamic weight functionality in proxy/router module
 * @module tests/proxy/unit/router-dynamic-weight.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetAllState,
  getDynamicWeightState,
  getRecoveryTimers,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForLatency,
  startWeightRecovery,
  stopWeightRecovery,
  selectUpstreamSticky,
  routeSchema,
} from '../../../src/proxy/router.js';

import { makeUpstream } from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Dynamic Weight – State Management', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('getDynamicWeight returns initial weight for new upstream', () => {
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 100);
  });

  test('setDynamicWeight updates weight', () => {
    setDynamicWeight('route1', 'upstream1', 50);
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 50);
  });

  test('setDynamicWeight creates entry if not exists', () => {
    setDynamicWeight('route-new', 'upstream-new', 75);
    const weight = getDynamicWeight('route-new', 'upstream-new', 100);
    assert.strictEqual(weight, 75);
  });

  test('getDynamicWeightState returns the state map', () => {
    getDynamicWeight('route1', 'upstream1', 100);
    const state = getDynamicWeightState();
    assert.ok(state.has('route1:upstream1'));
  });

  test('getDynamicWeightState is empty after reset', () => {
    getDynamicWeight('route1', 'upstream1', 100);
    resetAllState();
    const state = getDynamicWeightState();
    assert.strictEqual(state.size, 0);
  });

  test('getDynamicWeight uses default initialWeight of 100', () => {
    const weight = getDynamicWeight('route1', 'upstream1');
    assert.strictEqual(weight, 100);
  });

  test('getDynamicWeight returns updated weight after set', () => {
    getDynamicWeight('route1', 'upstream1', 100);
    setDynamicWeight('route1', 'upstream1', 42);
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 42);
  });
});

describe('Dynamic Weight – adjustWeightForLatency', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('decreases weight for high latency upstream', () => {
    const upstreams = [makeUpstream({ id: 'fast' }), makeUpstream({ id: 'slow' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      ['slow', { avgDuration: 200 }], // 2x of fast, exceeds 1.5x threshold
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    const fastWeight = getDynamicWeight('route1', 'fast', 100);
    const slowWeight = getDynamicWeight('route1', 'slow', 100);

    assert.strictEqual(fastWeight, 100); // unchanged
    assert.strictEqual(slowWeight, 99); // decreased by 1
  });

  test('does not decrease weight below minWeight', () => {
    setDynamicWeight('route1', 'slow', 10); // already at min

    const upstreams = [makeUpstream({ id: 'fast' }), makeUpstream({ id: 'slow' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      ['slow', { avgDuration: 200 }],
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    const slowWeight = getDynamicWeight('route1', 'slow', 100);
    assert.strictEqual(slowWeight, 10); // stays at min
  });

  test('skips adjustment when only one upstream', () => {
    const upstreams = [makeUpstream({ id: 'only' })];
    const config = { enabled: true, minWeight: 10, latencyThreshold: 1.5 };
    const latencyData = new Map([['only', { avgDuration: 100 }]]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    const weight = getDynamicWeight('route1', 'only', 100);
    assert.strictEqual(weight, 100); // unchanged
  });

  test('skips adjustment when no latency data', () => {
    const upstreams = [makeUpstream({ id: 'a' }), makeUpstream({ id: 'b' })];
    const config = { enabled: true, minWeight: 10, latencyThreshold: 1.5 };
    const latencyData = new Map(); // empty

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    assert.strictEqual(getDynamicWeight('route1', 'a', 100), 100);
    assert.strictEqual(getDynamicWeight('route1', 'b', 100), 100);
  });

  test('skips upstream with missing latency data', () => {
    const upstreams = [makeUpstream({ id: 'fast' }), makeUpstream({ id: 'no-data' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      // 'no-data' has no entry
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    assert.strictEqual(getDynamicWeight('route1', 'fast', 100), 100);
    assert.strictEqual(getDynamicWeight('route1', 'no-data', 100), 100);
  });

  test('skips upstream with zero avgDuration', () => {
    const upstreams = [makeUpstream({ id: 'fast' }), makeUpstream({ id: 'zero-dur' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      ['zero-dur', { avgDuration: 0 }], // falsy, should be skipped
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    assert.strictEqual(getDynamicWeight('route1', 'zero-dur', 100), 100);
  });

  test('decreases multiple slow upstreams', () => {
    const upstreams = [
      makeUpstream({ id: 'fast' }),
      makeUpstream({ id: 'medium' }),
      makeUpstream({ id: 'slow' }),
    ];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      ['medium', { avgDuration: 200 }],
      ['slow', { avgDuration: 300 }],
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    assert.strictEqual(getDynamicWeight('route1', 'fast', 100), 100);
    assert.strictEqual(getDynamicWeight('route1', 'medium', 100), 99);
    assert.strictEqual(getDynamicWeight('route1', 'slow', 100), 99);
  });

  test('skips adjustment for null upstreams', () => {
    const config = { enabled: true, minWeight: 10, latencyThreshold: 1.5 };
    const latencyData = new Map();

    // Should not throw
    adjustWeightForLatency('route1', null, config, latencyData);
  });

  test('skips adjustment for empty upstreams array', () => {
    const config = { enabled: true, minWeight: 10, latencyThreshold: 1.5 };
    const latencyData = new Map();

    // Should not throw
    adjustWeightForLatency('route1', [], config, latencyData);
  });
});

describe('Dynamic Weight – Recovery', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('startWeightRecovery returns null for invalid parameters', () => {
    const result = startWeightRecovery(null, [], {});
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery returns null for empty upstreams', () => {
    const result = startWeightRecovery('route1', [], { enabled: true, recoveryInterval: 1000 });
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery returns null when disabled', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const result = startWeightRecovery('route1', upstreams, {
      enabled: false,
      recoveryInterval: 1000,
    });
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery returns null when recoveryInterval is zero', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const result = startWeightRecovery('route1', upstreams, { enabled: true, recoveryInterval: 0 });
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery returns null when recoveryInterval is negative', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const result = startWeightRecovery('route1', upstreams, {
      enabled: true,
      recoveryInterval: -100,
    });
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery starts timer and stores in recoveryTimers', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = {
      enabled: true,
      recoveryInterval: 1000,
      recoveryAmount: 1,
      initialWeight: 100,
    };

    setDynamicWeight('route1', 'a', 50);

    const timer = startWeightRecovery('route1', upstreams, config);
    assert.ok(timer !== null);

    const timers = getRecoveryTimers();
    assert.ok(timers.has('route1'));

    stopWeightRecovery('route1');
    assert.ok(!timers.has('route1'));
  });

  test('stopWeightRecovery is safe when no timer exists', () => {
    // Should not throw
    stopWeightRecovery('nonexistent-route');
    assert.strictEqual(getRecoveryTimers().has('nonexistent-route'), false);
  });

  test('startWeightRecovery replaces existing timer for same route', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = {
      enabled: true,
      recoveryInterval: 5000,
      recoveryAmount: 1,
      initialWeight: 100,
    };

    const timer1 = startWeightRecovery('route1', upstreams, config);
    const timer2 = startWeightRecovery('route1', upstreams, config);

    assert.notStrictEqual(timer1, timer2);

    const timers = getRecoveryTimers();
    assert.strictEqual(timers.size, 1); // only one entry for route1

    stopWeightRecovery('route1');
  });

  test('weight recovery restores weight towards initialWeight', (t, done) => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = {
      enabled: true,
      recoveryInterval: 50, // fast for testing
      recoveryAmount: 5,
      initialWeight: 100,
    };

    setDynamicWeight('route1', 'a', 80);

    startWeightRecovery('route1', upstreams, config);

    // Wait for at least one recovery cycle
    setTimeout(() => {
      const weight = getDynamicWeight('route1', 'a', 100);
      assert.ok(weight > 80, `Expected weight > 80, got ${weight}`);
      assert.ok(weight <= 100, `Expected weight <= 100, got ${weight}`);

      stopWeightRecovery('route1');
      done();
    }, 120);
  });

  test('weight recovery does not exceed initialWeight', (t, done) => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = {
      enabled: true,
      recoveryInterval: 50,
      recoveryAmount: 50, // large recovery amount
      initialWeight: 100,
    };

    setDynamicWeight('route1', 'a', 90);

    startWeightRecovery('route1', upstreams, config);

    setTimeout(() => {
      const weight = getDynamicWeight('route1', 'a', 100);
      assert.strictEqual(weight, 100, `Weight should not exceed initialWeight`);

      stopWeightRecovery('route1');
      done();
    }, 120);
  });

  test('startWeightRecovery returns null for null routeKey', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = { enabled: true, recoveryInterval: 1000 };
    const result = startWeightRecovery(null, upstreams, config);
    assert.strictEqual(result, null);
  });

  test('startWeightRecovery returns null for null config', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const result = startWeightRecovery('route1', upstreams, null);
    assert.strictEqual(result, null);
  });

  test('resetAllState clears all recovery timers', () => {
    const upstreams = [makeUpstream({ id: 'a' })];
    const config = {
      enabled: true,
      recoveryInterval: 60000,
      recoveryAmount: 1,
      initialWeight: 100,
    };

    startWeightRecovery('route1', upstreams, config);
    startWeightRecovery('route2', upstreams, config);

    assert.strictEqual(getRecoveryTimers().size, 2);

    resetAllState();

    assert.strictEqual(getRecoveryTimers().size, 0);
  });
});

describe('Dynamic Weight – Integration with selectUpstreamSticky', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('dynamic weight affects upstream selection', () => {
    const upstreams = [makeUpstream({ id: 'heavy' }), makeUpstream({ id: 'light' })];

    // Give heavy upstream a low dynamic weight
    setDynamicWeight('route1', 'heavy', 1);
    setDynamicWeight('route1', 'light', 100);

    const config = { enabled: true, initialWeight: 100 };

    // With dynamic weight, light should be preferred for new sessions
    const results = [];
    for (let i = 0; i < 10; i++) {
      const selected = selectUpstreamSticky(
        upstreams,
        'route1',
        `session-${i}`,
        null,
        0,
        2,
        config
      );
      results.push(selected.id);
    }

    const lightCount = results.filter((id) => id === 'light').length;
    assert.ok(lightCount >= 5, `Expected light to be selected more, got ${lightCount}/10`);
  });

  test('latency adjustment affects sticky selection over time', () => {
    const upstreams = [makeUpstream({ id: 'fast' }), makeUpstream({ id: 'slow' })];

    const config = {
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      checkInterval: 1,
      latencyThreshold: 1.5,
    };

    const latencyData = new Map([
      ['fast', { avgDuration: 100 }],
      ['slow', { avgDuration: 300 }],
    ]);

    adjustWeightForLatency('route1', upstreams, config, latencyData);

    const slowWeight = getDynamicWeight('route1', 'slow', 100);
    assert.ok(slowWeight < 100, `Expected slow weight < 100, got ${slowWeight}`);
  });
});

describe('Dynamic Weight – Schema', () => {
  test('routeSchema includes dynamicWeight with defaults', () => {
    const result = routeSchema.safeParse({
      strategy: 'sticky',
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://example.com' }],
    });

    assert.ok(result.success);
    assert.ok(result.data.dynamicWeight);
    assert.strictEqual(result.data.dynamicWeight.enabled, true);
    assert.strictEqual(result.data.dynamicWeight.initialWeight, 100);
  });

  test('routeSchema accepts custom dynamicWeight config', () => {
    const result = routeSchema.safeParse({
      strategy: 'sticky',
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://example.com' }],
      dynamicWeight: {
        enabled: false,
        initialWeight: 50,
        minWeight: 5,
      },
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.enabled, false);
    assert.strictEqual(result.data.dynamicWeight.initialWeight, 50);
    assert.strictEqual(result.data.dynamicWeight.minWeight, 5);
  });

  test('routeSchema dynamicWeight defaults minWeight to 10', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.minWeight, 10);
  });

  test('routeSchema dynamicWeight defaults latencyThreshold to 1.5', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.latencyThreshold, 1.5);
  });

  test('routeSchema dynamicWeight defaults recoveryInterval to 300000', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.recoveryInterval, 300000);
  });

  test('routeSchema dynamicWeight defaults recoveryAmount to 1', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.recoveryAmount, 1);
  });

  test('routeSchema dynamicWeight defaults checkInterval to 10', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.checkInterval, 10);
  });
});

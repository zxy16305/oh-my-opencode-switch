/**
 * Unit tests for proxy/state-manager module
 * Tests state isolation and reset functionality
 * @module tests/proxy/unit/state-manager.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  StateManager,
  stateManager,
  createStateManager,
  resetAllState,
} from '../../../src/proxy/state-manager.js';

describe('StateManager - constructor and singleton', () => {
  test('StateManager is a class', () => {
    assert.ok(typeof StateManager === 'function');
  });

  test('stateManager is a singleton instance', () => {
    assert.ok(stateManager instanceof StateManager);
  });

  test('createStateManager returns new StateManager instance', () => {
    const manager = createStateManager();
    assert.ok(manager instanceof StateManager);
    assert.notStrictEqual(manager, stateManager);
  });

  test('multiple createStateManager calls return different instances', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();
    assert.notStrictEqual(manager1, manager2);
  });
});

describe('StateManager - timeSlotCalculator', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('timeSlotCalculator is null initially', () => {
    assert.equal(manager.timeSlotCalculator, null);
  });

  test('timeSlotCalculator can be set and retrieved', () => {
    const mockCalculator = { getTimeSlotWeight: () => 1.0 };
    manager.timeSlotCalculator = mockCalculator;
    assert.strictEqual(manager.timeSlotCalculator, mockCalculator);
  });

  test('reset clears timeSlotCalculator', () => {
    manager.timeSlotCalculator = { getTimeSlotWeight: () => 1.0 };
    assert.ok(manager.timeSlotCalculator !== null);

    manager.reset();
    assert.equal(manager.timeSlotCalculator, null);
  });
});

describe('StateManager - state maps are initialized', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('sessionMap is a Map', () => {
    assert.ok(manager.sessionMap instanceof Map);
  });

  test('upstreamSessionCounts is a Map', () => {
    assert.ok(manager.upstreamSessionCounts instanceof Map);
  });

  test('roundRobinCounters is a Map', () => {
    assert.ok(manager.roundRobinCounters instanceof Map);
  });

  test('dynamicWeightState is not present (handled separately)', () => {
    // dynamicWeightState is managed by router.js compatibility layer, not StateManager
    assert.equal(manager.dynamicWeightState, undefined);
  });

  test('statsState is a Map', () => {
    assert.ok(manager.statsState instanceof Map);
  });

  test('errorState is a Map', () => {
    assert.ok(manager.errorState instanceof Map);
  });

  test('latencyState is a Map', () => {
    assert.ok(manager.latencyState instanceof Map);
  });

  test('upstreamRequestCounts is a Map', () => {
    assert.ok(manager.upstreamRequestCounts instanceof Map);
  });

  test('upstreamSlidingWindowCounts is a Map', () => {
    assert.ok(manager.upstreamSlidingWindowCounts instanceof Map);
  });

  test('tokenStatsState is a Map', () => {
    assert.ok(manager.tokenStatsState instanceof Map);
  });
});

describe('StateManager - reset() clears all state', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  test('reset clears sessionMap', () => {
    manager.sessionMap.set('session-1', { upstreamId: 'up-1', routeKey: 'route-1', timestamp: Date.now() });
    assert.equal(manager.sessionMap.size, 1);

    manager.reset();
    assert.equal(manager.sessionMap.size, 0);
  });

  test('reset clears upstreamSessionCounts', () => {
    manager.upstreamSessionCounts.set('route-1', new Map([['up-1', 5]]));
    assert.equal(manager.upstreamSessionCounts.size, 1);

    manager.reset();
    assert.equal(manager.upstreamSessionCounts.size, 0);
  });

  test('reset clears roundRobinCounters', () => {
    manager.roundRobinCounters.set('route-1', 5);
    assert.equal(manager.roundRobinCounters.size, 1);

    manager.reset();
    assert.equal(manager.roundRobinCounters.size, 0);
  });

  test('reset clears statsState', () => {
    manager.statsState.set('route-1:up-1', { ttfbSamples: [100, 200], durationSamples: [500], errorCount: 0 });
    assert.equal(manager.statsState.size, 1);

    manager.reset();
    assert.equal(manager.statsState.size, 0);
  });

  test('reset clears errorState', () => {
    manager.errorState.set('route-1:up-1', { errors: [{ timestamp: Date.now(), statusCode: 500 }] });
    assert.equal(manager.errorState.size, 1);

    manager.reset();
    assert.equal(manager.errorState.size, 0);
  });

  test('reset clears latencyState', () => {
    manager.latencyState.set('route-1:up-1', { latencies: [{ timestamp: Date.now(), duration: 500 }] });
    assert.equal(manager.latencyState.size, 1);

    manager.reset();
    assert.equal(manager.latencyState.size, 0);
  });

  test('reset clears upstreamRequestCounts', () => {
    manager.upstreamRequestCounts.set('route-1', new Map([['up-1', 10]]));
    assert.equal(manager.upstreamRequestCounts.size, 1);

    manager.reset();
    assert.equal(manager.upstreamRequestCounts.size, 0);
  });

  test('reset clears upstreamSlidingWindowCounts', () => {
    manager.upstreamSlidingWindowCounts.set('route-1:up-1', [{ timestamp: Date.now() }]);
    assert.equal(manager.upstreamSlidingWindowCounts.size, 1);

    manager.reset();
    assert.equal(manager.upstreamSlidingWindowCounts.size, 0);
  });

  test('reset clears tokenStatsState', () => {
    manager.tokenStatsState.set('route-1:up-1', {
      inputTokens: [{ timestamp: Date.now(), count: 100 }],
      outputTokens: [{ timestamp: Date.now(), count: 200 }],
    });
    assert.equal(manager.tokenStatsState.size, 1);

    manager.reset();
    assert.equal(manager.tokenStatsState.size, 0);
  });

  test('reset clears cleanupInterval', () => {
    const interval = setInterval(() => {}, 10000);
    manager.cleanupInterval = interval;

    manager.reset();

    assert.equal(manager.cleanupInterval, null);
  });
});

describe('StateManager - resetAllState module function', () => {
  test('resetAllState clears singleton state', () => {
    stateManager.sessionMap.set('test', { upstreamId: 'up' });
    stateManager.roundRobinCounters.set('route', 5);

    assert.equal(stateManager.sessionMap.size, 1);

    resetAllState();

    assert.equal(stateManager.sessionMap.size, 0);
    assert.equal(stateManager.roundRobinCounters.size, 0);
  });
});

describe('StateManager - state isolation between instances', () => {
  test('separate instances have separate sessionMaps', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    manager1.sessionMap.set('session-1', { upstreamId: 'up-1' });

    assert.equal(manager1.sessionMap.size, 1);
    assert.equal(manager2.sessionMap.size, 0);

    manager1.reset();
    manager2.reset();
  });

  test('separate instances have separate roundRobinCounters', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    manager1.roundRobinCounters.set('route-1', 10);

    assert.equal(manager1.roundRobinCounters.get('route-1'), 10);
    assert.equal(manager2.roundRobinCounters.has('route-1'), false);

    manager1.reset();
    manager2.reset();
  });

  test('reset on one instance does not affect another', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    manager1.sessionMap.set('session-1', {});
    manager2.sessionMap.set('session-2', {});

    manager1.reset();

    assert.equal(manager1.sessionMap.size, 0);
    assert.equal(manager2.sessionMap.size, 1);

    manager2.reset();
  });
});

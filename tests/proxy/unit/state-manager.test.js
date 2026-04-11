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
  getTimeSlotCalculator,
  resetAllState,
  // State accessors
  getSessionUpstreamMap,
  getUpstreamSessionCounts,
  getRoundRobinCounters,
  getDynamicWeightState,
  getRecoveryTimers,
  getStatsState,
  getErrorState,
  getLatencyState,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
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

describe('StateManager - timeSlotCalculator singleton', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('getTimeSlotCalculator returns null initially', () => {
    const calculator = manager.getTimeSlotCalculator();
    assert.equal(calculator, null);
  });

  test('setTimeSlotCalculator stores the calculator', () => {
    const mockCalculator = { getTimeSlotWeight: () => 1.0 };
    manager.setTimeSlotCalculator(mockCalculator);
    const result = manager.getTimeSlotCalculator();
    assert.strictEqual(result, mockCalculator);
  });

  test('getTimeSlotCalculator from module returns the same instance', () => {
    const mockCalculator = { getTimeSlotWeight: () => 1.0 };
    stateManager.setTimeSlotCalculator(mockCalculator);
    const result = getTimeSlotCalculator();
    assert.strictEqual(result, mockCalculator);
    stateManager.reset();
  });
});

describe('StateManager - state variable accessors', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('getSessionUpstreamMap returns a Map', () => {
    const map = manager.getSessionUpstreamMap();
    assert.ok(map instanceof Map);
  });

  test('getUpstreamSessionCounts returns a Map', () => {
    const map = manager.getUpstreamSessionCounts();
    assert.ok(map instanceof Map);
  });

  test('getRoundRobinCounters returns a Map', () => {
    const map = manager.getRoundRobinCounters();
    assert.ok(map instanceof Map);
  });

  test('getDynamicWeightState returns a Map', () => {
    const map = manager.getDynamicWeightState();
    assert.ok(map instanceof Map);
  });

  test('getRecoveryTimers returns a Map', () => {
    const map = manager.getRecoveryTimers();
    assert.ok(map instanceof Map);
  });

  test('getStatsState returns a Map', () => {
    const map = manager.getStatsState();
    assert.ok(map instanceof Map);
  });

  test('getErrorState returns a Map', () => {
    const map = manager.getErrorState();
    assert.ok(map instanceof Map);
  });

  test('getLatencyState returns a Map', () => {
    const map = manager.getLatencyState();
    assert.ok(map instanceof Map);
  });

  test('getUpstreamRequestCounts returns a Map', () => {
    const map = manager.getUpstreamRequestCounts();
    assert.ok(map instanceof Map);
  });

  test('getUpstreamSlidingWindowCounts returns a Map', () => {
    const map = manager.getUpstreamSlidingWindowCounts();
    assert.ok(map instanceof Map);
  });
});

describe('StateManager - reset() clears all state', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  test('reset clears sessionUpstreamMap', () => {
    const map = manager.getSessionUpstreamMap();
    map.set('session-1', { upstreamId: 'up-1', routeKey: 'route-1', timestamp: Date.now() });
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears upstreamSessionCounts', () => {
    const map = manager.getUpstreamSessionCounts();
    map.set('route-1', new Map([['up-1', 5]]));
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears roundRobinCounters', () => {
    const map = manager.getRoundRobinCounters();
    map.set('route-1', 5);
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears dynamicWeightState', () => {
    const map = manager.getDynamicWeightState();
    map.set('route-1:up-1', { currentWeight: 50, lastAdjustment: Date.now(), requestCount: 10 });
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears recoveryTimers', () => {
    const map = manager.getRecoveryTimers();
    const timer = setTimeout(() => {}, 10000);
    map.set('route-1', timer);
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
    clearTimeout(timer);
  });

  test('reset clears statsState', () => {
    const map = manager.getStatsState();
    map.set('route-1:up-1', { ttfbSamples: [100, 200], durationSamples: [500], errorCount: 0 });
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears errorState', () => {
    const map = manager.getErrorState();
    map.set('route-1:up-1', { errors: [{ timestamp: Date.now(), statusCode: 500 }] });
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears latencyState', () => {
    const map = manager.getLatencyState();
    map.set('route-1:up-1', { latencies: [{ timestamp: Date.now(), duration: 500 }] });
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears upstreamRequestCounts', () => {
    const map = manager.getUpstreamRequestCounts();
    map.set('route-1', new Map([['up-1', 10]]));
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears upstreamSlidingWindowCounts', () => {
    const map = manager.getUpstreamSlidingWindowCounts();
    map.set('route-1:up-1', [{ timestamp: Date.now() }]);
    assert.equal(map.size, 1);

    manager.reset();
    assert.equal(map.size, 0);
  });

  test('reset clears timeSlotCalculator', () => {
    manager.setTimeSlotCalculator({ getTimeSlotWeight: () => 1.0 });
    assert.ok(manager.getTimeSlotCalculator() !== null);

    manager.reset();
    assert.equal(manager.getTimeSlotCalculator(), null);
  });
});

describe('StateManager - resetAllState module function', () => {
  test('resetAllState clears all state on singleton', () => {
    // Populate singleton state
    stateManager.getSessionUpstreamMap().set('test', { upstreamId: 'up' });
    stateManager.getRoundRobinCounters().set('route', 5);
    stateManager.getDynamicWeightState().set('route:up', { currentWeight: 50 });

    assert.equal(stateManager.getSessionUpstreamMap().size, 1);

    resetAllState();

    assert.equal(stateManager.getSessionUpstreamMap().size, 0);
    assert.equal(stateManager.getRoundRobinCounters().size, 0);
    assert.equal(stateManager.getDynamicWeightState().size, 0);
  });
});

describe('StateManager - state isolation between instances', () => {
  test('separate instances have separate sessionUpstreamMaps', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    const map1 = manager1.getSessionUpstreamMap();
    const map2 = manager2.getSessionUpstreamMap();

    map1.set('session-1', { upstreamId: 'up-1' });

    assert.equal(map1.size, 1);
    assert.equal(map2.size, 0);

    manager1.reset();
    manager2.reset();
  });

  test('separate instances have separate roundRobinCounters', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    const counters1 = manager1.getRoundRobinCounters();
    const counters2 = manager2.getRoundRobinCounters();

    counters1.set('route-1', 10);

    assert.equal(counters1.get('route-1'), 10);
    assert.equal(counters2.has('route-1'), false);

    manager1.reset();
    manager2.reset();
  });

  test('separate instances have separate dynamicWeightState', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    const state1 = manager1.getDynamicWeightState();
    const state2 = manager2.getDynamicWeightState();

    state1.set('route:up', { currentWeight: 50, lastAdjustment: Date.now(), requestCount: 5 });

    assert.equal(state1.size, 1);
    assert.equal(state2.size, 0);

    manager1.reset();
    manager2.reset();
  });

  test('reset on one instance does not affect another', () => {
    const manager1 = createStateManager();
    const manager2 = createStateManager();

    manager1.getSessionUpstreamMap().set('session-1', {});
    manager2.getSessionUpstreamMap().set('session-2', {});

    manager1.reset();

    assert.equal(manager1.getSessionUpstreamMap().size, 0);
    assert.equal(manager2.getSessionUpstreamMap().size, 1);

    manager2.reset();
  });
});

describe('StateManager - cleanupInterval management', () => {
  let manager;

  beforeEach(() => {
    manager = createStateManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('getCleanupInterval returns null initially', () => {
    const interval = manager.getCleanupInterval();
    assert.equal(interval, null);
  });

  test('setCleanupInterval stores the interval', () => {
    const interval = setInterval(() => {}, 10000);
    manager.setCleanupInterval(interval);

    const result = manager.getCleanupInterval();
    assert.strictEqual(result, interval);

    clearInterval(interval);
  });

  test('reset clears cleanupInterval', () => {
    const interval = setInterval(() => {}, 10000);
    manager.setCleanupInterval(interval);

    manager.reset();

    assert.equal(manager.getCleanupInterval(), null);
  });
});

describe('StateManager - module accessor functions', () => {
  test('getSessionUpstreamMap returns singleton session map', () => {
    const map = getSessionUpstreamMap();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getSessionUpstreamMap());
  });

  test('getUpstreamSessionCounts returns singleton counts map', () => {
    const map = getUpstreamSessionCounts();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getUpstreamSessionCounts());
  });

  test('getRoundRobinCounters returns singleton counters map', () => {
    const map = getRoundRobinCounters();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getRoundRobinCounters());
  });

  test('getDynamicWeightState returns singleton weight state map', () => {
    const map = getDynamicWeightState();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getDynamicWeightState());
  });

  test('getRecoveryTimers returns singleton timers map', () => {
    const map = getRecoveryTimers();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getRecoveryTimers());
  });

  test('getStatsState returns singleton stats state map', () => {
    const map = getStatsState();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getStatsState());
  });

  test('getErrorState returns singleton error state map', () => {
    const map = getErrorState();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getErrorState());
  });

  test('getLatencyState returns singleton latency state map', () => {
    const map = getLatencyState();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getLatencyState());
  });

  test('getUpstreamRequestCounts returns singleton request counts map', () => {
    const map = getUpstreamRequestCounts();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getUpstreamRequestCounts());
  });

  test('getUpstreamSlidingWindowCounts returns singleton sliding window counts map', () => {
    const map = getUpstreamSlidingWindowCounts();
    assert.ok(map instanceof Map);
    assert.strictEqual(map, stateManager.getUpstreamSlidingWindowCounts());
  });
});

// tests/proxy/unit/WeightManager.test.js

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { WeightManager } from '../../../src/proxy/weight/index.js';

describe('WeightManager', () => {
  let manager;
  const mockRoutes = {
    'test-route': {
      upstreams: [
        { id: 'upstream-a', weight: 100 },
        { id: 'upstream-b', weight: 50 },
      ],
    },
  };

  describe('initRoutes', () => {
    beforeEach(() => {
      manager = new WeightManager();
    });

    it('should initialize all upstreams with correct state', () => {
      manager.initRoutes(mockRoutes);
      const state = manager.getState('test-route', 'upstream-a');
      assert.ok(state);
      assert.strictEqual(state.routeKey, 'test-route');
      assert.strictEqual(state.upstreamId, 'upstream-a');
      assert.strictEqual(state.configuredWeight, 100);
      assert.strictEqual(state.currentWeight, 100);
      assert.strictEqual(state.level, 'normal');
    });

    it('should create correct keys in state Map', () => {
      manager.initRoutes(mockRoutes);
      assert.ok(manager.state.has('test-route:upstream-a'));
      assert.ok(manager.state.has('test-route:upstream-b'));
      assert.strictEqual(manager.state.size, 2);
    });

    it('should initialize with configured weight values', () => {
      manager.initRoutes(mockRoutes);
      const stateA = manager.getState('test-route', 'upstream-a');
      const stateB = manager.getState('test-route', 'upstream-b');
      assert.strictEqual(stateA.configuredWeight, 100);
      assert.strictEqual(stateB.configuredWeight, 50);
    });
  });

  describe('getWeight', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should return currentWeight for existing upstream', () => {
      const weight = manager.getWeight('test-route', 'upstream-a');
      assert.strictEqual(weight, 100);
    });

    it('should return 100 for non-existent upstream', () => {
      const weight = manager.getWeight('non-existent', 'upstream-x');
      assert.strictEqual(weight, 100);
    });
  });

  describe('getState', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should return complete state object', () => {
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.routeKey, 'test-route');
      assert.strictEqual(state.upstreamId, 'upstream-a');
      assert.strictEqual(state.configuredWeight, 100);
      assert.strictEqual(state.currentWeight, 100);
      assert.strictEqual(state.level, 'normal');
      assert.strictEqual(state.errors.length, 0);
      assert.strictEqual(state.totalRequests, 0);
      assert.strictEqual(state.consecutiveSuccess, 0);
      assert.deepStrictEqual(state.recentRequestTimestamps, []);
    });

    it('should return undefined for non-existent upstream', () => {
      const state = manager.getState('non-existent', 'upstream-x');
      assert.strictEqual(state, undefined);
    });
  });

  describe('recordSuccess', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should increment totalRequests and consecutiveSuccess', () => {
      manager.recordSuccess('test-route', 'upstream-a', 100);
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.totalRequests, 1);
      assert.strictEqual(state.consecutiveSuccess, 1);
      assert.strictEqual(state.recentRequestTimestamps.length, 1);
    });

    it('should track latency', () => {
      manager.recordSuccess('test-route', 'upstream-a', 100);
      manager.recordSuccess('test-route', 'upstream-a', 200);
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.latencies.length, 2);
      assert.strictEqual(state.avgLatency, 150);
    });

    it('should trigger recovery when consecutiveSuccess reaches threshold', () => {
      const state = manager.getState('test-route', 'upstream-a');
      state.level = 'min';
      state.currentWeight = 10;

      for (let i = 0; i < 5; i++) {
        manager.recordSuccess('test-route', 'upstream-a', 100);
      }

      const updatedState = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(updatedState.level, 'medium');
      assert.strictEqual(updatedState.currentWeight, 20);
      assert.strictEqual(updatedState.consecutiveSuccess, 0);
    });
  });

  describe('recordError', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should increment errors and reset consecutiveSuccess', () => {
      manager.recordSuccess('test-route', 'upstream-a', 100);
      manager.recordSuccess('test-route', 'upstream-a', 100);
      manager.recordError('test-route', 'upstream-a', 500);
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.errors.length, 1);
      assert.strictEqual(state.consecutiveSuccess, 0);
      assert.strictEqual(state.totalRequests, 3);
      assert.strictEqual(state.recentRequestTimestamps.length, 3);
    });

    it('should trigger weight reduction at high error rate', () => {
      // Create 30% error rate (30 errors out of 100 requests)
      for (let i = 0; i < 70; i++) {
        manager.recordSuccess('test-route', 'upstream-a', 100);
      }
      for (let i = 0; i < 30; i++) {
        manager.recordError('test-route', 'upstream-a', 500);
      }
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.level, 'min');
      assert.strictEqual(state.currentWeight, 10); // minWeight floor
    });

    it('should not trigger reduction at low error rate', () => {
      // Create 3% error rate (3 errors out of 100 requests)
      for (let i = 0; i < 97; i++) {
        manager.recordSuccess('test-route', 'upstream-a', 100);
      }
      for (let i = 0; i < 3; i++) {
        manager.recordError('test-route', 'upstream-a', 500);
      }
      const state = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(state.level, 'normal');
      assert.strictEqual(state.currentWeight, 100);
    });
  });

  describe('checkTimeSlotChange', () => {
    beforeEach(() => {
      manager = new WeightManager();
    });

    it('should return false when time slot has not changed', () => {
      manager.initRoutes(mockRoutes);
      const changed = manager.checkTimeSlotChange(mockRoutes);
      assert.strictEqual(changed, false);
    });

    it('should update weights when time slot changes', () => {
      const routesWithTimeSlots = {
        'test-route': {
          upstreams: [
            {
              id: 'upstream-a',
              weight: 100,
              timeSlotWeights: { day: 150, night: 50 },
            },
          ],
        },
      };
      manager.initRoutes(routesWithTimeSlots);
      // Force a time slot change by modifying lastTimeSlot
      manager.lastTimeSlot = 'night';
      const changed = manager.checkTimeSlotChange(routesWithTimeSlots);
      assert.strictEqual(changed, true);
    });
  });

  describe('reloadConfig', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should update existing upstream weights', () => {
      const newRoutes = {
        'test-route': {
          upstreams: [
            { id: 'upstream-a', weight: 200 },
            { id: 'upstream-b', weight: 75 },
          ],
        },
      };
      manager.reloadConfig(newRoutes);
      const stateA = manager.getState('test-route', 'upstream-a');
      assert.strictEqual(stateA.configuredWeight, 200);
    });

    it('should add new upstreams', () => {
      const newRoutes = {
        'test-route': {
          upstreams: [
            { id: 'upstream-a', weight: 100 },
            { id: 'upstream-b', weight: 50 },
            { id: 'upstream-c', weight: 75 },
          ],
        },
      };
      manager.reloadConfig(newRoutes);
      assert.ok(manager.state.has('test-route:upstream-c'));
      assert.strictEqual(manager.state.size, 3);
    });

    it('should remove upstreams that no longer exist', () => {
      const newRoutes = {
        'test-route': {
          upstreams: [{ id: 'upstream-a', weight: 100 }],
        },
      };
      manager.reloadConfig(newRoutes);
      assert.ok(!manager.state.has('test-route:upstream-b'));
      assert.strictEqual(manager.state.size, 1);
    });
  });

  describe('getEffectiveWeight (Bug #4 regression)', () => {
    beforeEach(() => {
      manager = new WeightManager();
    });

    it('should return configured weight (not 100) for upstream with weight: 50 when no state', () => {
      const upstream = { id: 'u1', weight: 50 };
      const result = manager.getEffectiveWeight('route1', upstream, { enabled: true });
      assert.strictEqual(result, 50);
    });

    it('should return timeSlotWeight when no state exists', () => {
      manager.lastTimeSlot = 'high';
      const upstream = { id: 'u1', weight: 100, timeSlotWeights: { high: 150 } };
      const result = manager.getEffectiveWeight('route1', upstream, { enabled: true });
      assert.strictEqual(result, 150);
    });

    it('should return state.currentWeight when state exists', () => {
      manager.initRoutes({
        'test-route': {
          upstreams: [{ id: 'u1', weight: 100 }],
        },
      });
      const state = manager.getState('test-route', 'u1');
      state.currentWeight = 30;

      const result = manager.getEffectiveWeight(
        'test-route',
        { id: 'u1', weight: 100 },
        {
          enabled: true,
        }
      );
      assert.strictEqual(result, 30);
    });
  });

  describe('error rate window (Bug #2+#3 regression)', () => {
    beforeEach(() => {
      manager = new WeightManager();
      manager.initRoutes(mockRoutes);
    });

    it('should track recentRequestTimestamps on recordSuccess', () => {
      const ts = Date.now();
      manager.recordSuccess('test-route', 'upstream-a', 100);
      const state = manager.getState('test-route', 'upstream-a');
      assert.ok(state.recentRequestTimestamps.some((t) => t >= ts));
    });

    it('should track recentRequestTimestamps on recordError', () => {
      const ts = Date.now();
      manager.recordError('test-route', 'upstream-a', 500);
      const state = manager.getState('test-route', 'upstream-a');
      assert.ok(state.recentRequestTimestamps.some((t) => t >= ts));
    });

    it('should prune expired recentRequestTimestamps', () => {
      const state = manager.getState('test-route', 'upstream-a');
      const expired = Date.now() - 7200000; // 2 hours ago (window is 1 hour)
      state.recentRequestTimestamps.push(expired, expired, Date.now());
      manager.pruneOldErrors(state);
      assert.strictEqual(
        state.recentRequestTimestamps.filter((t) => t < Date.now() - 3600000).length,
        0
      );
      assert.ok(state.recentRequestTimestamps.length >= 1);
    });
  });
});

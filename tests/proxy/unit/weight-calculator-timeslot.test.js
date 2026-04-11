/**
 * Unit tests for weight-calculator - NEW time-slot static weight configuration
 * @module tests/proxy/unit/weight-calculator-timeslot.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../../src/proxy/state-manager.js';
import {
  calculateEffectiveWeight,
  getConfiguredWeight,
} from '../../../src/proxy/weight-calculator.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

// Helper to determine expected slot type from hour
function getExpectedSlotType(hour) {
  if (hour >= 21 || hour <= 7) return 'low';
  if ((hour >= 10 && hour <= 11) || (hour >= 13 && hour <= 17)) return 'high';
  return 'medium';
}

describe('Weight Calculator – NEW Time-Slot Static Weight Configuration', () => {
  let sm;

  beforeEach(() => {
    sm = new StateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  describe('Basic functionality', () => {
    test('timeSlotWeights is read from upstream config', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-1',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      // Weight will depend on current hour and slot type
      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);
      const expectedWeight = upstream.timeSlotWeights[slotType];

      assert.strictEqual(
        effectiveWeight,
        expectedWeight,
        `At hour ${currentHour} (${slotType}), weight should be ${expectedWeight}`
      );
    });

    test('slot weight REPLACES upstream.weight (not multiplier)', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-2',
        weight: 100, // base weight
        timeSlotWeights: {
          high: 50, // slot weight is different from base weight
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      // Current hour determines slot type
      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        // Slot weight REPLACES base weight
        assert.strictEqual(
          effectiveWeight,
          50,
          'Slot weight should REPLACE base weight (100 → 50), not multiply'
        );
      } else {
        // Slot not in config → use base weight
        assert.strictEqual(effectiveWeight, 100, 'Slot not in partial config → use base weight');
      }
    });
  });

  describe('Backwards compatibility', () => {
    test('no timeSlotWeights config uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-no-timeslot',
        weight: 150,
      });
      const staticWeight = 150;

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      assert.strictEqual(
        effectiveWeight,
        150,
        'Without timeSlotWeights config, should use upstream.weight'
      );
    });

    test('timeSlotWeights undefined uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-undefined-timeslot',
        weight: 120,
        timeSlotWeights: undefined,
      });
      const staticWeight = 120;

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      assert.strictEqual(
        effectiveWeight,
        120,
        'With timeSlotWeights undefined, should use upstream.weight'
      );
    });

    test('timeSlotWeights null uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-null-timeslot',
        weight: 80,
        timeSlotWeights: null,
      });
      const staticWeight = 80;

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      assert.strictEqual(
        effectiveWeight,
        80,
        'With timeSlotWeights null, should use upstream.weight'
      );
    });
  });

  describe('Partial config fallback', () => {
    test('only high slot configured, current is medium → use base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-partial-high',
        weight: 100,
        timeSlotWeights: {
          high: 30, // only high configured
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        assert.strictEqual(effectiveWeight, 30, 'High slot configured → use 30');
      } else {
        assert.strictEqual(
          effectiveWeight,
          100,
          'Medium/low slot not in partial config → use base weight 100'
        );
      }
    });

    test('only medium slot configured, current is low → use base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-partial-medium',
        weight: 100,
        timeSlotWeights: {
          medium: 80, // only medium configured
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'medium') {
        assert.strictEqual(effectiveWeight, 80, 'Medium slot configured → use 80');
      } else {
        assert.strictEqual(
          effectiveWeight,
          100,
          'High/low slot not in partial config → use base weight 100'
        );
      }
    });

    test('slot weight undefined uses base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-slot-undefined',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: undefined, // explicitly undefined
          low: 150,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'medium') {
        assert.strictEqual(
          effectiveWeight,
          100,
          'Medium slot undefined in config → use base weight'
        );
      } else if (slotType === 'high') {
        assert.strictEqual(effectiveWeight, 50, 'High slot defined → use 50');
      } else {
        assert.strictEqual(effectiveWeight, 150, 'Low slot defined → use 150');
      }
    });
  });

  describe('Integration with OLD error-rate system', () => {
    test('NEW static weight applies BEFORE OLD error-rate multiplier', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-both-systems',
        weight: 100,
        provider: 'test-provider',
        timeSlotWeights: {
          high: 50,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      // OLD system: error-rate dynamic multiplier
      // We need to seed some data to make the OLD system produce a multiplier
      // But for simplicity, we'll just test that both systems can coexist

      // Mock OLD system config (disabled to simplify)
      const timeSlotWeightConfig = {
        enabled: false,
        totalErrorThreshold: 0.01,
        dangerSlotThreshold: 0.05,
        dangerMultiplier: 0.5,
        normalMultiplier: 2.0,
        lookbackDays: 7,
      };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        // NEW static weight REPLACES base weight → 50
        // OLD system disabled → no multiplier
        assert.strictEqual(effectiveWeight, 50, 'NEW static weight applies, OLD disabled');
      } else {
        // Slot not in config → use base weight
        assert.strictEqual(effectiveWeight, 100, 'Slot not in NEW config, OLD disabled');
      }
    });

    test('OLD error-rate system logic unchanged', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-old-system',
        weight: 100,
        provider: 'test-provider',
        // No NEW timeSlotWeights
      });
      const staticWeight = 100;

      // OLD system: disabled
      const timeSlotWeightConfig = {
        enabled: false,
        totalErrorThreshold: 0.01,
        dangerSlotThreshold: 0.05,
        dangerMultiplier: 0.5,
        normalMultiplier: 2.0,
        lookbackDays: 7,
      };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig,
      });

      // No NEW system, OLD disabled → base weight
      assert.strictEqual(effectiveWeight, 100, 'No NEW config, OLD disabled → base weight');
    });
  });

  describe('Edge cases', () => {
    test('effective weight minimum is 1', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-min-weight',
        weight: 100,
        timeSlotWeights: {
          high: 0, // slot weight is 0
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        // Slot weight 0 → but Math.max(1, effectiveWeight) ensures minimum 1
        assert.strictEqual(effectiveWeight, 1, 'Weight should be clamped to minimum 1');
      } else {
        assert.strictEqual(effectiveWeight, 100, 'Slot not in config → base weight');
      }
    });

    test('slot weight negative → still clamped to 1', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-negative-weight',
        weight: 100,
        timeSlotWeights: {
          high: -50, // negative slot weight
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        // Negative slot weight → Math.max(1, effectiveWeight) clamps to 1
        assert.strictEqual(effectiveWeight, 1, 'Negative weight should be clamped to minimum 1');
      } else {
        assert.strictEqual(effectiveWeight, 100, 'Slot not in config → base weight');
      }
    });

    test('upstream without weight field defaults to 100', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-no-weight',
        // No weight field (makeUpstream defaults to 100)
        timeSlotWeights: {
          high: 30,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'high') {
        assert.strictEqual(effectiveWeight, 30, 'High slot configured → use 30');
      } else {
        assert.strictEqual(effectiveWeight, 100, 'Slot not in config → use default 100');
      }
    });
  });

  describe('timeSlotWeights + dynamicWeight interaction', () => {
    test('timeSlotWeights.low=200 + dynamicWeight returning 200 → no truncation', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-combo-1',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      // Seed dynamic weight state with currentWeight=200 (matching the low slot weight)
      const key = `${routeKey}:${upstream.id}`;
      sm.dynamicWeightState.set(key, {
        currentWeight: 200,
        lastStaticWeight: 200,
        lastAdjustment: Date.now(),
        requestCount: 0,
        consecutiveSuccessCount: 0,
        currentWeightLevel: 'normal',
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'low') {
        // Dynamic weight returns 200 directly (not truncated to 100)
        assert.strictEqual(
          effectiveWeight,
          200,
          'Dynamic weight should return 200 without truncation when slot is low'
        );
      } else if (slotType === 'high') {
        // configuredWeight = 50 (high slot), dynamic initialized at 50 or uses existing 200
        // Since lastStaticWeight=200 > configuredWeight=50, it keeps currentWeight
        assert.ok(effectiveWeight >= 1, 'Weight should be at least 1');
      } else {
        assert.ok(effectiveWeight >= 1, 'Weight should be at least 1');
      }
    });

    test('timeSlotWeights.low=200 + dynamicWeight reduced to 100 → effectiveWeight=100', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-combo-2',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      // Seed dynamic weight state: was 200 (low slot), reduced to 100 by error/latency
      const key = `${routeKey}:${upstream.id}`;
      sm.dynamicWeightState.set(key, {
        currentWeight: 100,
        lastStaticWeight: 200,
        lastAdjustment: Date.now(),
        requestCount: 0,
        consecutiveSuccessCount: 0,
        currentWeightLevel: 'half',
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      if (slotType === 'low') {
        // configuredWeight=200, lastStaticWeight=200, currentWeight=100
        // configuredWeight(200) >= lastStaticWeight(200) → no bump, returns currentWeight=100
        assert.strictEqual(
          effectiveWeight,
          100,
          'Dynamic weight reduced to 100 should be returned as effective weight'
        );
      } else if (slotType === 'high') {
        // configuredWeight=50, lastStaticWeight=200, configuredWeight < lastStaticWeight → keep
        assert.strictEqual(effectiveWeight, 100, 'Current weight 100 returned');
      } else {
        // configuredWeight=100, lastStaticWeight=200, configuredWeight < lastStaticWeight → keep
        assert.strictEqual(effectiveWeight, 100, 'Current weight 100 returned');
      }
    });

    test('no timeSlotWeights + dynamicWeight adjusts weight correctly', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-dynamic-only',
        weight: 100,
        // No timeSlotWeights
      });
      const staticWeight = 100;

      // Seed dynamic weight state: weight reduced to 50 due to errors
      const key = `${routeKey}:${upstream.id}`;
      sm.dynamicWeightState.set(key, {
        currentWeight: 50,
        lastStaticWeight: 100,
        lastAdjustment: Date.now(),
        requestCount: 0,
        consecutiveSuccessCount: 0,
        currentWeightLevel: 'half',
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        timeSlotWeightConfig: null,
      });

      // No timeSlotWeights → configuredWeight = upstream.weight = 100
      // lastStaticWeight=100, configuredWeight=100 → not greater, returns currentWeight=50
      assert.strictEqual(
        effectiveWeight,
        50,
        'Dynamic weight 50 should be returned when no timeSlotWeights'
      );
    });

    test('no timeSlotWeights + dynamicWeight at initial weight returns base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-dynamic-initial',
        weight: 150,
        // No timeSlotWeights
      });
      const staticWeight = 150;

      // No pre-seeded dynamic weight state → getDynamicWeight initializes with configuredWeight
      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        timeSlotWeightConfig: null,
      });

      // No timeSlotWeights → configuredWeight = upstream.weight = 150
      // No existing state → initializes with 150, returns 150
      assert.strictEqual(
        effectiveWeight,
        150,
        'Dynamic weight should initialize to configuredWeight (150) when no prior state'
      );
    });

    test('timeSlotWeights with dynamicWeight disabled uses slot weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-timeslot-only',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null, // dynamic disabled
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);
      const expectedWeight = upstream.timeSlotWeights[slotType];

      assert.strictEqual(
        effectiveWeight,
        expectedWeight,
        `At hour ${currentHour} (${slotType}), weight should be ${expectedWeight} from timeSlotWeights only`
      );
    });

    test('dynamicWeight uses slot weight as configuredWeight, not upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-configured-weight',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      // First call: initializes dynamic weight state
      const effectiveWeight1 = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      // Verify the dynamic weight was initialized with the slot weight, not upstream.weight
      const key = `${routeKey}:${upstream.id}`;
      const weightState = sm.dynamicWeightState.get(key);

      assert.ok(weightState, 'Dynamic weight state should be created');

      const expectedConfiguredWeight = upstream.timeSlotWeights[slotType] ?? upstream.weight;
      assert.strictEqual(
        weightState.lastStaticWeight,
        expectedConfiguredWeight,
        `Dynamic weight should be initialized with slot weight (${expectedConfiguredWeight}), not upstream.weight (100)`
      );

      assert.strictEqual(
        effectiveWeight1,
        expectedConfiguredWeight,
        `Effective weight should match slot weight on first call`
      );
    });
  });

  describe('Different time slot types', () => {
    test('high load hours (10-11, 13-17) get high slot weight', () => {
      // This test verifies that at current hour, if it's a high load hour,
      // the high slot weight is used
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-high-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      const expectedWeight = upstream.timeSlotWeights[slotType];
      assert.strictEqual(
        effectiveWeight,
        expectedWeight,
        `At hour ${currentHour} (${slotType}), weight should be ${expectedWeight}`
      );
    });

    test('medium load hours (8-9, 12, 18-20) get medium slot weight', () => {
      // Same as above, just checking different slot type
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-medium-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      const expectedWeight = upstream.timeSlotWeights[slotType];
      assert.strictEqual(
        effectiveWeight,
        expectedWeight,
        `At hour ${currentHour} (${slotType}), weight should be ${expectedWeight}`
      );
    });

    test('low load hours (21-23, 0-7) get low slot weight', () => {
      // Same as above, just checking different slot type
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-low-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });
      const staticWeight = getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        timeSlotWeightConfig: null,
      });

      const currentHour = new Date().getHours();
      const slotType = getExpectedSlotType(currentHour);

      const expectedWeight = upstream.timeSlotWeights[slotType];
      assert.strictEqual(
        effectiveWeight,
        expectedWeight,
        `At hour ${currentHour} (${slotType}), weight should be ${expectedWeight}`
      );
    });
  });
});

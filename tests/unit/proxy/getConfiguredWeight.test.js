/**
 * Unit tests for getConfiguredWeight method
 * @module tests/proxy/unit/getConfiguredWeight.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { WeightManager } from '../../../src/proxy/weight/index.js';

describe('getConfiguredWeight', () => {
  let weightManager;

  beforeEach(() => {
    weightManager = new WeightManager();
  });

  afterEach(() => {
    weightManager = null;
  });

  describe('Complete timeSlotWeights config (all slots defined)', () => {
    test('returns high slot weight during high load hours', () => {
      const highHours = [10, 11, 13, 14, 15, 16, 17];

      for (const hour of highHours) {
        weightManager.lastTimeSlot = 'high';
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 100, low: 200 },
        };

        const result = weightManager.getConfiguredWeight(upstream);
        assert.strictEqual(result, 50, `At hour ${hour} (high), should return 50`);
      }
    });

    test('returns medium slot weight during medium load hours', () => {
      const mediumHours = [8, 9, 12, 18, 19, 20];

      for (const hour of mediumHours) {
        weightManager.lastTimeSlot = 'medium';
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 75, low: 200 },
        };

        const result = weightManager.getConfiguredWeight(upstream);
        assert.strictEqual(result, 75, `At hour ${hour} (medium), should return 75`);
      }
    });

    test('returns low slot weight during low load hours', () => {
      const lowHours = [0, 1, 2, 3, 4, 5, 6, 7, 21, 22, 23];

      for (const hour of lowHours) {
        weightManager.lastTimeSlot = 'low';
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 100, low: 300 },
        };

        const result = weightManager.getConfiguredWeight(upstream);
        assert.strictEqual(result, 300, `At hour ${hour} (low), should return 300`);
      }
    });
  });

  describe('Partial timeSlotWeights config (only some slots defined)', () => {
    test('only high defined - fallback to upstream.weight for other slots', () => {
      const upstream = {
        weight: 150,
        timeSlotWeights: { high: 50 },
      };

      // Test high hour
      weightManager.lastTimeSlot = 'high';
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 50, 'High slot defined → use 50');

      // Test medium hour (not defined)
      weightManager.lastTimeSlot = 'medium';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        150,
        'Medium not defined → fallback to upstream.weight'
      );

      // Test low hour (not defined)
      weightManager.lastTimeSlot = 'low';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        150,
        'Low not defined → fallback to upstream.weight'
      );
    });

    test('only medium defined - fallback to upstream.weight for other slots', () => {
      const upstream = {
        weight: 120,
        timeSlotWeights: { medium: 80 },
      };

      // Test high hour (not defined)
      weightManager.lastTimeSlot = 'high';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        120,
        'High not defined → fallback to upstream.weight'
      );

      // Test medium hour
      weightManager.lastTimeSlot = 'medium';
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 80, 'Medium slot defined → use 80');

      // Test low hour (not defined)
      weightManager.lastTimeSlot = 'low';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        120,
        'Low not defined → fallback to upstream.weight'
      );
    });

    test('only low defined - fallback to upstream.weight for other slots', () => {
      const upstream = {
        weight: 100,
        timeSlotWeights: { low: 250 },
      };

      // Test high hour (not defined)
      weightManager.lastTimeSlot = 'high';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        100,
        'High not defined → fallback to upstream.weight'
      );

      // Test medium hour (not defined)
      weightManager.lastTimeSlot = 'medium';
      assert.strictEqual(
        weightManager.getConfiguredWeight(upstream),
        100,
        'Medium not defined → fallback to upstream.weight'
      );

      // Test low hour
      weightManager.lastTimeSlot = 'low';
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 250, 'Low slot defined → use 250');
    });
  });

  describe('No timeSlotWeights - use upstream.weight', () => {
    test('returns upstream.weight when timeSlotWeights is undefined', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {
        weight: 175,
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 175, 'Should return upstream.weight');
    });

    test('returns upstream.weight when timeSlotWeights is null', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {
        weight: 200,
        timeSlotWeights: null,
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 200, 'Should return upstream.weight');
    });

    test('returns upstream.weight when timeSlotWeights is empty object', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = {
        weight: 125,
        timeSlotWeights: {},
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 125, 'Should return upstream.weight');
    });
  });

  describe('No upstream.weight - fallback to 100', () => {
    test('returns 100 when upstream.weight is undefined and no timeSlotWeights', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {};

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 100, 'Should return default 100');
    });

    test('returns 100 when upstream.weight is null and no timeSlotWeights', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = { weight: null };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 100, 'Should return default 100');
    });

    test('returns timeSlotWeight even when upstream.weight is undefined', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {
        timeSlotWeights: { high: 60 },
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 60, 'Should use high slot weight');
    });

    test('returns timeSlotWeight even when upstream.weight is null', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = {
        weight: null,
        timeSlotWeights: { medium: 90 },
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 90, 'Should use medium slot weight');
    });
  });

  describe('Null/undefined upstream handling', () => {
    test('throws TypeError when upstream is null', () => {
      weightManager.lastTimeSlot = 'high';
      assert.throws(() => weightManager.getConfiguredWeight(null), TypeError);
    });

    test('throws TypeError when upstream is undefined', () => {
      weightManager.lastTimeSlot = 'high';
      assert.throws(() => weightManager.getConfiguredWeight(undefined), TypeError);
    });
  });

  describe('Edge cases', () => {
    test('slot weight 0 returns 0 (valid config)', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {
        weight: 100,
        timeSlotWeights: { high: 0 },
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 0, 'Should return 0 when slot weight is explicitly 0');
    });

    test('negative slot weight returns negative (no clamping)', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = {
        weight: 100,
        timeSlotWeights: { high: -50 },
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, -50, 'Should return negative weight without clamping');
    });

    test('upstream.weight 0 returns 0 (valid weight)', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = {
        weight: 0,
      };

      const result = weightManager.getConfiguredWeight(upstream);
      assert.strictEqual(result, 0, 'upstream.weight=0 is a valid value, not a fallback trigger');
    });
  });

  describe('Time slot boundary tests', () => {
    test('hour 7 is low slot', () => {
      weightManager.lastTimeSlot = 'low';
      const upstream = { weight: 100, timeSlotWeights: { low: 500 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 500);
    });

    test('hour 8 is medium slot (boundary)', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = { weight: 100, timeSlotWeights: { medium: 200 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 200);
    });

    test('hour 10 is high slot (boundary)', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = { weight: 100, timeSlotWeights: { high: 50 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 50);
    });

    test('hour 12 is medium slot (noon)', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = { weight: 100, timeSlotWeights: { medium: 150 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 150);
    });

    test('hour 13 is high slot (afternoon boundary)', () => {
      weightManager.lastTimeSlot = 'high';
      const upstream = { weight: 100, timeSlotWeights: { high: 75 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 75);
    });

    test('hour 18 is medium slot (evening boundary)', () => {
      weightManager.lastTimeSlot = 'medium';
      const upstream = { weight: 100, timeSlotWeights: { medium: 125 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 125);
    });

    test('hour 21 is low slot (night boundary)', () => {
      weightManager.lastTimeSlot = 'low';
      const upstream = { weight: 100, timeSlotWeights: { low: 300 } };
      assert.strictEqual(weightManager.getConfiguredWeight(upstream), 300);
    });
  });
});

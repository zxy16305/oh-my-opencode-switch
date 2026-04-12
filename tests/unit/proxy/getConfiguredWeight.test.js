/**
 * Unit tests for getConfiguredWeight function
 * @module tests/proxy/unit/getConfiguredWeight.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getConfiguredWeight } from '../../../src/proxy/weight-calculator.js';

describe('getConfiguredWeight', () => {
  let originalDate;

  beforeEach(() => {
    originalDate = global.Date;
  });

  afterEach(() => {
    global.Date = originalDate;
  });

  // Helper to mock current hour
  function mockHour(hour) {
    const mockDate = class extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super();
          // Return a date with the mocked hour
          const d = new originalDate();
          d.setHours(hour, 0, 0, 0);
          return d;
        }
        return new originalDate(...args);
      }

      static now() {
        const d = new originalDate();
        d.setHours(hour, 0, 0, 0);
        return d.getTime();
      }
    };
    global.Date = mockDate;
  }

  describe('Complete timeSlotWeights config (all slots defined)', () => {
    test('returns high slot weight during high load hours', () => {
      const highHours = [10, 11, 13, 14, 15, 16, 17];

      for (const hour of highHours) {
        mockHour(hour);
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 100, low: 200 },
        };

        const result = getConfiguredWeight(upstream);
        assert.strictEqual(result, 50, `At hour ${hour} (high), should return 50`);
      }
    });

    test('returns medium slot weight during medium load hours', () => {
      const mediumHours = [8, 9, 12, 18, 19, 20];

      for (const hour of mediumHours) {
        mockHour(hour);
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 75, low: 200 },
        };

        const result = getConfiguredWeight(upstream);
        assert.strictEqual(result, 75, `At hour ${hour} (medium), should return 75`);
      }
    });

    test('returns low slot weight during low load hours', () => {
      const lowHours = [0, 1, 2, 3, 4, 5, 6, 7, 21, 22, 23];

      for (const hour of lowHours) {
        mockHour(hour);
        const upstream = {
          weight: 100,
          timeSlotWeights: { high: 50, medium: 100, low: 300 },
        };

        const result = getConfiguredWeight(upstream);
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
      mockHour(10);
      assert.strictEqual(getConfiguredWeight(upstream), 50, 'High slot defined → use 50');

      // Test medium hour (not defined)
      mockHour(8);
      assert.strictEqual(
        getConfiguredWeight(upstream),
        150,
        'Medium not defined → fallback to upstream.weight'
      );

      // Test low hour (not defined)
      mockHour(22);
      assert.strictEqual(
        getConfiguredWeight(upstream),
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
      mockHour(10);
      assert.strictEqual(
        getConfiguredWeight(upstream),
        120,
        'High not defined → fallback to upstream.weight'
      );

      // Test medium hour
      mockHour(12);
      assert.strictEqual(getConfiguredWeight(upstream), 80, 'Medium slot defined → use 80');

      // Test low hour (not defined)
      mockHour(3);
      assert.strictEqual(
        getConfiguredWeight(upstream),
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
      mockHour(14);
      assert.strictEqual(
        getConfiguredWeight(upstream),
        100,
        'High not defined → fallback to upstream.weight'
      );

      // Test medium hour (not defined)
      mockHour(19);
      assert.strictEqual(
        getConfiguredWeight(upstream),
        100,
        'Medium not defined → fallback to upstream.weight'
      );

      // Test low hour
      mockHour(23);
      assert.strictEqual(getConfiguredWeight(upstream), 250, 'Low slot defined → use 250');
    });
  });

  describe('No timeSlotWeights - use upstream.weight', () => {
    test('returns upstream.weight when timeSlotWeights is undefined', () => {
      mockHour(10);
      const upstream = {
        weight: 175,
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 175, 'Should return upstream.weight');
    });

    test('returns upstream.weight when timeSlotWeights is null', () => {
      mockHour(14);
      const upstream = {
        weight: 200,
        timeSlotWeights: null,
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 200, 'Should return upstream.weight');
    });

    test('returns upstream.weight when timeSlotWeights is empty object', () => {
      mockHour(8);
      const upstream = {
        weight: 125,
        timeSlotWeights: {},
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 125, 'Should return upstream.weight');
    });
  });

  describe('No upstream.weight - fallback to 100', () => {
    test('returns 100 when upstream.weight is undefined and no timeSlotWeights', () => {
      mockHour(10);
      const upstream = {};

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 100, 'Should return default 100');
    });

    test('returns 100 when upstream.weight is null and no timeSlotWeights', () => {
      mockHour(15);
      const upstream = { weight: null };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 100, 'Should return default 100');
    });

    test('returns timeSlotWeight even when upstream.weight is undefined', () => {
      mockHour(10);
      const upstream = {
        timeSlotWeights: { high: 60 },
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 60, 'Should use high slot weight');
    });

    test('returns timeSlotWeight even when upstream.weight is null', () => {
      mockHour(8);
      const upstream = {
        weight: null,
        timeSlotWeights: { medium: 90 },
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 90, 'Should use medium slot weight');
    });
  });

  describe('Null/undefined upstream handling', () => {
    test('returns 100 when upstream is null', () => {
      mockHour(10);
      const result = getConfiguredWeight(null);
      assert.strictEqual(result, 100, 'Should return default 100 for null upstream');
    });

    test('returns 100 when upstream is undefined', () => {
      mockHour(14);
      const result = getConfiguredWeight(undefined);
      assert.strictEqual(result, 100, 'Should return default 100 for undefined upstream');
    });
  });

  describe('Edge cases', () => {
    test('slot weight 0 returns 0 (valid config)', () => {
      mockHour(10);
      const upstream = {
        weight: 100,
        timeSlotWeights: { high: 0 },
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 0, 'Should return 0 when slot weight is explicitly 0');
    });

    test('negative slot weight returns negative (no clamping)', () => {
      mockHour(10);
      const upstream = {
        weight: 100,
        timeSlotWeights: { high: -50 },
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, -50, 'Should return negative weight without clamping');
    });

    test('upstream.weight 0 returns 0 (valid weight)', () => {
      mockHour(8);
      const upstream = {
        weight: 0,
      };

      const result = getConfiguredWeight(upstream);
      assert.strictEqual(result, 0, 'upstream.weight=0 is a valid value, not a fallback trigger');
    });
  });

  describe('Time slot boundary tests', () => {
    test('hour 7 is low slot', () => {
      mockHour(7);
      const upstream = { weight: 100, timeSlotWeights: { low: 500 } };
      assert.strictEqual(getConfiguredWeight(upstream), 500);
    });

    test('hour 8 is medium slot (boundary)', () => {
      mockHour(8);
      const upstream = { weight: 100, timeSlotWeights: { medium: 200 } };
      assert.strictEqual(getConfiguredWeight(upstream), 200);
    });

    test('hour 10 is high slot (boundary)', () => {
      mockHour(10);
      const upstream = { weight: 100, timeSlotWeights: { high: 50 } };
      assert.strictEqual(getConfiguredWeight(upstream), 50);
    });

    test('hour 12 is medium slot (noon)', () => {
      mockHour(12);
      const upstream = { weight: 100, timeSlotWeights: { medium: 150 } };
      assert.strictEqual(getConfiguredWeight(upstream), 150);
    });

    test('hour 13 is high slot (afternoon boundary)', () => {
      mockHour(13);
      const upstream = { weight: 100, timeSlotWeights: { high: 75 } };
      assert.strictEqual(getConfiguredWeight(upstream), 75);
    });

    test('hour 18 is medium slot (evening boundary)', () => {
      mockHour(18);
      const upstream = { weight: 100, timeSlotWeights: { medium: 125 } };
      assert.strictEqual(getConfiguredWeight(upstream), 125);
    });

    test('hour 21 is low slot (night boundary)', () => {
      mockHour(21);
      const upstream = { weight: 100, timeSlotWeights: { low: 300 } };
      assert.strictEqual(getConfiguredWeight(upstream), 300);
    });
  });
});

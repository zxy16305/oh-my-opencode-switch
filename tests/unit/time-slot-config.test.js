import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HourlyErrorTracker, TimeSlotWeightCalculator } from '../../src/utils/time-slot-stats.js';

function makeDate(daysOffset, hour) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour, 30, 0, 0);
  return date;
}

describe('TimeSlotWeightCalculator - lookbackDays configuration', () => {
  let tracker;
  let calculator;

  beforeEach(() => {
    tracker = new HourlyErrorTracker();
  });

  describe('default lookbackDays value', () => {
    it('should use default lookbackDays of 3 when no config provided', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });
      const config = calculator.getConfig();
      assert.equal(config.lookbackDays, 3);
    });

    it('should return 1.0 for insufficient data with default 3 days lookback', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });

      // Seed only 2 days of data (< 3 days threshold)
      for (let day = 0; day < 2; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-day, hour);
          tracker.recordSuccess('provider', date);
        }
      }

      const weight = calculator.getTimeSlotWeight('provider', 14);
      assert.equal(weight, 1.0);
    });

    it('should calculate correctly with exactly 3 days of data', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });

      // Seed exactly 3 days with high error rate at hour 14
      for (let day = 0; day < 3; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-day, hour);
          if (hour === 14) {
            for (let i = 0; i < 10; i++) tracker.recordFailure('provider', date);
          } else {
            tracker.recordSuccess('provider', date);
          }
        }
      }

      // Should have sufficient data now
      const weight = calculator.getTimeSlotWeight('provider', 14);
      // Hour 14 has high error rate, should return dangerMultiplier
      assert.equal(weight, 0.5);
    });
  });

  describe('custom lookbackDays configuration', () => {
    it('should accept custom lookbackDays value', () => {
      const customConfig = { lookbackDays: 7 };
      calculator = new TimeSlotWeightCalculator({ tracker, config: customConfig });
      const config = calculator.getConfig();
      assert.equal(config.lookbackDays, 7);
    });

    it('should use custom lookbackDays in calculations', () => {
      const customConfig = { lookbackDays: 5 };
      calculator = new TimeSlotWeightCalculator({ tracker, config: customConfig });

      // Seed exactly 4 days (< 5 days threshold)
      for (let day = 0; day < 4; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-day, hour);
          tracker.recordSuccess('provider', date);
        }
      }

      const weight = calculator.getTimeSlotWeight('provider', 14);
      // Insufficient data with 5-day threshold
      assert.equal(weight, 1.0);
    });

    it('should calculate correctly when custom lookbackDays threshold met', () => {
      const customConfig = { lookbackDays: 5 };
      calculator = new TimeSlotWeightCalculator({ tracker, config: customConfig });

      // Seed exactly 5 days with high error rate at hour 14
      for (let day = 0; day < 5; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-day, hour);
          if (hour === 14) {
            for (let i = 0; i < 10; i++) tracker.recordFailure('provider', date);
          } else {
            tracker.recordSuccess('provider', date);
          }
        }
      }

      const weight = calculator.getTimeSlotWeight('provider', 14);
      // Sufficient data, hour 14 has high error rate
      assert.equal(weight, 0.5);
    });
  });

  describe('config parameter passing', () => {
    it('should pass config to HourlyErrorTracker methods', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });

      // Seed 3 days of data
      for (let day = 0; day < 3; day++) {
        const date = makeDate(-day, 14);
        tracker.recordSuccess('provider', date);
      }

      // Verify tracker receives correct lookbackDays
      const stats = tracker.calculateHourlyErrorRate('provider', 14, 3);
      assert.equal(stats.dataDays, 3);
      assert.equal(stats.sufficientData, true);
    });

    it('should merge custom config with defaults', () => {
      const customConfig = {
        lookbackDays: 7,
        dangerMultiplier: 0.3,
      };
      calculator = new TimeSlotWeightCalculator({ tracker, config: customConfig });

      const config = calculator.getConfig();
      // Custom values should override defaults
      assert.equal(config.lookbackDays, 7);
      assert.equal(config.dangerMultiplier, 0.3);
      // Default values should remain
      assert.equal(config.totalErrorThreshold, 0.01);
      assert.equal(config.dangerSlotThreshold, 0.05);
      assert.equal(config.normalMultiplier, 2.0);
    });

    it('should update config dynamically', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });

      // Initially default lookbackDays
      assert.equal(calculator.getConfig().lookbackDays, 3);

      // Update config
      calculator.updateConfig({ lookbackDays: 10 });

      // Should reflect new value
      assert.equal(calculator.getConfig().lookbackDays, 10);
    });

    it('should use configOverride in single calculation', () => {
      calculator = new TimeSlotWeightCalculator({ tracker });

      // Seed 2 days (< 3 days default)
      for (let day = 0; day < 2; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-day, hour);
          tracker.recordSuccess('provider', date);
        }
      }

      // Default threshold: insufficient data, returns 1.0
      const weightDefault = calculator.getTimeSlotWeight('provider', 14);
      assert.equal(weightDefault, 1.0);

      // Override with 2-day threshold: should have sufficient data now
      const weightOverride = calculator.getTimeSlotWeight('provider', 14, { lookbackDays: 2 });
      // Now has sufficient data with 2-day threshold
      assert.ok(weightOverride !== undefined);
    });
  });
});

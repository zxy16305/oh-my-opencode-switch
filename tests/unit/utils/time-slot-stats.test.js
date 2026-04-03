import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import {
  HourlyErrorTracker,
  TimeSlotWeightCalculator,
} from '../../../src/utils/time-slot-stats.js';

function makeDate(daysOffset, hour) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour, 30, 0, 0);
  return date;
}

describe('HourlyErrorTracker', () => {
  let tracker;
  let tempPath;

  beforeEach(async () => {
    tempPath = path.join(os.tmpdir(), `test-time-slots-${Date.now()}.json`);
    process.env.PROXY_TIME_SLOTS_PATH = tempPath;
    tracker = new HourlyErrorTracker();
    tracker.dataFilePath = tempPath;
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempPath);
    } catch (e) {
      // ignore if not exists
    }
    delete process.env.PROXY_TIME_SLOTS_PATH;
  });

  describe('getHourKey', () => {
    it('should generate correct hour key in YYYY-MM-DD-HH format', () => {
      const date = new Date('2026-04-03T14:30:00');
      const key = tracker.getHourKey(date);
      assert.equal(key, '2026-04-03-14');
    });
  });

  describe('recordSuccess and recordFailure', () => {
    it('should record successful requests correctly', () => {
      const date = new Date('2026-04-03T14:30:00');
      tracker.recordSuccess('test-provider', date);

      const data = tracker.hourlyData.get('test-provider');
      assert.ok(data);

      const entry = data.get('2026-04-03-14');
      assert.ok(entry);
      assert.equal(entry.success, 1);
      assert.equal(entry.failure, 0);
    });

    it('should record failed requests correctly', () => {
      const date = new Date('2026-04-03T14:30:00');
      tracker.recordFailure('test-provider', date);

      const data = tracker.hourlyData.get('test-provider');
      const entry = data.get('2026-04-03-14');
      assert.equal(entry.success, 0);
      assert.equal(entry.failure, 1);
    });

    it('should accumulate multiple successes and failures', () => {
      const date = new Date('2026-04-03T14:30:00');
      tracker.recordSuccess('test-provider', date);
      tracker.recordSuccess('test-provider', date);
      tracker.recordFailure('test-provider', date);

      const data = tracker.hourlyData.get('test-provider');
      const entry = data.get('2026-04-03-14');
      assert.equal(entry.success, 2);
      assert.equal(entry.failure, 1);
    });
  });

  describe('calculateHourlyErrorRate', () => {
    it('should calculate correct error rate for a specific hour across multiple days', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = makeDate(-dayOffset, 14);
        for (let i = 0; i < 9; i++) tracker.recordSuccess('test-provider', date);
        tracker.recordFailure('test-provider', date);
      }

      const result = tracker.calculateHourlyErrorRate('test-provider', 14, 7);
      assert.equal(result.errorRate, 0.1);
      assert.equal(result.totalRequests, 70);
      assert.equal(result.sufficientData, true);
    });

    it('should return insufficient data when less than required days', () => {
      for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
        const date = makeDate(-dayOffset, 14);
        tracker.recordSuccess('test-provider', date);
      }

      const result = tracker.calculateHourlyErrorRate('test-provider', 14, 7);
      assert.equal(result.sufficientData, false);
    });

    it('should return zero error rate for unknown provider', () => {
      const result = tracker.calculateHourlyErrorRate('unknown-provider', 14, 7);
      assert.equal(result.errorRate, 0);
      assert.equal(result.totalRequests, 0);
      assert.equal(result.sufficientData, false);
    });
  });

  describe('calculateTotalErrorRate', () => {
    it('should calculate total error rate across all hours for last N days', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 12; hour++) {
          const date = makeDate(-dayOffset, hour);
          for (let i = 0; i < 9; i++) tracker.recordSuccess('test-provider', date);
          tracker.recordFailure('test-provider', date);
        }
      }

      const result = tracker.calculateTotalErrorRate('test-provider', 7);
      assert.equal(result.errorRate, 0.1);
      assert.equal(result.sufficientData, true);
    });

    it('should return zero error rate for provider with no data', () => {
      const result = tracker.calculateTotalErrorRate('no-data-provider', 7);
      assert.equal(result.errorRate, 0);
      assert.equal(result.sufficientData, false);
    });
  });

  describe('persistence', () => {
    it('should save and load data correctly', async () => {
      const date = makeDate(0, 14);
      tracker.recordSuccess('persist-provider', date);
      tracker.recordFailure('persist-provider', date);

      await tracker.save();

      const newTracker = new HourlyErrorTracker();
      newTracker.dataFilePath = tempPath;
      await newTracker.load();

      const result = newTracker.calculateTotalErrorRate('persist-provider', 7);
      assert.equal(result.errorRate, 0.5);
      assert.equal(result.totalRequests, 2);
    });
  });

  describe('cleanup', () => {
    it('should remove data older than specified days', () => {
      const recentDate = makeDate(0, 14);
      tracker.recordSuccess('recent-provider', recentDate);

      const oldDate = makeDate(-31, 14);
      tracker.recordSuccess('old-provider', oldDate);

      assert.equal(tracker.getProviders().length, 2);

      tracker.cleanup(30);

      assert.equal(tracker.getProviders().length, 1);
      assert.equal(tracker.getProviders()[0], 'recent-provider');
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      tracker.recordSuccess('provider-a', new Date());
      tracker.recordFailure('provider-b', new Date());

      assert.equal(tracker.getProviders().length, 2);

      tracker.reset();

      assert.equal(tracker.getProviders().length, 0);
    });
  });
});

describe('TimeSlotWeightCalculator', () => {
  let tracker;
  let calculator;

  beforeEach(() => {
    tracker = new HourlyErrorTracker();
    calculator = new TimeSlotWeightCalculator({ tracker });
  });

  describe('getTimeSlotWeight', () => {
    it('should return 1.0 for providers with total error rate < 1%', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-dayOffset, hour);
          for (let i = 0; i < 1000; i++) tracker.recordSuccess('provider-a', date);
          tracker.recordFailure('provider-a', date);
        }
      }

      const weight = calculator.getTimeSlotWeight('provider-a', 14);
      assert.equal(weight, 1.0);
    });

    it('should return 0.5 for danger zones (error rate > 5%)', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-dayOffset, hour);
          tracker.recordFailure('provider-b', date);
        }

        const badDate = makeDate(-dayOffset, 14);
        for (let i = 0; i < 84; i++) tracker.recordSuccess('provider-b', badDate);
        for (let i = 0; i < 15; i++) tracker.recordFailure('provider-b', badDate);
      }

      const weight = calculator.getTimeSlotWeight('provider-b', 14);
      assert.equal(weight, 0.5);
    });

    it('should return 2.0 for normal zones (error rate <= 5%)', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
          if (hour !== 2) {
            const date = makeDate(-dayOffset, hour);
            for (let i = 0; i < 10; i++) tracker.recordFailure('provider-c', date);
          }
        }

        const goodDate = makeDate(-dayOffset, 2);
        for (let i = 0; i < 100; i++) tracker.recordSuccess('provider-c', goodDate);
      }

      const weight = calculator.getTimeSlotWeight('provider-c', 2);
      assert.equal(weight, 2.0);
    });

    it('should return 1.0 for insufficient data', () => {
      const weight = calculator.getTimeSlotWeight('unknown-provider', 14);
      assert.equal(weight, 1.0);
    });
  });

  describe('config updates', () => {
    it('should allow overriding config parameters', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-dayOffset, hour);
          tracker.recordFailure('provider-d', date);
        }

        const badDate = makeDate(-dayOffset, 14);
        for (let i = 0; i < 84; i++) tracker.recordSuccess('provider-d', badDate);
        for (let i = 0; i < 15; i++) tracker.recordFailure('provider-d', badDate);
      }

      const customConfig = {
        totalErrorThreshold: 0.05,
        dangerSlotThreshold: 0.1,
        dangerMultiplier: 0.7,
        normalMultiplier: 1.5,
      };

      const customCalculator = new TimeSlotWeightCalculator({ tracker, config: customConfig });

      const weight = customCalculator.getTimeSlotWeight('provider-d', 14);
      assert.equal(weight, 0.7);
    });
  });

  describe('getAllHourWeights', () => {
    it('should return weights for all 24 hours', () => {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        for (let hour = 0; hour < 24; hour++) {
          const date = makeDate(-dayOffset, hour);
          tracker.recordSuccess('provider-e', date);
        }
      }

      const weights = calculator.getAllHourWeights('provider-e');
      assert.equal(weights.length, 24);
      assert.ok(weights.every((w) => typeof w.hour === 'number'));
      assert.ok(weights.every((w) => typeof w.weight === 'number'));
    });
  });
});

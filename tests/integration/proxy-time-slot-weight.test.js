/**
 * Integration tests for time slot weight feature.
 *
 * Verifies:
 * - HourlyErrorTracker → TimeSlotWeightCalculator weight calculation pipeline
 * - Multiple providers get correct weight adjustments at different hours
 * - 24-hour balanced distribution patterns
 * - Enabled vs disabled behavior differences via router config
 * - Configuration parameters take effect correctly
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetAllState,
  routeRequest,
  getUpstreamRequestCounts,
  validateRoutesConfig,
} from '../../src/proxy/router.js';
import {
  HourlyErrorTracker,
  TimeSlotWeightCalculator,
  createTimeSlotWeightCalculator,
} from '../../src/utils/time-slot-stats.js';

import { makeUpstream, makeMockRequest } from '../helpers/proxy-fixtures.js';

const defaultTimeSlotWeightConfig = {
  enabled: false,
  totalErrorThreshold: 0.01,
  dangerSlotThreshold: 0.05,
  dangerMultiplier: 0.5,
  normalMultiplier: 2.0,
  lookbackDays: 7,
};

function makeRoute(upstreams, overrides = {}) {
  return {
    strategy: 'sticky',
    upstreams,
    stickyReassignThreshold: 10,
    stickyReassignMinGap: 2,
    dynamicWeight: {
      enabled: false,
      initialWeight: 100,
      minWeight: 10,
      checkInterval: 10,
      latencyThreshold: 1.5,
      recoveryInterval: 300000,
      recoveryAmount: 1,
      errorWeightReduction: {
        enabled: false,
        errorCodes: [429, 500, 502, 503, 504],
        reductionAmount: 10,
        minWeight: 5,
        errorWindowMs: 3600000,
      },
    },
    timeSlotWeight: {
      ...defaultTimeSlotWeightConfig,
      ...(overrides.timeSlotWeight || {}),
    },
    ...overrides,
  };
}

// Seed tracker with 7 days of hourly data for a provider.
// `pattern` is a function(hour) => { success: N, failure: N }
function seedProvider(tracker, provider, pattern) {
  const now = new Date();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, hour, 0, 0, 0);
      const { success, failure } = pattern(hour);
      for (let i = 0; i < success; i++) tracker.recordSuccess(provider, ts);
      for (let i = 0; i < failure; i++) tracker.recordFailure(provider, ts);
    }
  }
}

// Pattern helpers
const alwaysGood = () => ({ success: 100, failure: 0 });
const dangerHours =
  (hours, dangerFail = 20, normalFail = 5) =>
  (h) =>
    hours.includes(h)
      ? { success: 100 - dangerFail, failure: dangerFail }
      : { success: 100 - normalFail, failure: normalFail };
const normalHours =
  (hours, boostFail = 0, otherFail = 10) =>
  (h) =>
    hours.includes(h)
      ? { success: 100 - boostFail, failure: boostFail }
      : { success: 100 - otherFail, failure: otherFail };

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Time Slot Weight Feature', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  // -----------------------------------------------------------------------
  // 1. Calculator + Tracker pipeline
  // -----------------------------------------------------------------------
  describe('Calculator → Tracker weight pipeline', () => {
    test('total error < 1% always yields weight 1.0', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      seedProvider(tracker, 'stable', (h) =>
        h === 14 ? { success: 99, failure: 1 } : { success: 100, failure: 0 }
      );

      for (let h = 0; h < 24; h++) {
        assert.strictEqual(calc.getTimeSlotWeight('stable', h), 1.0);
      }
    });

    test('danger hour yields 0.5 multiplier', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      // Total error rate ≈ 7.8%  (> 1% threshold)
      // Hour 14: 20% error rate (> 5% → danger)
      seedProvider(tracker, 'risky', dangerHours([14], 20, 5));

      assert.strictEqual(calc.getTimeSlotWeight('risky', 14), 0.5);
    });

    test('normal hour yields 2.0 multiplier', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      // Total error rate ≈ 7.8%  (> 1% threshold)
      // Hour 2: 0% error rate (≤ 5% → normal)
      seedProvider(tracker, 'risky', normalHours([2, 3, 4], 0, 10));

      assert.strictEqual(calc.getTimeSlotWeight('risky', 2), 2.0);
    });

    test('insufficient data (< 3 days) yields 1.0', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      const now = new Date();
      for (let day = 0; day < 2; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, hour);
          for (let i = 0; i < 50; i++) tracker.recordSuccess('cold', ts);
          for (let i = 0; i < 50; i++) tracker.recordFailure('cold', ts);
        }
      }

      assert.strictEqual(calc.getTimeSlotWeight('cold', 14), 1.0);
    });

    test('unknown provider yields 1.0', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      assert.strictEqual(calc.getTimeSlotWeight('nonexistent', 14), 1.0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. 24-hour traffic simulation through calculator
  // -----------------------------------------------------------------------
  describe('24-hour weight profile simulation', () => {
    test('provider with danger hours 9-11 & 14-16, normal hours 2-4', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      const DANGER_HOURS = [9, 10, 11, 14, 15, 16];
      const NORMAL_HOURS = [2, 3, 4];

      seedProvider(tracker, 'pattern', (h) => {
        if (DANGER_HOURS.includes(h)) return { success: 85, failure: 15 };
        if (NORMAL_HOURS.includes(h)) return { success: 100, failure: 0 };
        return { success: 95, failure: 5 };
      });

      // Verify danger hours get 0.5
      for (const h of DANGER_HOURS) {
        assert.strictEqual(calc.getTimeSlotWeight('pattern', h), 0.5, `Hour ${h} should be danger`);
      }

      // Verify normal hours get 2.0
      for (const h of NORMAL_HOURS) {
        assert.strictEqual(calc.getTimeSlotWeight('pattern', h), 2.0, `Hour ${h} should be normal`);
      }

      // Verify other hours (5% error, which is ≤ 5% threshold → 2.0)
      const otherHours = Array.from({ length: 24 }, (_, i) => i).filter(
        (h) => !DANGER_HOURS.includes(h) && !NORMAL_HOURS.includes(h)
      );
      for (const h of otherHours) {
        assert.strictEqual(
          calc.getTimeSlotWeight('pattern', h),
          2.0,
          `Hour ${h} should be normal (5%)`
        );
      }
    });

    test('expected traffic distribution at danger vs normal hours', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      // Provider-A: low error (always 1.0)
      seedProvider(tracker, 'low-error', alwaysGood);

      // Provider-B: high total error, danger at 14:00, normal at 02:00
      seedProvider(tracker, 'high-error', (h) => {
        if (h === 14) return { success: 80, failure: 20 };
        return { success: 95, failure: 5 };
      });

      // At 14:00: low-error=1.0, high-error=0.5 → effective weights 100:50
      const weightA14 = calc.getTimeSlotWeight('low-error', 14);
      const weightB14 = calc.getTimeSlotWeight('high-error', 14);
      assert.strictEqual(weightA14, 1.0);
      assert.strictEqual(weightB14, 0.5);

      const ratio14 = (100 * weightA14) / (100 * weightA14 + 100 * weightB14);
      assert.ok(
        ratio14 > 0.6 && ratio14 < 0.7,
        `At 14:00 low-error should get ~66.7%, calculated ${(ratio14 * 100).toFixed(1)}%`
      );

      // At 02:00: low-error=1.0, high-error=2.0 → effective weights 100:200
      const weightA02 = calc.getTimeSlotWeight('low-error', 2);
      const weightB02 = calc.getTimeSlotWeight('high-error', 2);
      assert.strictEqual(weightA02, 1.0);
      assert.strictEqual(weightB02, 2.0);

      const ratio02 = (100 * weightA02) / (100 * weightA02 + 100 * weightB02);
      assert.ok(
        ratio02 > 0.28 && ratio02 < 0.38,
        `At 02:00 low-error should get ~33.3%, calculated ${(ratio02 * 100).toFixed(1)}%`
      );
    });
  });

  // -----------------------------------------------------------------------
  // 3. Multiple providers with different patterns
  // -----------------------------------------------------------------------
  describe('Multiple providers with distinct error patterns', () => {
    test('three providers get correct weights at different hours', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      // Provider-low: 0% error → always 1.0
      seedProvider(tracker, 'provider-low', alwaysGood);

      // Provider-peak: danger at 14-16, good elsewhere → 0.5 at 15, 2.0 at 3
      seedProvider(tracker, 'provider-peak', dangerHours([14, 15, 16], 20, 5));

      // Provider-night: good at 2-4, bad elsewhere → 2.0 at 3, 0.5 at 15
      seedProvider(tracker, 'provider-night', normalHours([2, 3, 4], 0, 10));

      // At 15:00
      const w15 = {
        low: calc.getTimeSlotWeight('provider-low', 15),
        peak: calc.getTimeSlotWeight('provider-peak', 15),
        night: calc.getTimeSlotWeight('provider-night', 15),
      };
      assert.strictEqual(w15.low, 1.0);
      assert.strictEqual(w15.peak, 0.5, 'provider-peak should be danger at 15:00');
      assert.strictEqual(w15.night, 0.5, 'provider-night should be danger at 15:00');

      // At 03:00
      const w03 = {
        low: calc.getTimeSlotWeight('provider-low', 3),
        peak: calc.getTimeSlotWeight('provider-peak', 3),
        night: calc.getTimeSlotWeight('provider-night', 3),
      };
      assert.strictEqual(w03.low, 1.0);
      assert.strictEqual(w03.peak, 2.0, 'provider-peak should be normal at 03:00');
      assert.strictEqual(w03.night, 2.0, 'provider-night should be normal at 03:00');

      console.log('15:00 weights:', w15, '03:00 weights:', w03);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Router config: enabled vs disabled
  // -----------------------------------------------------------------------
  describe('Router config: enabled vs disabled', () => {
    test('disabled config: traffic splits ~50/50 regardless of provider error', () => {
      const upstreams = [
        makeUpstream({ id: 'pa', provider: 'good-p', weight: 100 }),
        makeUpstream({ id: 'pb', provider: 'bad-p', weight: 100 }),
      ];
      const route = makeRoute(upstreams, {
        timeSlotWeight: { enabled: false },
      });
      const config = { 'lb-off': route };

      const N = 200;
      for (let i = 0; i < N; i++) {
        routeRequest('lb-off', config, makeMockRequest(`s-${i}`), null);
      }

      const counts = getUpstreamRequestCounts().get('lb-off');
      const dist = {};
      for (const [id, c] of counts) dist[id] = (c / N) * 100;

      assert.ok(
        dist['pa'] >= 40 && dist['pa'] <= 60,
        `pa should get ~50% when disabled, got ${dist['pa']?.toFixed(2)}%`
      );
      assert.ok(
        dist['pb'] >= 40 && dist['pb'] <= 60,
        `pb should get ~50% when disabled, got ${dist['pb']?.toFixed(2)}%`
      );
    });

    test('enabled config with no tracker data: traffic still splits ~50/50', () => {
      const upstreams = [
        makeUpstream({ id: 'pa', provider: 'good-p', weight: 100 }),
        makeUpstream({ id: 'pb', provider: 'bad-p', weight: 100 }),
      ];
      const route = makeRoute(upstreams, {
        timeSlotWeight: {
          enabled: true,
          totalErrorThreshold: 0.01,
          dangerSlotThreshold: 0.05,
          dangerMultiplier: 0.5,
          normalMultiplier: 2.0,
          lookbackDays: 7,
        },
      });
      const config = { 'lb-empty': route };

      const N = 200;
      for (let i = 0; i < N; i++) {
        routeRequest('lb-empty', config, makeMockRequest(`s-${i}`), null);
      }

      const counts = getUpstreamRequestCounts().get('lb-empty');
      const dist = {};
      for (const [id, c] of counts) dist[id] = (c / N) * 100;

      // With no historical data, both providers get weight 1.0
      assert.ok(
        dist['pa'] >= 40 && dist['pa'] <= 60,
        `pa should get ~50% with empty data, got ${dist['pa']?.toFixed(2)}%`
      );
      assert.ok(
        dist['pb'] >= 40 && dist['pb'] <= 60,
        `pb should get ~50% with empty data, got ${dist['pb']?.toFixed(2)}%`
      );
    });

    test('route config validation accepts timeSlotWeight', () => {
      const config = {
        'lb-test': makeRoute([makeUpstream()], {
          timeSlotWeight: {
            enabled: true,
            totalErrorThreshold: 0.01,
            dangerSlotThreshold: 0.05,
            dangerMultiplier: 0.5,
            normalMultiplier: 2.0,
            lookbackDays: 7,
          },
        }),
      };

      const result = validateRoutesConfig(config);
      assert.ok(result.success, `Config validation should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].timeSlotWeight.enabled, true);
    });

    test('route config defaults timeSlotWeight.enabled to true', () => {
      const config = {
        'lb-test': {
          strategy: 'sticky',
          upstreams: [makeUpstream()],
        },
      };

      const result = validateRoutesConfig(config);
      assert.ok(result.success);
      assert.strictEqual(result.data['lb-test'].timeSlotWeight.enabled, true);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Configuration parameters override
  // -----------------------------------------------------------------------
  describe('Configuration parameters', () => {
    test('strict thresholds trigger danger; lenient thresholds do not', () => {
      const tracker = new HourlyErrorTracker();

      // 4% error at hour 10, 0% elsewhere → total error ≈ 4/24 = 0.17%
      seedProvider(tracker, 'custom', (h) =>
        h === 10 ? { success: 96, failure: 4 } : { success: 100, failure: 0 }
      );

      // Strict config: totalError 0.5%, dangerSlot 3%
      // Total error 0.17% < 0.5% → 1.0
      const strict = createTimeSlotWeightCalculator({
        tracker,
        config: {
          totalErrorThreshold: 0.005,
          dangerSlotThreshold: 0.03,
          dangerMultiplier: 0.3,
          normalMultiplier: 3.0,
        },
      });
      assert.strictEqual(strict.getTimeSlotWeight('custom', 10), 1.0);

      // Ultra-strict: totalError 0.001%, dangerSlot 3%
      // Total error 0.17% > 0.001% → check hourly
      // Hour 10: 4% > 3% → danger
      const ultraStrict = createTimeSlotWeightCalculator({
        tracker,
        config: {
          totalErrorThreshold: 0.00001,
          dangerSlotThreshold: 0.03,
          dangerMultiplier: 0.3,
          normalMultiplier: 3.0,
        },
      });
      assert.strictEqual(ultraStrict.getTimeSlotWeight('custom', 10), 0.3);

      // Lenient: totalError 5%, dangerSlot 10%
      // Total error 0.17% < 5% → 1.0
      const lenient = createTimeSlotWeightCalculator({
        tracker,
        config: {
          totalErrorThreshold: 0.05,
          dangerSlotThreshold: 0.1,
          dangerMultiplier: 0.7,
          normalMultiplier: 1.5,
        },
      });
      assert.strictEqual(lenient.getTimeSlotWeight('custom', 10), 1.0);
    });

    test('getAllHourWeights returns correct 24-hour profile', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      seedProvider(tracker, 'profile', (h) => {
        if (h >= 9 && h <= 11) return { success: 80, failure: 20 };
        if (h >= 2 && h <= 4) return { success: 100, failure: 0 };
        return { success: 95, failure: 5 };
      });

      const weights = calc.getAllHourWeights('profile');
      assert.strictEqual(weights.length, 24);

      // Danger hours
      for (const h of [9, 10, 11]) {
        assert.strictEqual(weights[h].weight, 0.5, `Hour ${h}`);
        assert.ok(weights[h].errorRate > 0.05, `Hour ${h} errorRate > 5%`);
      }

      // Normal hours
      for (const h of [2, 3, 4]) {
        assert.strictEqual(weights[h].weight, 2.0, `Hour ${h}`);
        assert.strictEqual(weights[h].errorRate, 0, `Hour ${h} errorRate = 0`);
      }

      // Other hours (5% error ≤ 5% threshold → 2.0)
      for (const w of weights) {
        if (![9, 10, 11].includes(w.hour)) {
          assert.strictEqual(w.weight, 2.0, `Hour ${w.hour} should be normal`);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // 6. Edge cases
  // -----------------------------------------------------------------------
  describe('Edge cases', () => {
    test('tracker persists and loads data correctly', async () => {
      const tracker = new HourlyErrorTracker();

      seedProvider(tracker, 'persist-test', (h) =>
        h === 14 ? { success: 80, failure: 20 } : { success: 95, failure: 5 }
      );

      // Save to file
      await tracker.save();

      // Load into new tracker
      const tracker2 = new HourlyErrorTracker();
      await tracker2.load();

      const calc = new TimeSlotWeightCalculator({ tracker: tracker2 });
      assert.strictEqual(calc.getTimeSlotWeight('persist-test', 14), 0.5);
      assert.strictEqual(calc.getTimeSlotWeight('persist-test', 2), 2.0);

      // Cleanup the persisted file
      const { exists } = await import('../../src/utils/files.js');
      const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
      const fs = await import('node:fs/promises');
      const path = getProxyTimeSlotsPath();
      if (await exists(path)) {
        await fs.unlink(path);
      }
    });

    test('calculator.updateConfig changes behavior', () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      seedProvider(tracker, 'config-change', dangerHours([14], 20, 5));

      // Default config: danger at 14
      assert.strictEqual(calc.getTimeSlotWeight('config-change', 14), 0.5);

      // Make dangerSlot threshold very high → hour 14 no longer danger
      calc.updateConfig({ dangerSlotThreshold: 0.5 });
      assert.strictEqual(calc.getTimeSlotWeight('config-change', 14), 2.0);

      // Restore
      calc.updateConfig({ dangerSlotThreshold: 0.05 });
      assert.strictEqual(calc.getTimeSlotWeight('config-change', 14), 0.5);
    });

    test('tracker cleanup removes old data', () => {
      const tracker = new HourlyErrorTracker();

      // Add old data (40 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);
      oldDate.setHours(14, 0, 0, 0);
      for (let i = 0; i < 100; i++) tracker.recordSuccess('old-provider', oldDate);

      // Add recent data
      seedProvider(tracker, 'old-provider', (h) =>
        h === 14 ? { success: 80, failure: 20 } : { success: 95, failure: 5 }
      );

      // Cleanup old data
      tracker.cleanup(30);

      // Should still have recent data
      const calc = new TimeSlotWeightCalculator({ tracker });
      assert.strictEqual(calc.getTimeSlotWeight('old-provider', 14), 0.5);
    });
  });

  // -----------------------------------------------------------------------
  // 7. CLI command: oos proxy time-slots
  // -----------------------------------------------------------------------
  describe('CLI command: oos proxy time-slots', () => {
    test('CLI shows correct stats for providers with different error patterns', async () => {
      const tracker = new HourlyErrorTracker();
      const calc = new TimeSlotWeightCalculator({ tracker });

      // Provider-low: always good
      seedProvider(tracker, 'provider-low', alwaysGood);

      // Provider-danger: danger at hour 14
      seedProvider(tracker, 'provider-danger', dangerHours([14], 20, 5));

      // Provider-normal: good at hour 2
      seedProvider(tracker, 'provider-normal', normalHours([2, 3, 4], 0, 10));

      // Save to persist the data
      await tracker.save();

      // Import CLI action
      const { timeSlotsAction } = await import('../../src/commands/proxy.js');

      // Mock console.table and console.log to capture output
      const tableOutput = [];
      const logOutput = [];
      const originalTable = console.table;
      const originalLog = console.log;

      console.table = (data) => {
        tableOutput.push(data);
      };
      console.log = (msg) => {
        logOutput.push(msg);
      };

      try {
        // Call CLI action (no provider filter)
        await timeSlotsAction({});

        // Verify table output
        assert.ok(tableOutput.length > 0, 'Should output table data');

        const tableData = tableOutput[0];
        assert.ok(Array.isArray(tableData), 'Table data should be an array');

        // Find each provider in the table
        const lowRow = tableData.find((r) => r.Provider === 'provider-low');
        const dangerRow = tableData.find((r) => r.Provider === 'provider-danger');
        const normalRow = tableData.find((r) => r.Provider === 'provider-normal');

        assert.ok(lowRow, 'Should have provider-low row');
        assert.ok(dangerRow, 'Should have provider-danger row');
        assert.ok(normalRow, 'Should have provider-normal row');

        // Verify low provider: weight should be 1.0 (total error < 1%)
        assert.strictEqual(lowRow['Weight Coeff'], '1.00', 'provider-low should have weight 1.00');

        // Verify danger provider at current hour
        const currentHour = calc.getCurrentHour();
        const expectedDangerWeight = currentHour === 14 ? '0.50' : '2.00';
        assert.strictEqual(
          dangerRow['Weight Coeff'],
          expectedDangerWeight,
          `provider-danger weight at hour ${currentHour} should match expected`
        );

        // Verify normal provider at current hour
        const expectedNormalWeight = [2, 3, 4].includes(currentHour) ? '2.00' : '0.50';
        assert.strictEqual(
          normalRow['Weight Coeff'],
          expectedNormalWeight,
          `provider-normal weight at hour ${currentHour} should match expected`
        );

        // Verify log output contains key information
        assert.ok(
          logOutput.some((msg) => msg.includes('Time Slot Statistics')),
          'Should show title'
        );
        assert.ok(
          logOutput.some((msg) => msg.includes('Weight coefficients')),
          'Should show weight legend'
        );
        assert.ok(
          logOutput.some((msg) => msg.includes('Current hour')),
          'Should show current hour'
        );
      } finally {
        // Restore console methods
        console.table = originalTable;
        console.log = originalLog;

        // Cleanup the persisted file
        const { exists } = await import('../../src/utils/files.js');
        const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
        const fs = await import('node:fs/promises');
        const path = getProxyTimeSlotsPath();
        if (await exists(path)) {
          await fs.unlink(path);
        }
      }
    });

    test('CLI with provider filter shows only specified provider', async () => {
      const tracker = new HourlyErrorTracker();

      seedProvider(tracker, 'provider-a', alwaysGood);
      seedProvider(tracker, 'provider-b', dangerHours([14], 20, 5));

      await tracker.save();

      const { timeSlotsAction } = await import('../../src/commands/proxy.js');

      const tableOutput = [];
      const originalTable = console.table;
      console.table = (data) => {
        tableOutput.push(data);
      };

      try {
        // Call CLI action with provider filter
        await timeSlotsAction({ provider: 'provider-a' });

        const tableData = tableOutput[0];
        assert.ok(Array.isArray(tableData), 'Table data should be an array');
        assert.strictEqual(tableData.length, 1, 'Should show only one provider');
        assert.strictEqual(tableData[0].Provider, 'provider-a', 'Should show provider-a');
      } finally {
        console.table = originalTable;

        const { exists } = await import('../../src/utils/files.js');
        const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
        const fs = await import('node:fs/promises');
        const path = getProxyTimeSlotsPath();
        if (await exists(path)) {
          await fs.unlink(path);
        }
      }
    });

    test('CLI handles no data gracefully', async () => {
      // Clean up any existing data before test
      const { exists } = await import('../../src/utils/files.js');
      const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
      const fs = await import('node:fs/promises');
      const dataPath = getProxyTimeSlotsPath();
      if (await exists(dataPath)) {
        await fs.unlink(dataPath);
      }

      // Create empty data file to ensure tracker has no providers
      const { writeJson } = await import('../../src/utils/files.js');
      await writeJson(dataPath, { providers: {}, lastUpdated: new Date().toISOString() });

      const { timeSlotsAction } = await import('../../src/commands/proxy.js');
      const { logger } = await import('../../src/utils/logger.js');

      // Ensure logger is not silent
      const originalSilent = logger.silent;
      logger.silent = false;

      const logOutput = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logOutput.push(args.join(' '));
      };

      try {
        await timeSlotsAction({}); // timeSlotsAction calls load() which loads empty data

        assert.ok(
          logOutput.some((msg) => msg.toString().includes('time slot data available')),
          'Should show no data message'
        );
      } finally {
        console.log = originalLog;
        logger.silent = originalSilent;

        if (await exists(dataPath)) {
          await fs.unlink(dataPath);
        }
      }
    });

    test('CLI handles nonexistent provider filter gracefully', async () => {
      // Clean up any existing data before test
      const { exists } = await import('../../src/utils/files.js');
      const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
      const fs = await import('node:fs/promises');
      const dataPath = getProxyTimeSlotsPath();
      if (await exists(dataPath)) {
        await fs.unlink(dataPath);
      }

      const tracker = new HourlyErrorTracker();
      seedProvider(tracker, 'provider-a', alwaysGood);
      await tracker.save();

      const { timeSlotsAction } = await import('../../src/commands/proxy.js');
      const { logger } = await import('../../src/utils/logger.js');

      // Ensure logger is not silent
      const originalSilent = logger.silent;
      logger.silent = false;

      const logOutput = [];
      const warnOutput = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = (...args) => {
        logOutput.push(args.join(' '));
      };
      console.warn = (...args) => {
        warnOutput.push(args.join(' '));
      };

      try {
        await timeSlotsAction({ provider: 'nonexistent-provider' }); // load() loads the seeded data

        assert.ok(
          warnOutput.some((msg) => msg.toString().includes('not found')),
          'Should show provider not found warning'
        );
        assert.ok(
          logOutput.some((msg) => msg.includes('Available providers')),
          'Should show available providers'
        );
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
        logger.silent = originalSilent;

        const { exists } = await import('../../src/utils/files.js');
        const { getProxyTimeSlotsPath } = await import('../../src/utils/proxy-paths.js');
        const fs = await import('node:fs/promises');
        const path = getProxyTimeSlotsPath();
        if (await exists(path)) {
          await fs.unlink(path);
        }
      }
    });
  });
});

// tests/proxy/unit/stats-collector-perf.test.js
// Performance regression tests for sliding window functions in stats-collector.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  recordUpstreamError,
  getErrorCountInWindow,
  recordUpstreamLatency,
  getLatencyAvg,
  getUpstreamRequestCountInWindow,
  calculatePercentile,
  incrementUpstreamRequestCount,
} from '../../../src/proxy/stats-collector.js';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

describe('stats-collector performance tests', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('getErrorCountInWindow', () => {
    it('should return 0 for empty state', () => {
      const sm = createStateManager();
      const rate = getErrorCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(rate, 0);
    });

    it('should return correct count with 1500 errors (500 in window, 1000 outside)', () => {
      const sm = createStateManager();
      const now = Date.now();
      const windowMs = 3600000; // 1 hour

      // Insert 1000 errors outside the window
      for (let i = 0; i < 1000; i++) {
        const entry = sm.errorState;
        const key = 'route-1:upstream-1';
        if (!entry.has(key)) {
          entry.set(key, { errors: [] });
        }
        entry.get(key).errors.push({
          timestamp: now - windowMs - 1000 - i,
          statusCode: 500,
        });
      }

      // Insert 500 errors inside the window
      for (let i = 0; i < 500; i++) {
        recordUpstreamError(sm, 'route-1', 'upstream-1', 500);
      }

      const rate = getErrorCountInWindow(sm, 'route-1', 'upstream-1', windowMs);
      assert.strictEqual(rate, 500);
    });

    it('should return all errors when all are within window', () => {
      const sm = createStateManager();
      for (let i = 0; i < 100; i++) {
        recordUpstreamError(sm, 'route-1', 'upstream-1', 500);
      }
      const rate = getErrorCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(rate, 100);
    });

    it('should return 0 when all errors are outside window', () => {
      const sm = createStateManager();
      const now = Date.now();
      const entry = sm.errorState;
      const key = 'route-1:upstream-1';
      entry.set(key, { errors: [] });
      for (let i = 0; i < 50; i++) {
        entry.get(key).errors.push({
          timestamp: now - 7200000 - i, // 2 hours ago
          statusCode: 500,
        });
      }
      const rate = getErrorCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(rate, 0);
    });

    it('should not mutate source data incorrectly across multiple calls', () => {
      const sm = createStateManager();
      for (let i = 0; i < 50; i++) {
        recordUpstreamError(sm, 'route-1', 'upstream-1', 500);
      }

      const first = getErrorCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      const second = getErrorCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      // Second call should return same count since all are still in window
      assert.strictEqual(first, second);
    });
  });

  describe('getLatencyAvg', () => {
    it('should return 0 for empty state', () => {
      const sm = createStateManager();
      const avg = getLatencyAvg(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(avg, 0);
    });

    it('should return correct average with 1500 latencies mixed in/out of window', () => {
      const sm = createStateManager();
      const now = Date.now();
      const windowMs = 3600000; // 1 hour

      // Insert 1000 latencies outside the window
      const latencyState = sm.latencyState;
      const key = 'route-1:upstream-1';
      latencyState.set(key, { latencies: [] });
      for (let i = 0; i < 1000; i++) {
        latencyState.get(key).latencies.push({
          timestamp: now - windowMs - 1000 - i,
          duration: 200, // These should be filtered out
        });
      }

      // Insert 500 latencies inside the window with duration 100
      for (let i = 0; i < 500; i++) {
        recordUpstreamLatency(sm, 'route-1', 'upstream-1', 50, 100);
      }

      const avg = getLatencyAvg(sm, 'route-1', 'upstream-1', windowMs);
      assert.strictEqual(avg, 100);
    });

    it('should return correct average for normal data', () => {
      const sm = createStateManager();
      recordUpstreamLatency(sm, 'route-1', 'upstream-1', 50, 100);
      recordUpstreamLatency(sm, 'route-1', 'upstream-1', 50, 200);
      recordUpstreamLatency(sm, 'route-1', 'upstream-1', 50, 300);
      const avg = getLatencyAvg(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(avg, 200);
    });

    it('should not mutate source data incorrectly across multiple calls', () => {
      const sm = createStateManager();
      for (let i = 0; i < 100; i++) {
        recordUpstreamLatency(sm, 'route-1', 'upstream-1', 50, 100);
      }

      const first = getLatencyAvg(sm, 'route-1', 'upstream-1', 3600000);
      const second = getLatencyAvg(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(first, second);
    });
  });

  describe('getUpstreamRequestCountInWindow', () => {
    it('should return 0 for empty state', () => {
      const sm = createStateManager();
      const count = getUpstreamRequestCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(count, 0);
    });

    it('should count only recent timestamps with many entries', () => {
      const sm = createStateManager();
      const now = Date.now();
      const windowMs = 3600000; // 1 hour
      const key = 'route-1:upstream-1';

      // Insert 1000 timestamps outside the window
      const slidingWindow = sm.upstreamSlidingWindowCounts;
      slidingWindow.set(key, []);
      for (let i = 0; i < 1000; i++) {
        slidingWindow.get(key).push({ timestamp: now - windowMs - 1000 - i });
      }

      // Insert 500 timestamps inside the window
      for (let i = 0; i < 500; i++) {
        incrementUpstreamRequestCount(sm, 'route-1', 'upstream-1');
      }

      const count = getUpstreamRequestCountInWindow(sm, 'route-1', 'upstream-1', windowMs);
      assert.strictEqual(count, 500);
    });

    it('should return correct count for normal data', () => {
      const sm = createStateManager();
      for (let i = 0; i < 10; i++) {
        incrementUpstreamRequestCount(sm, 'route-1', 'upstream-1');
      }
      const count = getUpstreamRequestCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(count, 10);
    });

    it('should not mutate source data incorrectly across multiple calls', () => {
      const sm = createStateManager();
      for (let i = 0; i < 100; i++) {
        incrementUpstreamRequestCount(sm, 'route-1', 'upstream-1');
      }

      const first = getUpstreamRequestCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      const second = getUpstreamRequestCountInWindow(sm, 'route-1', 'upstream-1', 3600000);
      assert.strictEqual(first, second);
    });
  });

  describe('calculatePercentile', () => {
    it('should return 0 for empty array', () => {
      assert.strictEqual(calculatePercentile([], 95), 0);
      assert.strictEqual(calculatePercentile(null, 95), 0);
      assert.strictEqual(calculatePercentile(undefined, 95), 0);
    });

    it('should return correct percentile for 1000-element array', () => {
      const arr = [];
      for (let i = 1; i <= 1000; i++) {
        arr.push(i);
      }
      const p95 = calculatePercentile(arr, 95);
      // For 1000 elements, p95 index = ceil(0.95 * 1000) - 1 = 950 - 1 = 949
      // arr[949] = 950 (since arr is 1-indexed values)
      assert.strictEqual(p95, 950);
    });

    it('should return consistent results across 5 calls', () => {
      const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(calculatePercentile(arr, 95));
      }
      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        assert.strictEqual(results[0], results[i]);
      }
    });

    it('should not mutate source array', () => {
      const arr = [5, 3, 1, 4, 2];
      const original = [...arr];
      calculatePercentile(arr, 95);
      assert.deepStrictEqual(arr, original);
    });

    it('should calculate correct p99 for large array', () => {
      const arr = [];
      for (let i = 1; i <= 1000; i++) {
        arr.push(i);
      }
      const p99 = calculatePercentile(arr, 99);
      // p99 index = ceil(0.99 * 1000) - 1 = 990 - 1 = 989
      // arr[989] = 990
      assert.strictEqual(p99, 990);
    });

    it('should handle single element array', () => {
      assert.strictEqual(calculatePercentile([42], 95), 42);
      assert.strictEqual(calculatePercentile([42], 50), 42);
      assert.strictEqual(calculatePercentile([42], 0), 42);
    });
  });
});

/**
 * Unit tests for dashboard memory statistics
 * @module tests/unit/dashboard-stats.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { recordUpstreamStats, getUpstreamStats, resetAllState } from '../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard Memory Statistics', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  it('should record TTFB and duration for successful requests', () => {
    const routeKey = 'test-model';
    const upstreamId = 'test-upstream';

    // Record 5 test samples
    const testData = [
      { ttfb: 50, duration: 500 },
      { ttfb: 60, duration: 600 },
      { ttfb: 70, duration: 700 },
      { ttfb: 80, duration: 800 },
      { ttfb: 90, duration: 900 },
    ];

    testData.forEach((data) => {
      recordUpstreamStats(routeKey, upstreamId, data.ttfb, data.duration, false);
    });

    const stats = getUpstreamStats(routeKey, upstreamId);

    assert.strictEqual(stats.sampleCount, 5);
    assert.strictEqual(stats.avgTtfb, 70); // (50+60+70+80+90)/5
    assert.strictEqual(stats.avgDuration, 700);
    assert.ok(stats.ttfbP95 > 0);
    assert.ok(stats.ttfbP99 > 0);
    assert.ok(stats.durationP95 > 0);
    assert.ok(stats.durationP99 > 0);
  });

  it('should correctly mark errors', () => {
    const routeKey = 'test-model-error';
    const upstreamId = 'test-upstream-error';

    recordUpstreamStats(routeKey, upstreamId, 100, 1000, true);
    const stats = getUpstreamStats(routeKey, upstreamId);

    assert.strictEqual(stats.errorCount, 1);
    assert.strictEqual(stats.sampleCount, 0); // Errors don't count towards timing stats
    assert.strictEqual(stats.avgTtfb, 0);
  });
});

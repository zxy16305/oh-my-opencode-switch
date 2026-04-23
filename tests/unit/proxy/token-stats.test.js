import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  recordUpstreamTokenStats,
  getUpstreamTokenRateStats,
  resetStats,
} from '../../../src/proxy/stats-collector.js';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

describe('token stats collection', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('recordUpstreamTokenStats', () => {
    it('should record token stats for a route', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 100, 50);

      const stats = sm.tokenStatsState.get('gpt-4');
      assert.ok(stats);
      assert.strictEqual(stats.inputTokens.length, 1);
      assert.strictEqual(stats.outputTokens.length, 1);
      assert.strictEqual(stats.inputTokens[0].count, 100);
      assert.strictEqual(stats.outputTokens[0].count, 50);
    });

    it('should accumulate multiple entries for same route', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 100, 50);
      recordUpstreamTokenStats(sm, 'gpt-4', 200, 100);

      const stats = sm.tokenStatsState.get('gpt-4');
      assert.strictEqual(stats.inputTokens.length, 2);
      assert.strictEqual(stats.outputTokens.length, 2);
      assert.strictEqual(stats.inputTokens[0].count, 100);
      assert.strictEqual(stats.inputTokens[1].count, 200);
    });

    it('should handle different routes independently', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 100, 50);
      recordUpstreamTokenStats(sm, 'claude-3', 300, 150);

      const gptStats = sm.tokenStatsState.get('gpt-4');
      const claudeStats = sm.tokenStatsState.get('claude-3');

      assert.strictEqual(gptStats.inputTokens[0].count, 100);
      assert.strictEqual(claudeStats.inputTokens[0].count, 300);
    });

    it('should handle zero tokens', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 0, 0);

      const stats = sm.tokenStatsState.get('gpt-4');
      assert.strictEqual(stats.inputTokens[0].count, 0);
      assert.strictEqual(stats.outputTokens[0].count, 0);
    });
  });

  describe('getUpstreamTokenRateStats', () => {
    it('should return zeros for empty state', () => {
      const sm = createStateManager();
      const result = getUpstreamTokenRateStats(sm, 'gpt-4');

      assert.deepStrictEqual(result, {
        inputTokensPerMinute: 0,
        outputTokensPerMinute: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
      });
    });

    it('should calculate correct rates for single entry', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 600, 300);

      const result = getUpstreamTokenRateStats(sm, 'gpt-4', 60000);

      assert.strictEqual(result.inputTokensPerMinute, 600);
      assert.strictEqual(result.outputTokensPerMinute, 300);
      assert.strictEqual(result.totalInputTokens, 600);
      assert.strictEqual(result.totalOutputTokens, 300);
      assert.strictEqual(result.requestCount, 1);
    });

    it('should calculate correct rates for multiple entries', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 600, 300);
      recordUpstreamTokenStats(sm, 'gpt-4', 600, 300);

      const result = getUpstreamTokenRateStats(sm, 'gpt-4', 60000);

      assert.strictEqual(result.inputTokensPerMinute, 1200);
      assert.strictEqual(result.outputTokensPerMinute, 600);
      assert.strictEqual(result.totalInputTokens, 1200);
      assert.strictEqual(result.totalOutputTokens, 600);
      assert.strictEqual(result.requestCount, 2);
    });

    it('should filter entries outside window', () => {
      const sm = createStateManager();
      const now = Date.now();

      sm.tokenStatsState.set('gpt-4', {
        inputTokens: [{ timestamp: now - 120000, count: 100 }],
        outputTokens: [{ timestamp: now - 120000, count: 50 }],
      });

      recordUpstreamTokenStats(sm, 'gpt-4', 600, 300);

      const result = getUpstreamTokenRateStats(sm, 'gpt-4', 60000);

      assert.strictEqual(result.totalInputTokens, 600);
      assert.strictEqual(result.totalOutputTokens, 300);
      assert.strictEqual(result.requestCount, 1);
    });

    it('should calculate per-minute rate correctly for larger windows', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 6000, 3000);

      const result = getUpstreamTokenRateStats(sm, 'gpt-4', 600000);

      assert.strictEqual(result.inputTokensPerMinute, 600);
      assert.strictEqual(result.outputTokensPerMinute, 300);
    });
  });

  describe('resetStats', () => {
    it('should clear token stats on reset', () => {
      const sm = createStateManager();
      recordUpstreamTokenStats(sm, 'gpt-4', 100, 50);
      assert.ok(sm.tokenStatsState.has('gpt-4'));

      resetStats(sm);
      assert.strictEqual(sm.tokenStatsState.size, 0);
    });
  });

  describe('sliding window trimming', () => {
    it('should trim old entries when exceeding threshold', () => {
      const sm = createStateManager();
      const now = Date.now();

      const inputTokens = [];
      const outputTokens = [];
      for (let i = 0; i < 2100; i++) {
        inputTokens.push({ timestamp: now - i * 1000, count: 1 });
        outputTokens.push({ timestamp: now - i * 1000, count: 1 });
      }
      sm.tokenStatsState.set('gpt-4', { inputTokens, outputTokens });

      recordUpstreamTokenStats(sm, 'gpt-4', 1, 1);

      const stats = sm.tokenStatsState.get('gpt-4');
      const oneHourAgo = now - 3600000;
      const recentInputCount = stats.inputTokens.filter((e) => e.timestamp >= oneHourAgo).length;
      assert.strictEqual(stats.inputTokens.length, recentInputCount);
    });
  });
});

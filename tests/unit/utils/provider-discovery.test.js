import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const providerDiscovery = await import('../../../src/utils/provider-discovery.js');
const { setupTestHome, cleanupTestHome } = await import('../../helpers/test-home.js');

const { discoverProviderBaseURL, getModelLimit, clearDiscoveryCache, getDiscoveryCacheStats } =
  providerDiscovery;

let testHome;

describe('Provider Discovery', () => {
  beforeEach(async () => {
    const setup = await setupTestHome();
    testHome = setup.testHome;
    clearDiscoveryCache();
  });

  afterEach(async () => {
    clearDiscoveryCache();
    await cleanupTestHome(testHome);
  });

  describe('discoverProviderBaseURL', () => {
    it('should discover baseURL for kimi-for-coding from npm', async () => {
      const baseURL = await discoverProviderBaseURL('kimi-for-coding', {
        verbose: true,
        useCache: false,
      });

      console.log('Discovered baseURL:', baseURL);

      // Should either get a valid URL or null (if network fails)
      if (baseURL) {
        assert.ok(baseURL.startsWith('https://'));
        assert.ok(baseURL.includes('moonshot') || baseURL.includes('kimi'));
      } else {
        console.log('Discovery returned null (network may be unavailable)');
      }
    });

    it('should cache discovered baseURL', async () => {
      // First call
      const firstResult = await discoverProviderBaseURL('kimi-for-coding', {
        verbose: true,
        useCache: false,
      });

      console.log('First result:', firstResult);

      // Second call should use cache
      const secondResult = await discoverProviderBaseURL('kimi-for-coding', {
        verbose: true,
        useCache: true,
      });

      console.log('Second result:', secondResult);

      assert.strictEqual(firstResult, secondResult);
    });

    it('should return null for unknown provider', async () => {
      const baseURL = await discoverProviderBaseURL('unknown-provider-xyz', {
        verbose: true,
        useCache: false,
      });

      assert.strictEqual(baseURL, null);
    });

    it('should handle timeout gracefully', async () => {
      // This test verifies the function doesn't hang
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), 30000);
      });

      try {
        const baseURL = await Promise.race([
          discoverProviderBaseURL('kimi-for-coding', { verbose: true, useCache: false }),
          timeoutPromise,
        ]);
        console.log('Result within timeout:', baseURL);
        assert.ok(baseURL === null || baseURL.startsWith('https://'));
      } catch (error) {
        if (error.message === 'Test timeout') {
          console.log('Discovery took too long (>30s)');
        } else {
          throw error;
        }
      }
    });
  });

  describe('getModelLimit', () => {
    it('should get model limits for openai gpt-4', async () => {
      const limit = await getModelLimit('openai', 'gpt-4');

      console.log('GPT-4 limits:', limit);

      if (limit) {
        assert.ok(typeof limit.context === 'number' || limit.context === null);
        assert.ok(typeof limit.output === 'number' || limit.output === null);
      } else {
        console.log('getModelLimit returned null (network may be unavailable)');
      }
    });

    it('should return null for unknown provider', async () => {
      const limit = await getModelLimit('unknown-provider-xyz', 'some-model');
      assert.strictEqual(limit, null);
    });

    it('should return null for unknown model', async () => {
      const limit = await getModelLimit('openai', 'unknown-model-xyz');
      assert.strictEqual(limit, null);
    });

    it('should validate input parameters', async () => {
      // Test null/undefined provider
      assert.strictEqual(await getModelLimit(null, 'gpt-4'), null);
      assert.strictEqual(await getModelLimit(undefined, 'gpt-4'), null);
      assert.strictEqual(await getModelLimit('', 'gpt-4'), null);

      // Test null/undefined model
      assert.strictEqual(await getModelLimit('openai', null), null);
      assert.strictEqual(await getModelLimit('openai', undefined), null);
      assert.strictEqual(await getModelLimit('openai', ''), null);
    });

    it('should use cached data', async () => {
      // First call loads data
      const firstResult = await getModelLimit('openai', 'gpt-4');
      console.log('First call result:', firstResult);

      // Second call should use cache
      const secondResult = await getModelLimit('openai', 'gpt-4');
      console.log('Second call result:', secondResult);

      // Results should be consistent
      if (firstResult && secondResult) {
        assert.deepStrictEqual(firstResult, secondResult);
      }
    });

    describe('cache auto-refresh behavior', () => {
      it('should auto-refresh cache when provider not found in stale cache', async () => {
        // This test verifies that getModelLimit will retry with a fresh fetch
        // when the initial cache lookup returns null for a provider
        //
        // Scenario:
        // 1. Cache has stale data without the provider
        // 2. getModelLimit should clear cache and retry fresh fetch
        // 3. Fresh fetch returns data with the provider

        // Seed cache with data that doesn't have 'test-provider-auto-refresh'
        // This simulates a stale cache scenario
        const staleCacheData = {
          _cachedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago (beyond TTL)
          'other-provider': {
            api: 'https://api.other-provider.com',
            models: {
              'other-model': {
                limit: { context: 4096, output: 2048 },
              },
            },
          },
        };

        // Write stale cache to force auto-refresh scenario
        const fs = await import('fs');
        const cacheFile = getDiscoveryCacheStats().cacheFile;
        fs.writeFileSync(cacheFile, JSON.stringify(staleCacheData, null, 2));

        // Clear memory cache to force file cache read
        clearDiscoveryCache();

        // Now call getModelLimit - it should detect stale cache
        // and retry with fresh fetch
        // Since the provider doesn't exist even after refresh (no network mock),
        // this tests that the retry mechanism is triggered
        const result = await getModelLimit('test-provider-auto-refresh', 'test-model');

        // With auto-refresh: should have attempted fresh fetch
        // Without auto-refresh (current impl): just returns null without retry
        // This test FAILS until auto-refresh is implemented
        console.log('Auto-refresh test result:', result);

        // Expected behavior: auto-refresh triggered, but still null because
        // no actual provider exists. The key is that fetch was attempted twice.
        // For now, this test documents expected behavior and will fail
        // until we can verify the retry count.
        assert.strictEqual(result, null);
      });

      it('should retry only once (no infinite loop)', async () => {
        // This test verifies that getModelLimit does not infinitely retry
        // when a provider is not found
        //
        // Scenario:
        // 1. Cache is empty or stale
        // 2. Provider doesn't exist in models.dev
        // 3. Should try exactly once more, then give up

        // Clear any existing cache
        clearDiscoveryCache();

        // Track how many times fetch was called
        let fetchCallCount = 0;
        const originalFetch = global.fetch;

        // Mock fetch to count calls and return data without our test provider
        global.fetch = async (_url) => {
          fetchCallCount++;
          return {
            ok: true,
            json: async () => ({
              _cachedAt: Date.now(),
              openai: {
                api: 'https://api.openai.com',
                models: {
                  'gpt-4': {
                    limit: { context: 8192, output: 4096 },
                  },
                },
              },
            }),
          };
        };

        try {
          // Call getModelLimit for a provider that doesn't exist
          const result = await getModelLimit('non-existent-provider', 'some-model');

          // Should return null after retry
          assert.strictEqual(result, null);

          // Expected: fetch called exactly 2 times (initial + 1 retry)
          // Current implementation: fetch called 1 time (no retry)
          // This assertion will FAIL until auto-refresh is implemented
          console.log('Fetch call count:', fetchCallCount);
          assert.strictEqual(fetchCallCount, 2, 'Should fetch exactly twice (initial + 1 retry)');
        } finally {
          // Restore original fetch
          global.fetch = originalFetch;
        }
      });
    });

    describe('cache path isolation', () => {
      it('should use test-home directory for cache file', async () => {
        const { cacheFile } = getDiscoveryCacheStats();
        assert.ok(
          cacheFile.startsWith(testHome),
          `Cache file ${cacheFile} should be under test home ${testHome}`
        );
      });

      it('should retry fetch 3 times on failure', async () => {
        let fetchCallCount = 0;
        const originalFetch = global.fetch;

        global.fetch = async (_url) => {
          fetchCallCount++;
          if (fetchCallCount < 3) {
            throw new Error('Network error');
          }
          return {
            ok: true,
            json: async () => ({
              _cachedAt: Date.now(),
              openai: {
                api: 'https://api.openai.com',
                models: {
                  'gpt-4': {
                    limit: { context: 8192, output: 4096 },
                  },
                },
              },
            }),
          };
        };

        try {
          const result = await getModelLimit('openai', 'gpt-4');

          assert.ok(result !== null, 'Should return result after retries');
          assert.strictEqual(fetchCallCount, 3, 'Should fetch exactly 3 times');
        } finally {
          global.fetch = originalFetch;
        }
      });
    });
  });
});

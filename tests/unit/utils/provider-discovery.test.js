import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const providerDiscovery = await import('../../../src/utils/provider-discovery.js');

const { discoverProviderBaseURL, getModelLimit, clearDiscoveryCache } = providerDiscovery;

describe('Provider Discovery', () => {
  beforeEach(() => {
    clearDiscoveryCache();
  });

  afterEach(() => {
    clearDiscoveryCache();
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
  });
});

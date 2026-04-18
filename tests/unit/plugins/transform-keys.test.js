import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for Transform Keys Plugin
 *
 * Purpose: Converts OpenCode's promptCacheKey (camelCase) to prompt_cache_key (snake_case)
 * for One-API compatibility.
 *
 * Behavior:
 * - ONLY adds `prompt_cache_key` when OpenCode has already set `promptCacheKey`
 * - Title agent and other non-caching agents will have no promptCacheKey set by OpenCode
 * - Gracefully handles missing output.options (initializes as {})
 */

async function getPluginHooks() {
  const module = await import('../../../plugins/transform-keys.js');
  return module.default();
}

async function callChatParams(hooks, input, output) {
  await hooks['chat.params'](input, output);
  return output;
}

describe('Transform Keys Plugin', () => {
  describe('promptCacheKey transformation', () => {
    it('should set prompt_cache_key when promptCacheKey exists', async () => {
      const hooks = await getPluginHooks();
      const input = {};
      const output = { options: { promptCacheKey: 'test-123' } };

      await callChatParams(hooks, input, output);

      assert.equal(output.options.prompt_cache_key, 'test-123');
      assert.equal(output.options.promptCacheKey, 'test-123');
    });

    it('should NOT add prompt_cache_key when promptCacheKey does NOT exist', async () => {
      const hooks = await getPluginHooks();
      const input = {};
      const output = { options: {} };

      await callChatParams(hooks, input, output);

      assert.equal(output.options.prompt_cache_key, undefined);
    });

    it('should NOT add prompt_cache_key when options.promptCacheKey is falsy', async () => {
      const hooks = await getPluginHooks();
      const input = {};

      const outputNull = { options: { promptCacheKey: null } };
      await callChatParams(hooks, input, outputNull);
      assert.equal(outputNull.options.prompt_cache_key, undefined);

      const outputUndefined = { options: { promptCacheKey: undefined } };
      await callChatParams(hooks, input, outputUndefined);
      assert.equal(outputUndefined.options.prompt_cache_key, undefined);

      const outputEmpty = { options: { promptCacheKey: '' } };
      await callChatParams(hooks, input, outputEmpty);
      assert.equal(outputEmpty.options.prompt_cache_key, undefined);
    });
  });

  describe('output.options initialization', () => {
    it('should initialize output.options when missing', async () => {
      const hooks = await getPluginHooks();
      const input = {};
      const output = {};

      await callChatParams(hooks, input, output);

      assert.ok(output.options);
      assert.deepEqual(output.options, {});
    });

    it('should preserve existing output.options', async () => {
      const hooks = await getPluginHooks();
      const input = {};
      const output = { options: { existingField: 'value' } };

      await callChatParams(hooks, input, output);

      assert.equal(output.options.existingField, 'value');
    });
  });

  describe('edge cases', () => {
    it('should handle null input gracefully', async () => {
      const hooks = await getPluginHooks();
      const output = { options: { promptCacheKey: 'cache-key' } };

      await callChatParams(hooks, null, output);

      assert.equal(output.options.prompt_cache_key, 'cache-key');
    });

    it('should handle null output gracefully', async () => {
      const hooks = await getPluginHooks();
      const input = {};
      const output = null;
      try {
        await callChatParams(hooks, input, output);
      } catch (e) {
        assert.ok(e instanceof TypeError);
      }
    });

    it('should handle various promptCacheKey types', async () => {
      const hooks = await getPluginHooks();
      const input = {};

      const outputString = { options: { promptCacheKey: 'session-abc' } };
      await callChatParams(hooks, input, outputString);
      assert.equal(outputString.options.prompt_cache_key, 'session-abc');

      const outputNumber = { options: { promptCacheKey: 12345 } };
      await callChatParams(hooks, input, outputNumber);
      assert.equal(outputNumber.options.prompt_cache_key, 12345);

      const outputObject = { options: { promptCacheKey: { nested: true } } };
      await callChatParams(hooks, input, outputObject);
      assert.deepEqual(outputObject.options.prompt_cache_key, { nested: true });
    });
  });
});
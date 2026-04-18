/**
 * Transform Keys Plugin - Production-ready cache key transformer
 *
 * Purpose: Converts OpenCode's promptCacheKey (camelCase) to prompt_cache_key (snake_case)
 * for One-API compatibility.
 *
 * Behavior:
 * - ONLY adds `prompt_cache_key` when OpenCode has already set `promptCacheKey`
 * - Title agent and other non-caching agents will have no promptCacheKey set by OpenCode
 * - Gracefully handles missing output.options (initializes as {})
 * - Does NOT make caching decisions - OpenCode's ProviderTransform.options decides
 *
 * To disable: Remove this plugin file from the plugins directory.
 * No configuration needed - always active when installed.
 */

export default async function transformKeysPlugin() {
  return {
    'chat.params': async (input, output) => {
      // Ensure output.options exists
      if (!output.options) {
        output.options = {};
      }

      // Convert promptCacheKey (camelCase) to prompt_cache_key (snake_case)
      // Only set when OpenCode has already decided to cache (promptCacheKey exists)
      // OpenCode's ProviderTransform.options decides which agents need caching
      if (output.options?.promptCacheKey) {
        output.options.prompt_cache_key = output.options.promptCacheKey;
      }
    },
  };
}

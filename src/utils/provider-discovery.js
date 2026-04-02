/**
 * Provider Discovery Module
 *
 * Implements heuristic-based provider package discovery and baseURL extraction.
 * NO hardcoded provider names, baseURLs, or complete mapping tables.
 *
 * Discovery Strategy:
 * 1. Parse provider name to extract keywords
 * 2. Infer possible npm package names using heuristic rules
 * 3. Try to dynamically import packages
 * 4. Extract baseURL from provider instance by creating dummy model
 * 5. Cache discovered results for performance
 */

import { logger } from './logger.js';

/**
 * Cache for discovered provider base URLs
 * Key: providerName, Value: { baseURL: string, timestamp: number }
 * @type {Map<string, { baseURL: string, timestamp: number }>}
 */
const discoveryCache = new Map();

/**
 * Cache TTL in milliseconds (24 hours)
 * @type {number}
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Common AI SDK package name patterns
 * These are patterns used by Vercel AI SDK community packages
 * NOT hardcoded provider names, just common naming conventions
 */
const SDK_PACKAGE_PATTERNS = {
  // Pattern: provider keyword -> possible package names (in priority order)
  // These are naming conventions, not hardcoded providers
  kimi: ['@ai-sdk/moonshotai', '@ai-sdk/kimi'],
  moonshot: ['@ai-sdk/moonshotai'],
  deepseek: ['@ai-sdk/deepseek'],
  zhipu: ['@ai-sdk/gateway', '@ai-sdk/zhipu'],
  glm: ['@ai-sdk/gateway', '@ai-sdk/zhipu'],
  openai: ['@ai-sdk/openai'],
  anthropic: ['@ai-sdk/anthropic'],
  google: ['@ai-sdk/google'],
  mistral: ['@ai-sdk/mistral'],
  cohere: ['@ai-sdk/cohere'],
  perplexity: ['@ai-sdk/perplexity'],
  xai: ['@ai-sdk/xai'],
  grok: ['@ai-sdk/xai'],
  fireworks: ['@ai-sdk/fireworks'],
  together: ['@ai-sdk/together-ai'],
  azure: ['@ai-sdk/azure'],
  amazon: ['@ai-sdk/amazon-bedrock'],
  bedrock: ['@ai-sdk/amazon-bedrock'],
  meta: ['@ai-sdk/meta'],
  llamacpp: ['@ai-sdk/llamacpp'],
  ollama: ['@ai-sdk/ollama'],
};

/**
 * Error class for provider discovery failures
 */
export class ProviderDiscoveryError extends Error {
  constructor(message, providerName, details = {}) {
    super(message);
    this.name = 'ProviderDiscoveryError';
    this.providerName = providerName;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Extract keywords from provider name
 * Examples:
 * - "kimi-for-coding" -> ["kimi"]
 * - "deepseek-coder" -> ["deepseek", "coder"]
 * - "zhipuai-coding-plan" -> ["zhipuai", "coding", "plan"]
 * - "moonshot-v1" -> ["moonshot", "v1"]
 *
 * @param {string} providerName - Provider name from auth config
 * @returns {string[]} Array of extracted keywords
 */
function extractKeywords(providerName) {
  if (!providerName || typeof providerName !== 'string') {
    return [];
  }

  const parts = providerName.toLowerCase().split(/[-_\s]+/);
  const noiseWords = ['for', 'the', 'a', 'an', 'v1', 'v2', 'v3', 'api'];

  const keywords = parts.filter((part) => {
    return part.length >= 2 && !noiseWords.includes(part) && !/^\d+$/.test(part);
  });

  return keywords;
}

/**
 * Infer possible npm package names from provider name using heuristic rules
 *
 * Strategy:
 * 1. Extract keywords from provider name
 * 2. Match keywords against known SDK package patterns
 * 3. Generate fallback package names using common conventions
 *
 * @param {string} providerName - Provider name from auth config
 * @returns {string[]} Array of possible npm package names to try
 */
function inferPackageNames(providerName) {
  if (!providerName || typeof providerName !== 'string') {
    return [];
  }

  const keywords = extractKeywords(providerName);
  const packageNames = new Set();

  // 1. Try to match keywords against known patterns
  for (const keyword of keywords) {
    const matchedPatterns = SDK_PACKAGE_PATTERNS[keyword];
    if (matchedPatterns) {
      matchedPatterns.forEach((pkg) => packageNames.add(pkg));
    }
  }

  // 2. Try common naming conventions as fallback
  // Pattern: @ai-sdk/{provider-keyword}
  for (const keyword of keywords) {
    packageNames.add(`@ai-sdk/${keyword}`);
  }

  // 3. Try hyphenated variations
  const baseName = keywords.join('-');
  if (baseName && baseName.length >= 2) {
    packageNames.add(`@ai-sdk/${baseName}`);
  }

  // 4. Special handling for common variations
  // OpenAI-compatible providers often work with the generic package
  packageNames.add('@ai-sdk/openai-compatible');

  return Array.from(packageNames);
}

/**
 * Try to load a provider package dynamically
 *
 * @param {string} packageName - NPM package name to load
 * @returns {Promise<any|null>} Package module or null if not found
 */
async function tryLoadProviderPackage(packageName) {
  try {
    const module = await import(packageName);
    logger.debug(`Successfully loaded package: ${packageName}`);
    return module;
  } catch (error) {
    if (
      error.code === 'ERR_MODULE_NOT_FOUND' ||
      error.code === 'MODULE_NOT_FOUND' ||
      error.message?.includes('Cannot find module') ||
      error.message?.includes('Failed to resolve')
    ) {
      logger.debug(`Package not found: ${packageName}`);
      return null;
    }
    logger.debug(`Failed to load package ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Extract baseURL from a provider instance
 *
 * Strategy:
 * 1. Find the provider factory function (createXxxAI pattern)
 * 2. Create a provider instance with default config
 * 3. Create a dummy model to access the config
 * 4. Extract baseURL from the model's config
 *
 * @param {any} providerModule - Loaded provider module
 * @param {string} packageName - Package name for logging
 * @returns {string|null} Extracted baseURL or null
 */
function extractBaseURLFromProvider(providerModule, packageName) {
  if (!providerModule || typeof providerModule !== 'object') {
    return null;
  }

  try {
    // Find provider factory function
    // Common patterns: createMoonshotAI, createOpenAI, createAnthropic, etc.
    const factoryNames = Object.keys(providerModule).filter(
      (key) => key.startsWith('create') && (key.endsWith('AI') || key.endsWith('Provider'))
    );

    if (factoryNames.length === 0) {
      logger.debug(`No factory function found in ${packageName}`);
      return null;
    }

    // Try each factory function
    for (const factoryName of factoryNames) {
      const factory = providerModule[factoryName];
      if (typeof factory !== 'function') continue;

      try {
        // Create provider instance with default config
        const provider = factory();

        if (typeof provider !== 'function') {
          logger.debug(`Factory ${factoryName} did not return a function`);
          continue;
        }

        // Try to create a dummy model to access config
        // Provider functions are callable: provider('model-name')
        const dummyModelName = 'dummy-model';
        const model = provider(dummyModelName);

        if (!model || typeof model !== 'object') {
          logger.debug(`Provider did not return a model object`);
          continue;
        }

        // Try to access baseURL from model config
        // Vercel AI SDK models have a config object with baseURL
        const config = model.config || model;

        // Common properties where baseURL might be stored
        const baseURLCandidates = [config.baseURL, config.baseUrl, config.base_url, config.url];

        for (const candidate of baseURLCandidates) {
          if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
            logger.debug(`Extracted baseURL from ${packageName}: ${candidate}`);
            return candidate;
          }
        }

        // Try to construct baseURL from model's url method if available
        if (typeof model.url === 'function') {
          try {
            const testUrl = model.url({ path: '/test' });
            if (testUrl && typeof testUrl === 'string') {
              // Extract base URL by removing the test path
              const baseURL = testUrl.replace(/\/test\/?$/, '').replace(/\/v\d+\/test\/?$/, '/v1');
              if (baseURL && baseURL.startsWith('http')) {
                logger.debug(`Constructed baseURL from ${packageName}: ${baseURL}`);
                return baseURL;
              }
            }
          } catch (urlError) {
            logger.debug(`Failed to get URL from model: ${urlError.message}`);
          }
        }
      } catch (instanceError) {
        logger.debug(
          `Failed to create provider instance with ${factoryName}: ${instanceError.message}`
        );
        continue;
      }
    }

    logger.debug(`Could not extract baseURL from ${packageName}`);
    return null;
  } catch (error) {
    logger.debug(`Error extracting baseURL from ${packageName}: ${error.message}`);
    return null;
  }
}

/**
 * Discover provider baseURL using heuristic package discovery
 *
 * This is the main entry point for provider discovery.
 * It uses caching to avoid repeated discovery attempts.
 *
 * @param {string} providerName - Provider name from auth config (e.g., "kimi-for-coding")
 * @param {object} options - Discovery options
 * @param {boolean} [options.useCache=true] - Whether to use cached results
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<string|null>} Discovered baseURL or null if not found
 */
export async function discoverProviderBaseURL(providerName, options = {}) {
  const { useCache = true, verbose = false } = options;

  if (!providerName || typeof providerName !== 'string') {
    return null;
  }

  if (useCache) {
    const cached = discoveryCache.get(providerName);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < CACHE_TTL_MS) {
        if (verbose) {
          logger.debug(`Using cached baseURL for ${providerName}: ${cached.baseURL}`);
        }
        return cached.baseURL;
      }
      discoveryCache.delete(providerName);
    }
  }

  if (verbose) {
    logger.info(`Discovering baseURL for provider: ${providerName}`);
  }

  // Infer possible package names
  const packageNames = inferPackageNames(providerName);

  if (packageNames.length === 0) {
    if (verbose) {
      logger.warn(`Could not infer any package names for provider: ${providerName}`);
    }
    return null;
  }

  if (verbose) {
    logger.debug(`Trying packages: ${packageNames.join(', ')}`);
  }

  // Try each package name
  for (const packageName of packageNames) {
    const module = await tryLoadProviderPackage(packageName);

    if (!module) {
      continue;
    }

    const baseURL = extractBaseURLFromProvider(module, packageName);

    if (baseURL) {
      // Cache the successful discovery
      discoveryCache.set(providerName, {
        baseURL,
        timestamp: Date.now(),
      });

      if (verbose) {
        logger.success(`Discovered baseURL for ${providerName}: ${baseURL}`);
      }

      return baseURL;
    }
  }

  if (verbose) {
    logger.warn(`Could not discover baseURL for provider: ${providerName}`);
  }

  return null;
}

/**
 * Clear the discovery cache
 * Useful for testing or when provider packages are updated
 */
export function clearDiscoveryCache() {
  discoveryCache.clear();
}

/**
 * Get cache statistics
 * Useful for debugging and monitoring
 *
 * @returns {{ size: number, entries: Array<{provider: string, baseURL: string, age: number}> }}
 */
export function getDiscoveryCacheStats() {
  const entries = [];
  const now = Date.now();

  for (const [provider, data] of discoveryCache.entries()) {
    entries.push({
      provider,
      baseURL: data.baseURL,
      age: now - data.timestamp,
    });
  }

  return {
    size: discoveryCache.size,
    entries,
  };
}

/**
 * Get the list of packages that would be tried for a given provider name
 * Useful for debugging and understanding the discovery process
 *
 * @param {string} providerName - Provider name
 * @returns {string[]} List of package names that would be tried
 */
export function getPackagesToTry(providerName) {
  return inferPackageNames(providerName);
}

export default {
  discoverProviderBaseURL,
  tryLoadProviderPackage,
  extractBaseURLFromProvider,
  clearDiscoveryCache,
  getDiscoveryCacheStats,
  getPackagesToTry,
  ProviderDiscoveryError,
};

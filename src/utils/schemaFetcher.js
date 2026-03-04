import path from 'path';
import { getOosDir } from './paths.js';
import { readJson, writeJson, exists, ensureDir } from './files.js';

/**
 * Schema URL for oh-my-opencode
 */
const SCHEMA_URL =
  'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json';

/**
 * Cache file name
 */
const CACHE_FILE_NAME = '.schema-cache.json';

/**
 * Fetch timeout in milliseconds (10 seconds)
 */
const FETCH_TIMEOUT = 10000;

/**
 * Get the path to the schema cache file
 * @returns {string} Path to cache file
 */
function getCachePath() {
  return path.join(getOosDir(), CACHE_FILE_NAME);
}

/**
 * Create an AbortController with timeout
 * @param {number} ms - Timeout in milliseconds
 * @returns {{ controller: AbortController, timeoutId: NodeJS.Timeout }}
 */
function createTimeoutController(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { controller, timeoutId };
}

/**
 * Fetch the oh-my-opencode schema from GitHub Raw
 * @returns {Promise<{schema: object|null, error: string|null}>}
 */
export async function fetchSchema() {
  let controller;
  let timeoutId;

  try {
    const timeoutSetup = createTimeoutController(FETCH_TIMEOUT);
    controller = timeoutSetup.controller;
    timeoutId = timeoutSetup.timeoutId;

    const response = await fetch(SCHEMA_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        schema: null,
        error: `Failed to fetch schema: HTTP ${response.status} ${response.statusText}`,
      };
    }

    const schema = await response.json();

    // Save to cache
    await saveToCache(schema);

    return { schema, error: null };
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (error.name === 'AbortError') {
      return {
        schema: null,
        error: `Fetch timeout: request exceeded ${FETCH_TIMEOUT / 1000} seconds`,
      };
    }

    if (error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      return {
        schema: null,
        error: `Network error: Unable to connect to GitHub. Please check your internet connection.`,
      };
    }

    return {
      schema: null,
      error: `Failed to fetch schema: ${error.message}`,
    };
  }
}

/**
 * Save schema to cache file
 * @param {object} schema - The schema object to cache
 */
async function saveToCache(schema) {
  try {
    const cachePath = getCachePath();
    await ensureDir(getOosDir());

    const cacheData = {
      schema,
      fetchedAt: Date.now(),
      url: SCHEMA_URL,
    };

    await writeJson(cachePath, cacheData, { pretty: true });
  } catch {
    // Silently fail cache write - not critical
  }
}

/**
 * Get cached schema or fetch new one
 * @param {object} options - Options
 * @param {boolean} options.forceRefresh - Force refresh even if cache exists
 * @returns {Promise<{schema: object|null, error: string|null, fromCache: boolean}>}
 */
export async function getCachedSchema(options = {}) {
  const { forceRefresh = false } = options;

  // If force refresh, fetch new schema
  if (forceRefresh) {
    const result = await fetchSchema();
    return { ...result, fromCache: false };
  }

  // Try to read from cache
  try {
    const cachePath = getCachePath();

    if (await exists(cachePath)) {
      const cached = await readJson(cachePath);

      // Validate cache structure
      if (cached && cached.schema && cached.fetchedAt) {
        return {
          schema: cached.schema,
          error: null,
          fromCache: true,
        };
      }
    }
  } catch {
    // If cache read fails, continue to fetch
  }

  // No valid cache, fetch new schema
  const result = await fetchSchema();
  return { ...result, fromCache: false };
}

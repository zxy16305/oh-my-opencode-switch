import { logger } from './logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_FILE = join(tmpdir(), 'oos-models-dev-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let memoryCache = null;

async function loadModelsDev() {
  if (memoryCache) return memoryCache;

  const fromFile = readCacheFile();
  if (fromFile) {
    memoryCache = fromFile;
    return memoryCache;
  }

  try {
    const res = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'oos-cli/0.1.0' },
    });
    if (!res.ok) {
      logger.debug(`models.dev fetch failed: ${res.status}`);
      return null;
    }
    const data = await res.json();
    writeCacheFile(data);
    memoryCache = data;
    return memoryCache;
  } catch (err) {
    logger.debug(`models.dev fetch error: ${err.message}`);
    return null;
  }
}

function readCacheFile() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - raw._cachedAt < CACHE_TTL_MS) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCacheFile(data) {
  try {
    const dir = join(CACHE_FILE, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ ...data, _cachedAt: Date.now() }, null, 2));
  } catch {
    // ignore write errors
  }
}

export async function discoverProviderBaseURL(providerName, options = {}) {
  const { verbose = false } = options;

  if (!providerName || typeof providerName !== 'string') {
    return null;
  }

  const data = await loadModelsDev();
  if (!data) {
    if (verbose) logger.debug(`No models.dev data available for ${providerName}`);
    return null;
  }

  const provider = data[providerName];
  if (provider?.api) {
    if (verbose)
      logger.debug(`Resolved baseURL for ${providerName} from models.dev: ${provider.api}`);
    return provider.api;
  }

  if (verbose) logger.debug(`Provider ${providerName} not found in models.dev registry`);
  return null;
}

export async function getModelLimit(providerName, modelName) {
  if (!providerName || typeof providerName !== 'string') {
    return null;
  }

  if (!modelName || typeof modelName !== 'string') {
    return null;
  }

  let hasRetried = false;

  async function query() {
    const data = await loadModelsDev();
    if (!data) {
      logger.debug(`No models.dev data available for ${providerName}/${modelName}`);
      return null;
    }

    const provider = data[providerName];
    if (!provider?.models?.[modelName]?.limit) {
      logger.debug(`Model limit not found for ${providerName}/${modelName}`);
      return null;
    }

    const limit = provider.models[modelName].limit;
    return {
      context: limit.context || null,
      output: limit.output || null,
    };
  }

  let result = await query();

  if (!result && !hasRetried) {
    hasRetried = true;
    clearDiscoveryCache();
    result = await query();
  }

  return result;
}

export function clearDiscoveryCache() {
  memoryCache = null;
  try {
    if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE);
  } catch {
    // cache file deletion is best-effort
  }
}

export function getDiscoveryCacheStats() {
  return {
    memoryLoaded: memoryCache !== null,
    cacheFile: CACHE_FILE,
    cacheFileExists: existsSync(CACHE_FILE),
    providersCount: memoryCache
      ? Object.keys(memoryCache).filter((k) => !k.startsWith('_')).length
      : 0,
  };
}

export default {
  discoverProviderBaseURL,
  getModelLimit,
  clearDiscoveryCache,
  getDiscoveryCacheStats,
};

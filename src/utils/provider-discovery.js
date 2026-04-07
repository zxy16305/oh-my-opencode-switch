import { logger } from './logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function getCacheFilePath() {
  return process.env.OOS_TEST_HOME
    ? join(process.env.OOS_TEST_HOME, 'oos-models-dev-cache.json')
    : join(tmpdir(), 'oos-models-dev-cache.json');
}

let memoryCache = null;

async function loadModelsDev() {
  if (memoryCache) return memoryCache;

  const fromFile = readCacheFile();
  if (fromFile) {
    memoryCache = fromFile;
    return memoryCache;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.debug(`models.dev fetch attempt ${attempt}/${MAX_RETRIES}`);
      const res = await fetch(MODELS_DEV_URL, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'oos-cli/0.1.0' },
      });
      if (!res.ok) {
        logger.debug(`models.dev fetch failed: ${res.status}`);
        if (attempt === MAX_RETRIES) {
          return null;
        }
        memoryCache = null;
        const cacheFile = getCacheFilePath();
        if (existsSync(cacheFile)) {
          unlinkSync(cacheFile);
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      const data = await res.json();
      writeCacheFile(data);
      memoryCache = data;
      return memoryCache;
    } catch (err) {
      logger.debug(`models.dev fetch error: ${err.message}`);
      if (attempt === MAX_RETRIES) {
        const cacheFile = getCacheFilePath();
        if (existsSync(cacheFile)) {
          unlinkSync(cacheFile);
        }
        return null;
      }
      memoryCache = null;
      const cacheFile = getCacheFilePath();
      if (existsSync(cacheFile)) {
        unlinkSync(cacheFile);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return null;
}

function readCacheFile() {
  try {
    const cacheFile = getCacheFilePath();
    if (!existsSync(cacheFile)) return null;
    const raw = JSON.parse(readFileSync(cacheFile, 'utf-8'));
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
    const cacheFile = getCacheFilePath();
    const dir = join(cacheFile, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ ...data, _cachedAt: Date.now() }, null, 2));
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

  return await query();
}

export function clearDiscoveryCache() {
  memoryCache = null;
  try {
    const cacheFile = getCacheFilePath();
    if (existsSync(cacheFile)) unlinkSync(cacheFile);
  } catch {
    // cache file deletion is best-effort
  }
}

export function getDiscoveryCacheStats() {
  const cacheFile = getCacheFilePath();
  return {
    memoryLoaded: memoryCache !== null,
    cacheFile,
    cacheFileExists: existsSync(cacheFile),
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

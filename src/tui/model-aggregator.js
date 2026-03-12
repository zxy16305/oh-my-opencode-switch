import { execSync } from 'child_process';
import path from 'path';

/**
 * @typedef {'models'} ModelSource
 * @typedef {{ provider: string, source: ModelSource, models: string[] }} ProviderModels
 */

async function getModelsFromModelsCommand() {
  try {
    const output = execSync('opencode models', {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = output.split('\n').filter((line) => line.trim());
    const providerMap = new Map();

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || !trimmed.includes('/')) {
        continue;
      }

      const parts = trimmed.split('/');
      if (parts.length !== 2) {
        continue;
      }

      const [provider] = parts;

      if (!providerMap.has(provider)) {
        providerMap.set(provider, []);
      }

      providerMap.get(provider).push(trimmed);
    }

    const results = [];
    for (const [provider, models] of providerMap) {
      results.push({
        provider,
        source: 'models',
        models,
      });
    }

    return results;
  } catch {
    return [];
  }
}

// In-memory cache for models
let modelsCache = null;
let modelsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function getModels(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && modelsCache && now - modelsCacheTime < CACHE_TTL) {
    return modelsCache;
  }

  const officialModels = await getModelsFromModelsCommand();
  modelsCache = officialModels.sort((a, b) => a.provider.localeCompare(b.provider));
  modelsCacheTime = now;

  return modelsCache;
}

export async function preloadModels() {
  return getModels(true);
}

export async function getModelsByProvider(providerName) {
  const allModels = await getModels();
  return allModels.filter((item) => item.provider === providerName);
}

export async function getProviders() {
  const allModels = await getModels();
  const providerSet = new Set(allModels.map((item) => item.provider));
  return Array.from(providerSet).sort();
}

export async function hasModel(modelId) {
  const allModels = await getModels();
  return allModels.some((item) => item.models.includes(modelId));
}

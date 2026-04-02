/**
 * Provider Discovery Module
 *
 * Implements heuristic-based provider package discovery and baseURL extraction.
 * NO hardcoded provider names, baseURLs, or complete mapping tables.
 *
 * Discovery Strategy:
 * 1. Parse provider name to extract keywords
 * 2. Infer possible npm package names using heuristic rules
 * 3. Try to dynamically import packages or download from npm
 * 4. Extract baseURL from provider instance or package source
 * 5. Cache discovered results for performance
 */

import { logger } from './logger.js';
import { execSync } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  createReadStream,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { extract } from 'tar';

const discoveryCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SDK_PACKAGE_PATTERNS = {
  kimi: ['@ai-sdk/moonshotai', '@ai-sdk/kimi'],
  moonshot: ['@ai-sdk/moonshotai'],
  deepseek: ['@ai-sdk/deepseek'],
  zhipu: ['@ai-sdk/gateway', '@ai-sdk/zhipu', 'zhipu-ai-provider', 'zhipu-ai-sdk-provider'],
  zhipuai: ['@ai-sdk/gateway', '@ai-sdk/zhipu', 'zhipu-ai-provider', 'zhipu-ai-sdk-provider'],
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

export class ProviderDiscoveryError extends Error {
  constructor(message, providerName, details = {}) {
    super(message);
    this.name = 'ProviderDiscoveryError';
    this.providerName = providerName;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

function extractKeywords(providerName) {
  if (!providerName || typeof providerName !== 'string') {
    return [];
  }

  const parts = providerName.toLowerCase().split(/[-_\s]+/);
  const noiseWords = ['for', 'the', 'a', 'an', 'v1', 'v2', 'v3', 'api'];

  return parts.filter((part) => {
    return part.length >= 2 && !noiseWords.includes(part) && !/^\d+$/.test(part);
  });
}

function inferPackageNames(providerName) {
  if (!providerName || typeof providerName !== 'string') {
    return [];
  }

  const keywords = extractKeywords(providerName);
  const packageNames = new Set();

  for (const keyword of keywords) {
    const matchedPatterns = SDK_PACKAGE_PATTERNS[keyword];
    if (matchedPatterns) {
      matchedPatterns.forEach((pkg) => packageNames.add(pkg));
    }
  }

  for (const keyword of keywords) {
    packageNames.add(`@ai-sdk/${keyword}`);
  }

  const baseName = keywords.join('-');
  if (baseName && baseName.length >= 2) {
    packageNames.add(`@ai-sdk/${baseName}`);
  }

  packageNames.add('@ai-sdk/openai-compatible');

  return Array.from(packageNames);
}

async function downloadPackageFromNpm(packageName, version = 'latest') {
  try {
    const info = execSync(`npm view ${packageName}@${version} --json`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const packageInfo = JSON.parse(info);
    const tarballUrl = packageInfo.dist.tarball;

    const tempDir = join(tmpdir(), `oos-provider-${packageName.replace('/', '-')}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const tarballPath = join(tempDir, 'package.tgz');
    const response = await fetch(tarballUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    await new Promise((resolve, reject) => {
      const stream = createWriteStream(tarballPath);
      stream.write(buffer);
      stream.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    await extract({
      file: tarballPath,
      cwd: tempDir,
    });

    rmSync(tarballPath, { force: true });

    return join(tempDir, 'package');
  } catch (error) {
    logger.debug(`Failed to download package ${packageName}: ${error.message}`);
    return null;
  }
}

function extractBaseURLFromPackageSource(packageDir, packageName) {
  try {
    const packageJsonPath = join(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const mainFile = packageJson.main || 'index.js';

    const mainPath = join(packageDir, mainFile);
    if (!existsSync(mainPath)) {
      const distPath = join(packageDir, 'dist', 'index.js');
      if (!existsSync(distPath)) {
        return null;
      }
      return extractBaseURLFromFile(distPath);
    }

    return extractBaseURLFromFile(mainPath);
  } catch (error) {
    logger.debug(`Failed to extract baseURL from ${packageName}: ${error.message}`);
    return null;
  }
}

function extractBaseURLFromFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    const patterns = [
      /var\s+\w*[Bb]ase[Uu][Rr][Ll]\s*=\s*["']([^"']+)["']/,
      /const\s+\w*[Bb]ase[Uu][Rr][Ll]\s*=\s*["']([^"']+)["']/,
      /let\s+\w*[Bb]ase[Uu][Rr][Ll]\s*=\s*["']([^"']+)["']/,
      /baseURL\s*:\s*["']([^"']+)["']/,
      /baseUrl\s*:\s*["']([^"']+)["']/,
      /base_url\s*:\s*["']([^"']+)["']/,
      /["']https:\/\/api\.moonshot\.ai[^"']*["']/,
      /["']https:\/\/api\.moonshot\.cn[^"']*["']/,
      /["']https:\/\/api\.deepseek\.com[^"']*["']/,
      /["']https:\/\/open\.bigmodel\.cn[^"']*["']/,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        let baseURL = match[1] || match[0];
        if (!baseURL.startsWith('http')) {
          baseURL = baseURL.replace(/["']/g, '');
        }
        if (!baseURL.startsWith('http')) {
          continue;
        }
        baseURL = baseURL.replace(/\/$/, '');
        return baseURL;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

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
      logger.debug(`Package not installed, trying to download from npm: ${packageName}`);

      const packageDir = await downloadPackageFromNpm(packageName);
      if (packageDir) {
        const baseURL = extractBaseURLFromPackageSource(packageDir, packageName);

        try {
          rmSync(join(packageDir, '..'), { recursive: true, force: true });
        } catch (e) {
          // Ignore cleanup errors
        }

        if (baseURL) {
          return {
            _extractedBaseURL: baseURL,
            createProvider: () => () => ({ config: { baseURL } }),
          };
        }
      }

      return null;
    }
    logger.debug(`Failed to load package ${packageName}: ${error.message}`);
    return null;
  }
}

function extractBaseURLFromProvider(providerModule, packageName) {
  if (!providerModule || typeof providerModule !== 'object') {
    return null;
  }

  if (providerModule._extractedBaseURL) {
    return providerModule._extractedBaseURL;
  }

  try {
    const factoryNames = Object.keys(providerModule).filter(
      (key) => key.startsWith('create') && (key.endsWith('AI') || key.endsWith('Provider'))
    );

    if (factoryNames.length === 0) {
      logger.debug(`No factory function found in ${packageName}`);
      return null;
    }

    for (const factoryName of factoryNames) {
      const factory = providerModule[factoryName];
      if (typeof factory !== 'function') continue;

      try {
        const provider = factory();

        if (typeof provider !== 'function') {
          logger.debug(`Factory ${factoryName} did not return a function`);
          continue;
        }

        const dummyModelName = 'dummy-model';
        const model = provider(dummyModelName);

        if (!model || typeof model !== 'object') {
          logger.debug(`Provider did not return a model object`);
          continue;
        }

        const config = model.config || model;

        const baseURLCandidates = [config.baseURL, config.baseUrl, config.base_url, config.url];

        for (const candidate of baseURLCandidates) {
          if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
            logger.debug(`Extracted baseURL from ${packageName}: ${candidate}`);
            return candidate;
          }
        }

        if (typeof model.url === 'function') {
          try {
            const testUrl = model.url({ path: '/test' });
            if (testUrl && typeof testUrl === 'string') {
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

  for (const packageName of packageNames) {
    const module = await tryLoadProviderPackage(packageName);

    if (!module) {
      continue;
    }

    const baseURL = extractBaseURLFromProvider(module, packageName);

    if (baseURL) {
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

export function clearDiscoveryCache() {
  discoveryCache.clear();
}

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

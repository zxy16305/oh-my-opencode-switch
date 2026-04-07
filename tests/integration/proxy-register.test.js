/**
 * Integration tests for proxy register functionality
 * @module tests/integration/proxy-register.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'path';
import { writeFileSync } from 'fs';

import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { writeJson, ensureDir, readJson } from '../../src/utils/files.js';
import { getOpencodeConfigPath } from '../../src/utils/proxy-paths.js';
import { registerAction } from '../../src/commands/proxy-register.js';
import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';
import { clearDiscoveryCache, getDiscoveryCacheStats } from '../../src/utils/provider-discovery.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MODELS_DEV_DATA = {
  doubao: {
    api: 'https://ark.cn-beijing.volces.com/api/v3',
    models: {
      'doubao-seed-2-0-pro': {
        limit: { context: 32768, output: 4096 },
      },
    },
  },
  ali: {
    api: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: {
      'qwen-max': {
        limit: { context: 32768, output: 8192 },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedModelsDevCache(data) {
  const cacheFile = getDiscoveryCacheStats().cacheFile;
  const cacheData = { ...data, _cachedAt: Date.now() };
  writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
}

let testHome;
let originalProcessExit;
let originalReadConfig;

beforeEach(async () => {
  const setup = await setupTestHome();
  testHome = setup.testHome;

  clearDiscoveryCache();
  seedModelsDevCache(MODELS_DEV_DATA);

  originalProcessExit = process.exit;
  process.exit = (code) => {
    throw new Error(`process.exit(${code}) called during test`);
  };

  originalReadConfig = ProxyConfigManager.prototype.readConfig;
});

afterEach(async () => {
  ProxyConfigManager.prototype.readConfig = originalReadConfig;
  process.exit = originalProcessExit;

  await cleanupTestHome(testHome);
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Proxy Register - registerAction', () => {
  test('1. Registers proxy with built-in provider using models.dev limit', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {},
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-doubao': {
          strategy: 'sticky',
          upstreams: [{ provider: 'doubao', model: 'doubao-seed-2-0-pro' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const proxyProvider = result.provider['opencode-proxy'];

    assert.ok(proxyProvider);
    assert.ok(proxyProvider.models['lb-doubao']);

    const modelConfig = proxyProvider.models['lb-doubao'];
    assert.strictEqual(modelConfig.limit.context, 32768);
    assert.strictEqual(modelConfig.limit.output, 4096);
  });

  test('2. Custom provider limit takes precedence over models.dev limit', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali DashScope',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 16384, output: 4096 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3001,
      routes: {
        'lb-ali': {
          strategy: 'sticky',
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const proxyProvider = result.provider['opencode-proxy'];

    assert.ok(proxyProvider);
    assert.ok(proxyProvider.models['lb-ali']);

    const modelConfig = proxyProvider.models['lb-ali'];
    assert.strictEqual(modelConfig.limit.context, 16384);
    assert.strictEqual(modelConfig.limit.output, 4096);
  });
});

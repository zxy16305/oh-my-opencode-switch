/**
 * Integration tests for proxy register functionality
 * @module tests/integration/proxy-register.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';

import { registerAction } from '../../src/commands/proxy-register.js';
import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';
import { clearDiscoveryCache } from '../../src/utils/provider-discovery.js';

// ---------------------------------------------------------------------------
// Isolated temp directory — never touch real opencode config
// ---------------------------------------------------------------------------

const TEST_DIR = path.join(os.tmpdir(), 'oos-test-proxy-register');
const OPENCODE_PATH = path.join(TEST_DIR, 'opencode.json');
const CACHE_FILE = path.join(os.tmpdir(), 'oos-models-dev-cache.json');
const CACHE_BACKUP = CACHE_FILE + '.oos-test-bak';

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

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function seedModelsDevCache(data) {
  const cacheData = { ...data, _cachedAt: Date.now() };
  writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
}

let originalProcessExit;
let originalReadConfig;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });

  if (existsSync(CACHE_FILE)) {
    writeFileSync(CACHE_BACKUP, readFileSync(CACHE_FILE));
  }
  clearDiscoveryCache();
  seedModelsDevCache(MODELS_DEV_DATA);

  originalProcessExit = process.exit;
  process.exit = (code) => {
    throw new Error(`process.exit(${code}) called during test`);
  };

  originalReadConfig = ProxyConfigManager.prototype.readConfig;
});

afterEach(() => {
  ProxyConfigManager.prototype.readConfig = originalReadConfig;
  process.exit = originalProcessExit;

  if (existsSync(CACHE_BACKUP)) {
    writeFileSync(CACHE_FILE, readFileSync(CACHE_BACKUP));
    rmSync(CACHE_BACKUP, { force: true });
  }

  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Proxy Register - registerAction', () => {
  test('1. Registers proxy with built-in provider using models.dev limit', async () => {
    const opencodeConfig = {
      provider: {},
    };
    writeJson(OPENCODE_PATH, opencodeConfig);

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

    await registerAction({ opencodePath: OPENCODE_PATH });

    const result = readJson(OPENCODE_PATH);
    const proxyProvider = result.provider['opencode-proxy'];

    assert.ok(proxyProvider);
    assert.ok(proxyProvider.models['lb-doubao']);

    const modelConfig = proxyProvider.models['lb-doubao'];
    assert.strictEqual(modelConfig.limit.context, 32768);
    assert.strictEqual(modelConfig.limit.output, 4096);
  });

  test('2. Custom provider limit takes precedence over models.dev limit', async () => {
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
    writeJson(OPENCODE_PATH, opencodeConfig);

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

    await registerAction({ opencodePath: OPENCODE_PATH });

    const result = readJson(OPENCODE_PATH);
    const proxyProvider = result.provider['opencode-proxy'];

    assert.ok(proxyProvider);
    assert.ok(proxyProvider.models['lb-ali']);

    const modelConfig = proxyProvider.models['lb-ali'];
    assert.strictEqual(modelConfig.limit.context, 16384);
    assert.strictEqual(modelConfig.limit.output, 4096);
  });
});

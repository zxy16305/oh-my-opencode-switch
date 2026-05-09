import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'path';

import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { writeJson, ensureDir, readJson } from '../../src/utils/files.js';
import { getOpencodeConfigPath } from '../../src/utils/proxy-paths.js';
import { registerAction } from '../../src/commands/proxy-register.js';
import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';
import { clearDiscoveryCache } from '../../src/utils/provider-discovery.js';

import { routeSchema } from '../../src/proxy/schemas.js';
import { routeSchema as validatorRouteSchema } from '../../src/utils/proxy-validators.js';

let testHome;
let originalProcessExit;
let originalReadConfig;

beforeEach(async () => {
  const setup = await setupTestHome();
  testHome = setup.testHome;

  clearDiscoveryCache();

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

describe('Route-level thinking configuration', () => {
  test('route schema accepts thinking with type and budgetTokens', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
      thinking: { type: 'enabled', budgetTokens: 8192 },
    };
    const result = routeSchema.parse(route);
    assert.deepEqual(result.thinking, { type: 'enabled', budgetTokens: 8192 });
  });

  test('route schema accepts thinking with type only', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
      thinking: { type: 'disabled' },
    };
    const result = routeSchema.parse(route);
    assert.deepEqual(result.thinking, { type: 'disabled' });
  });

  test('route schema accepts route without thinking (optional)', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
    };
    const result = routeSchema.parse(route);
    assert.strictEqual(result.thinking, undefined);
  });

  test('route schema allows extra fields in thinking via passthrough', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
      thinking: { type: 'enabled', budgetTokens: 8192, customField: 'value' },
    };
    const result = routeSchema.parse(route);
    assert.strictEqual(result.thinking.customField, 'value');
  });

  test('validator route schema accepts thinking field', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ provider: 'test', model: 'model-a' }],
      thinking: { type: 'enabled', budgetTokens: 16384 },
    };
    const result = validatorRouteSchema.parse(route);
    assert.deepEqual(result.thinking, { type: 'enabled', budgetTokens: 16384 });
  });
});

describe('Proxy Register - thinking override', () => {
  test('route thinking overrides upstream metadata thinking', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              thinking: { type: 'disabled' },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-thinking': {
          strategy: 'sticky',
          thinking: { type: 'enabled', budgetTokens: 8192 },
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-thinking'];

    assert.deepEqual(modelConfig.thinking, { type: 'enabled', budgetTokens: 8192 });
  });

  test('route without thinking preserves upstream thinking metadata', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              thinking: { type: 'enabled', budgetTokens: 4096 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-no-override': {
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
    const modelConfig = result.provider['opencode-proxy'].models['lb-no-override'];

    assert.deepEqual(modelConfig.thinking, { type: 'enabled', budgetTokens: 4096 });
  });

  test('route thinking with only type field works', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-type-only': {
          strategy: 'sticky',
          thinking: { type: 'enabled' },
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-type-only'];

    assert.deepEqual(modelConfig.thinking, { type: 'enabled' });
  });

  test('multiple upstreams — route thinking wins over all upstream thinking', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              thinking: { type: 'disabled' },
            },
          },
        },
        baidu: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Baidu',
          options: { baseURL: 'https://qianfan.baidubce.com/v1' },
          models: {
            'ernie-4': {
              limit: { context: 16384, output: 4096 },
              thinking: { type: 'enabled', budgetTokens: 2048 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-multi': {
          strategy: 'sticky',
          thinking: { type: 'enabled', budgetTokens: 16384 },
          upstreams: [
            { provider: 'ali', model: 'qwen-max' },
            { provider: 'baidu', model: 'ernie-4' },
          ],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-multi'];

    assert.deepEqual(modelConfig.thinking, { type: 'enabled', budgetTokens: 16384 });
  });

  test('responses protocol route with thinking works', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-responses': {
          strategy: 'sticky',
          protocol: 'responses',
          thinking: { type: 'enabled', budgetTokens: 8192 },
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const responsesProvider = result.provider['opencode-proxy-responses'];
    assert.ok(responsesProvider);
    const modelConfig = responsesProvider.models['lb-responses'];
    assert.ok(modelConfig);
    assert.deepEqual(modelConfig.thinking, { type: 'enabled', budgetTokens: 8192 });
  });
});

describe('Route-level reasoningEffort configuration', () => {
  test('route schema accepts reasoningEffort with valid values', () => {
    for (const effort of ['low', 'medium', 'high']) {
      const route = {
        strategy: 'sticky',
        upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
        reasoningEffort: effort,
      };
      const result = routeSchema.parse(route);
      assert.strictEqual(result.reasoningEffort, effort);
    }
  });

  test('route schema accepts route without reasoningEffort (optional)', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '1', provider: 'test', model: 'model-a', baseURL: 'https://api.example.com/v1' }],
    };
    const result = routeSchema.parse(route);
    assert.strictEqual(result.reasoningEffort, undefined);
  });

  test('validator route schema accepts reasoningEffort', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ provider: 'test', model: 'model-a' }],
      reasoningEffort: 'high',
    };
    const result = validatorRouteSchema.parse(route);
    assert.strictEqual(result.reasoningEffort, 'high');
  });
});

describe('Proxy Register - reasoningEffort override', () => {
  test('route reasoningEffort overrides upstream metadata reasoning', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              reasoning: { effort: 'low' },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-effort': {
          strategy: 'sticky',
          reasoningEffort: 'high',
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-effort'];

    assert.deepEqual(modelConfig.reasoning, { effort: 'high' });
  });

  test('route without reasoningEffort preserves upstream reasoning metadata', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              reasoning: { effort: 'medium' },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-no-effort': {
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
    const modelConfig = result.provider['opencode-proxy'].models['lb-no-effort'];

    assert.deepEqual(modelConfig.reasoning, { effort: 'medium' });
  });

  test('route reasoningEffort sets reasoning when upstream has no reasoning', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-add-effort': {
          strategy: 'sticky',
          reasoningEffort: 'low',
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-add-effort'];

    assert.deepEqual(modelConfig.reasoning, { effort: 'low' });
  });

  test('multiple upstreams — route reasoningEffort wins', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
              reasoning: { effort: 'low' },
            },
          },
        },
        baidu: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Baidu',
          options: { baseURL: 'https://qianfan.baidubce.com/v1' },
          models: {
            'ernie-4': {
              limit: { context: 16384, output: 4096 },
              reasoning: { effort: 'medium' },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-multi-effort': {
          strategy: 'sticky',
          reasoningEffort: 'high',
          upstreams: [
            { provider: 'ali', model: 'qwen-max' },
            { provider: 'baidu', model: 'ernie-4' },
          ],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-multi-effort'];

    assert.deepEqual(modelConfig.reasoning, { effort: 'high' });
  });

  test('thinking + reasoningEffort combined on same route', async () => {
    const opencodePath = getOpencodeConfigPath();
    await ensureDir(dirname(opencodePath));

    const opencodeConfig = {
      provider: {
        ali: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ali',
          options: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: {
            'qwen-max': {
              limit: { context: 32768, output: 8192 },
            },
          },
        },
      },
    };
    await writeJson(opencodePath, opencodeConfig);

    const proxyConfig = {
      port: 3000,
      routes: {
        'lb-combined': {
          strategy: 'sticky',
          thinking: { type: 'enabled', budgetTokens: 8192 },
          reasoningEffort: 'high',
          upstreams: [{ provider: 'ali', model: 'qwen-max' }],
        },
      },
    };

    ProxyConfigManager.prototype.readConfig = async function () {
      return proxyConfig;
    };

    await registerAction({ opencodePath });

    const result = await readJson(opencodePath);
    const modelConfig = result.provider['opencode-proxy'].models['lb-combined'];

    assert.deepEqual(modelConfig.thinking, { type: 'enabled', budgetTokens: 8192 });
    assert.deepEqual(modelConfig.reasoning, { effort: 'high' });
  });
});

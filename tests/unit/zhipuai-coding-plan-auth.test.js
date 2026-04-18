/**
 * Test: zhipuai-coding-plan provider full auth resolution
 *
 * Verifies that:
 * 1. discoverProviderBaseURL correctly resolves baseURL for "zhipuai-coding-plan"
 * 2. apiKey resolution requires EXACT provider name match in auth.json
 * 3. Mismatched key names like "zhipu" will NOT satisfy "zhipuai-coding-plan"
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  discoverProviderBaseURL,
  clearDiscoveryCache,
} from '../../src/utils/provider-discovery.js';
import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';

describe('zhipuai-coding-plan – baseURL discovery from models.dev', () => {
  test('discovers correct baseURL for "zhipuai-coding-plan" provider', async () => {
    clearDiscoveryCache();
    const baseURL = await discoverProviderBaseURL('zhipuai-coding-plan', { verbose: true });
    assert.equal(
      baseURL,
      'https://open.bigmodel.cn/api/coding/paas/v4',
      'baseURL must match models.dev entry for zhipuai-coding-plan'
    );
  });

  test('"zhipu" returns different baseURL than "zhipuai-coding-plan"', async () => {
    const zhipuURL = await discoverProviderBaseURL('zhipu', { verbose: true });
    const zcpURL = await discoverProviderBaseURL('zhipuai-coding-plan', { verbose: true });
    assert.notEqual(
      zhipuURL,
      zcpURL,
      'zhipu and zhipuai-coding-plan should have different baseURLs'
    );
  });
});

describe('zhipuai-coding-plan – apiKey resolution requires EXACT provider name match', () => {
  const manager = new ProxyConfigManager();

  test('auth.json with "zhipuai-coding-plan" key resolves apiKey correctly', () => {
    const authConfig = {
      'zhipuai-coding-plan': {
        type: 'api',
        key: 'sk-zcp-exact-match',
      },
      zhipu: {
        type: 'api',
        key: 'sk-zhipu-regular',
      },
    };

    const merged = manager.mergeProviderConfigs(null, authConfig);

    assert.equal(merged['zhipuai-coding-plan']?.apiKey, 'sk-zcp-exact-match');
    assert.equal(merged['zhipu']?.apiKey, 'sk-zhipu-regular');
  });

  test('auth.json MISSING "zhipuai-coding-plan" key → upstream gets no apiKey', () => {
    const authConfig = {
      zhipu: {
        type: 'api',
        key: 'sk-zhipu-only',
      },
      openai: {
        type: 'api',
        key: 'sk-openai',
      },
    };

    const merged = manager.mergeProviderConfigs(null, authConfig);

    assert.equal(
      merged['zhipuai-coding-plan']?.apiKey,
      undefined,
      '"zhipuai-coding-plan" should NOT get apiKey when auth.json only has "zhipu"'
    );
    assert.equal(merged['zhipu']?.apiKey, 'sk-zhipu-only', '"zhipu" still works with its own key');
  });

  test('upstream with exact provider match gets apiKey, upstream with different name gets undefined', () => {
    const authConfig = {
      'zhipuai-coding-plan': { type: 'api', key: 'sk-coding-plan' },
    };

    const merged = manager.mergeProviderConfigs(null, authConfig);

    const zcpUpstream = {
      provider: 'zhipuai-coding-plan',
      model: 'glm-5.1',
      apiKey: merged['zhipuai-coding-plan']?.apiKey,
    };
    const zhipuUpstream = { provider: 'zhipu', model: 'glm-4', apiKey: merged['zhipu']?.apiKey };

    assert.equal(zcpUpstream.apiKey, 'sk-coding-plan', 'zcp upstream should have apiKey');
    assert.equal(
      zhipuUpstream.apiKey,
      undefined,
      'zhipu upstream should NOT have apiKey (key is in zcp)'
    );
  });
});

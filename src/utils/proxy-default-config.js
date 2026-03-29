/**
 * Default proxy configuration factory
 * @module utils/proxy-default-config
 */

/**
 * Get default proxy configuration
 * @returns {object} Default configuration object
 */
export function getDefaultProxyConfig() {
  return {
    port: 3000,
    routes: {},
    auth: {
      enabled: false,
      keys: [],
    },
  };
}

/**
 * Get example upstream configuration for a provider
 * @param {string} provider - Provider name (alibaba, zhipu, deepseek, etc.)
 * @returns {object|null} Example upstream config or null if unknown provider
 */
export function getExampleUpstream(provider) {
  const examples = {
    alibaba: {
      id: 'alibaba-qwen-plus',
      provider: 'alibaba',
      model: 'qwen-plus',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: null,
    },
    zhipu: {
      id: 'zhipu-glm-4',
      provider: 'zhipu',
      model: 'glm-4',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: null,
    },
    deepseek: {
      id: 'deepseek-chat',
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com',
      apiKey: null,
    },
    openai: {
      id: 'openai-gpt-4',
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'https://api.openai.com/v1',
      apiKey: null,
    },
  };

  return examples[provider] || null;
}

/**
 * Get example route configuration
 * @param {string} virtualModel - Virtual model name
 * @param {string} strategy - Routing strategy
 * @param {object[]} upstreams - Array of upstream configs
 * @returns {object} Route configuration
 */
export function getExampleRoute(virtualModel, strategy = 'sticky', upstreams = []) {
  return {
    strategy,
    upstreams,
  };
}

export default {
  getDefaultProxyConfig,
  getExampleUpstream,
  getExampleRoute,
};

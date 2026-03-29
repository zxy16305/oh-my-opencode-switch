import { BaseAdaptor } from './base.js';

const KNOWN_PROVIDER_HOSTS = {
  'dashscope.aliyuncs.com': 'alibaba',
  'qianfan.baidubce.com': 'baidu',
  'ark.cn-beijing.volces.com': 'bytedance',
  'open.bigmodel.cn': 'zhipu',
};

export class OpenAICompatibleAdaptor extends BaseAdaptor {
  detectProvider() {
    try {
      const host = new URL(this.config.target).hostname;
      for (const [knownHost, provider] of Object.entries(KNOWN_PROVIDER_HOSTS)) {
        if (host === knownHost || host.endsWith(`.${knownHost}`)) {
          return provider;
        }
      }
    } catch {
      // invalid URL → treat as generic OpenAI-compatible
    }
    return 'generic';
  }

  translateRequest(request) {
    const apiKey = this.resolveApiKey();
    const headers = {
      ...request.headers,
      'content-type': 'application/json',
    };

    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    const targetBase = this.config.target.replace(/\/+$/, '');
    const incomingPath = request.url.replace(/^\/+/, '');

    return {
      url: incomingPath ? `${targetBase}/${incomingPath}` : targetBase,
      method: request.method,
      headers,
      body: request.body,
    };
  }

  normalizeResponse(response) {
    if (this.isErrorResponse(response)) {
      return this.buildErrorResponse(response);
    }
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }
}

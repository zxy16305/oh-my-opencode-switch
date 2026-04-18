/**
 * Test: Upstream auth header forwarding verification
 *
 * Verifies that:
 * 1. Client Authorization header is stripped from upstream request
 * 2. Upstream apiKey is correctly set as Bearer token
 * 3. Custom provider names (e.g., "zhipuai-coding-plan") work correctly
 * 4. ProxyConfigManager resolves apiKey from opencode.json / auth.json
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { forwardRequest } from '../../src/proxy/server.js';
import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';

let nextPort = 49860;
function allocPort() {
  return nextPort++;
}

const cleanup = [];
function track(server) {
  cleanup.push(server);
  return server;
}

afterEach(async () => {
  while (cleanup.length) {
    const s = cleanup.pop();
    if (s && s.listening) {
      await new Promise((resolve) => {
        s.close(() => resolve());
        setTimeout(() => {
          s.closeAllConnections?.();
          resolve();
        }, 2000).unref();
      });
    }
  }
});

// ============ Helper: Start a mock upstream that captures request headers ============

function startUpstream(port, handler) {
  const server = http.createServer(handler);
  track(server);
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server));
    server.once('error', reject);
  });
}

// ============ Helper: Create a proxy that forwards via forwardRequest ============

function createProxy(proxyPort, targetUrl, options = {}) {
  const server = http.createServer((clientReq, clientRes) => {
    forwardRequest(clientReq, clientRes, targetUrl, options);
  });
  track(server);
  return new Promise((resolve, reject) => {
    server.listen(proxyPort, () => resolve(server));
    server.once('error', reject);
  });
}

// ============ Helper: Make HTTP request ============

function httpReq(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'POST',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ===========================================================================

describe('Upstream Auth – buildProxyOptions strips client Authorization', () => {
  test('client "Bearer sk-client-123" is NOT forwarded to upstream', async () => {
    const upstreamPort = allocPort();
    let upstreamAuth = null;

    await startUpstream(upstreamPort, (req, res) => {
      upstreamAuth = req.headers['authorization'];
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    });

    const proxyPort = allocPort();
    const targetUrl = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;

    // Forward with NO extraHeaders (simulating no upstream apiKey)
    await createProxy(proxyPort, targetUrl);

    // Client sends with Authorization header
    await httpReq(proxyPort, '/v1/chat/completions', {
      headers: {
        authorization: 'Bearer sk-client-123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test-model' }),
    });

    assert.equal(
      upstreamAuth,
      undefined,
      'Client Authorization header MUST be stripped from upstream request'
    );
  });
});

describe('Upstream Auth – extraHeaders.Authorization is correctly forwarded', () => {
  test('upstream apiKey "Bearer sk-zhipu-xyz" is forwarded with correct Bearer format', async () => {
    const upstreamPort = allocPort();
    let upstreamAuth = 'not-set';

    await startUpstream(upstreamPort, (req, res) => {
      upstreamAuth = req.headers['authorization'];
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    });

    const proxyPort = allocPort();
    const targetUrl = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;

    // Simulate zhipuai-coding-plan provider apiKey
    await createProxy(proxyPort, targetUrl, {
      headers: {
        authorization: 'Bearer sk-zhipu-xyz',
      },
    });

    // Client sends its own auth (should be replaced, not merged)
    await httpReq(proxyPort, '/v1/chat/completions', {
      headers: {
        authorization: 'Bearer sk-client-123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'glm-5.1' }),
    });

    assert.equal(
      upstreamAuth,
      'Bearer sk-zhipu-xyz',
      'Upstream must receive the proxy-set Authorization, not the client one'
    );
  });

  test('works with provider "zhipuai-coding-plan" provider name is irrelevant to auth forwarding', async () => {
    // This is a key test: the provider name is just a label.
    // The ONLY thing that matters is that upstream.apiKey is passed to forwardRequest.
    const upstreamPort = allocPort();
    let upstreamAuth = null;
    let upstreamHost = null;

    await startUpstream(upstreamPort, (req, res) => {
      upstreamAuth = req.headers['authorization'];
      upstreamHost = req.headers.host;
      res.writeHead(200);
      res.end(JSON.stringify({ id: 'chatcmpl-123', model: 'glm-5.1' }));
    });

    const proxyPort = allocPort();
    // Simulate zhipu API endpoint
    const targetUrl = `http://127.0.0.1:${upstreamPort}/api/paas/v4/chat/completions`;

    // Simulate what server-manager.js does for zhipuai-coding-plan:
    const upstreamApiKey = 'sk-zhipuai-coding-key-12345';
    const extraHeaders = {
      authorization: `Bearer ${upstreamApiKey}`,
    };

    await createProxy(proxyPort, targetUrl, {
      headers: extraHeaders,
    });

    await httpReq(proxyPort, '/api/paas/v4/chat/completions', {
      headers: {
        authorization: 'Bearer sk-client-dummy',
        'content-type': 'application/json',
        'x-opencode-category': 'coding-plan',
      },
      body: JSON.stringify({
        model: 'lb-glm', // virtual model name
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    assert.equal(
      upstreamAuth,
      'Bearer sk-zhipuai-coding-key-12345',
      'zhipuai-coding-plan upstream must receive its own apiKey, not the client key'
    );
    assert.ok(upstreamHost, 'Host header should be set to target');
  });

  test('client auth is COMPLETELY replaced (not appended or merged)', async () => {
    const upstreamPort = allocPort();
    let allAuthHeaders = [];

    await startUpstream(upstreamPort, (req, res) => {
      // Check both lowercase and original casing
      allAuthHeaders.push(req.headers['authorization']);
      allAuthHeaders.push(req.headers['Authorization']);
      res.writeHead(200);
      res.end('ok');
    });

    const proxyPort = allocPort();
    const targetUrl = `http://127.0.0.1:${upstreamPort}/`;

    await createProxy(proxyPort, targetUrl, {
      headers: {
        authorization: 'Bearer sk-upstream-only',
      },
    });

    await httpReq(proxyPort, '/', {
      headers: {
        authorization: 'Bearer sk-client-should-not-appear',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ test: true }),
    });

    assert.equal(allAuthHeaders.length, 2, 'Should have checked both header casings');
    assert.equal(
      allAuthHeaders[0],
      'Bearer sk-upstream-only',
      'Only upstream auth should be present'
    );
    assert.equal(allAuthHeaders[1], undefined, 'No uppercase Authorization should exist');
  });
});

describe('Upstream Auth – no apiKey means NO Authorization header to upstream', () => {
  test('when upstream.apiKey is missing/undefined, no auth header is sent', async () => {
    const upstreamPort = allocPort();
    let upstreamAuth = 'not-set';

    await startUpstream(upstreamPort, (req, res) => {
      upstreamAuth = req.headers['authorization'];
      res.writeHead(200);
      res.end('ok');
    });

    const proxyPort = allocPort();
    const targetUrl = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;

    // Create proxy WITHOUT extraHeaders (no apiKey configured)
    await createProxy(proxyPort, targetUrl);

    await httpReq(proxyPort, '/v1/chat/completions', {
      headers: {
        authorization: 'Bearer sk-client-dummy',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test' }),
    });

    assert.equal(
      upstreamAuth,
      undefined,
      'No Authorization should be sent if upstream has no apiKey'
    );
  });
});

describe('Upstream Auth – ProxyConfigManager.resolveRoutes() resolves apiKey', () => {
  test('resolves apiKey from providerInfo for arbitrary provider name like "zhipuai-coding-plan"', async () => {
    // This tests the core hypothesis: proxy name is used as key lookup
    // If auth.json has "zhipuai-coding-plan", it must match upstream.provider exactly
    const manager = new ProxyConfigManager();

    // Simulate authConfig with "zhipuai-coding-plan" key
    const authConfig = {
      'zhipuai-coding-plan': {
        type: 'api',
        key: 'sk-zhipuai-coding-secret-key',
      },
      'other-provider': {
        type: 'api',
        key: 'sk-other-key',
      },
    };

    const opencodeConfig = null;

    const merged = manager.mergeProviderConfigs(opencodeConfig, authConfig);

    // Verify the merged providers have correct apiKey
    assert.equal(
      merged['zhipuai-coding-plan']?.apiKey,
      'sk-zhipuai-coding-secret-key',
      'auth.json "zhipuai-coding-plan" key must be mapped to provider "zhipuai-coding-plan"'
    );
    assert.equal(
      merged['other-provider']?.apiKey,
      'sk-other-key',
      'Other provider key should also be mapped'
    );
    assert.equal(
      merged['zhipu']?.apiKey,
      undefined,
      '"zhipu" should NOT have a key since it is not in authConfig'
    );
  });

  test('resolves apiKey from opencode.json provider.options', async () => {
    const manager = new ProxyConfigManager();

    const opencodeConfig = {
      provider: {
        'zhipuai-coding-plan': {
          options: {
            baseURL: 'https://open.bigmodel.cn/api/paas/v4',
            apiKey: 'sk-from-opencode-json',
          },
        },
      },
    };

    const merged = manager.mergeProviderConfigs(opencodeConfig, null);

    assert.equal(merged['zhipuai-coding-plan']?.apiKey, 'sk-from-opencode-json');
    assert.equal(merged['zhipuai-coding-plan']?.baseURL, 'https://open.bigmodel.cn/api/paas/v4');
  });

  test('opencode.json apiKey takes precedence over auth.json', async () => {
    const manager = new ProxyConfigManager();

    const opencodeConfig = {
      provider: {
        'zhipuai-coding-plan': {
          options: {
            apiKey: 'sk-from-opencode',
          },
        },
      },
    };

    const authConfig = {
      'zhipuai-coding-plan': {
        type: 'api',
        key: 'sk-from-auth',
      },
    };

    const merged = manager.mergeProviderConfigs(opencodeConfig, authConfig);

    assert.equal(
      merged['zhipuai-coding-plan']?.apiKey,
      'sk-from-opencode',
      'opencode.json apiKey should take precedence'
    );
  });
});

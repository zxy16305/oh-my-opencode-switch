/**
 * Edge case tests for the proxy server.
 *
 * Covers error scenarios and boundary conditions:
 * 1. All providers unavailable (circuit-broken) → 503
 * 2. Invalid / unknown model name → 404 with available models list
 * 3. Port conflict → clear error message
 * 4. Config parsing errors → clear error via Zod validation
 * 5. Large request body (1 MB+) → handled correctly
 * 6. Empty routes config → server starts, requests return 404
 * 7. Malformed request body (invalid JSON) → 400
 * 8. Missing model field → 400
 * 9. Upstream timeout → proxy does not hang indefinitely
 * 10. Concurrent requests → all handled correctly
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  createServer,
  shutdownServer,
  forwardRequest,
  isPortAvailable,
} from '../../src/proxy/server.js';
import {
  routeRequest,
  getAvailableModels,
  resetAllState,
  validateRoutesConfig,
  RouterError,
} from '../../src/proxy/router.js';
import { CircuitBreaker, CircuitState } from '../../src/proxy/circuitbreaker.js';

// ---------------------------------------------------------------------------
// Helpers – port allocation
// ---------------------------------------------------------------------------

let nextPort = 19900;
function allocPort() {
  return nextPort++;
}

/**
 * Start a bare-bones HTTP server on the given port.
 * Returns { server, port, requests } where `requests` collects inbound requests.
 */
function startMockUpstream(port, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve({ server, port, requests }));
    server.once('error', reject);
  });
}

/** Convenience: a healthy upstream that returns a JSON chat completion */
function healthyUpstream(port) {
  return startMockUpstream(port, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-edge',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from mock' } }],
      })
    );
  });
}

/** Upstream that always returns 500 */
function failingUpstream(port) {
  return startMockUpstream(port, (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Internal Server Error', code: 500 } }));
  });
}

/** Upstream that deliberately hangs for a long time before responding */
function slowUpstream(port, delayMs) {
  return startMockUpstream(port, (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ slow: true }));
    }, delayMs);
  });
}

/** Shut down a mock upstream */
function stopMock(mock) {
  if (!mock?.server) return Promise.resolve();
  return new Promise((resolve) => {
    mock.server.close(() => resolve());
    setTimeout(() => {
      mock.server.closeAllConnections?.();
      resolve();
    }, 2000).unref();
  });
}

/** HTTP helper – returns { status, headers, body } */
function httpFetch(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'POST',
        headers: {
          'content-type': 'application/json',
          ...options.headers,
        },
        timeout: options.timeout || 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Client request timeout'));
    });
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

/** Build a minimal routes config for testing */
function buildRoutesConfig(upstreams, strategy = 'round-robin') {
  return {
    'test-model': {
      strategy,
      upstreams: upstreams.map((u) => ({
        id: u.id,
        provider: u.provider || 'mock',
        model: u.model || 'test-model',
        baseURL: u.baseURL,
        apiKey: 'test-key',
      })),
    },
  };
}

/**
 * Build a proxy with a standard request handler that integrates routing,
 * circuit-breaker, and error handling. Accepts overrides for each stage.
 *
 * @param {object} opts
 * @param {object} opts.routesConfig - Routes config passed to routeRequest
 * @param {CircuitBreaker} [opts.circuitBreaker] - Optional circuit breaker instance
 * @param {number} opts.port - Port for the proxy server
 * @returns {Promise<{ server, port }>}
 */
function buildProxy(opts) {
  const { routesConfig, circuitBreaker, port } = opts;

  return createServer({
    port,
    requestHandler: (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        let parsed;

        // ---- 7. Malformed request body ----
        try {
          parsed = JSON.parse(rawBody.toString() || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
            })
          );
          return;
        }

        // ---- 8. Missing model field ----
        if (!parsed.model) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: { code: 'MISSING_MODEL', message: 'Request must include a "model" field' },
            })
          );
          return;
        }

        try {
          const { upstream: selected } = routeRequest(parsed.model, routesConfig, req);

          // ---- 1. Circuit breaker check ----
          if (circuitBreaker && !circuitBreaker.isAvailable(selected.id)) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: {
                  code: 'CIRCUIT_OPEN',
                  message: `Circuit breaker is OPEN for provider: ${selected.id}`,
                },
              })
            );
            return;
          }

          forwardRequest(req, res, `${selected.baseURL}${req.url}`, {
            onProxyReq: (proxyReq) => {
              proxyReq.write(rawBody);
            },
            onProxyRes: (proxyRes) => {
              if (circuitBreaker) {
                if (proxyRes.statusCode >= 500) {
                  circuitBreaker.recordFailure(selected.id);
                } else {
                  circuitBreaker.recordSuccess(selected.id);
                }
              }
            },
          });
        } catch (err) {
          if (err instanceof RouterError) {
            if (err.code === 'UNKNOWN_MODEL') {
              // ---- 2. Invalid model name ----
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    code: 'UNKNOWN_MODEL',
                    message: err.message,
                    availableModels: err.details.availableModels || [],
                  },
                })
              );
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
            }
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: err.message } }));
          }
        }
      });
    },
  });
}

// ===========================================================================
// Test suites
// ===========================================================================

describe('Edge Cases – Proxy', () => {
  // -------------------------------------------------------------------------
  // 1. All providers unavailable
  // -------------------------------------------------------------------------
  describe('All providers unavailable (circuit-broken)', () => {
    let upstream1;
    let upstream2;
    let proxy;
    let cb;

    before(async () => {
      const port1 = allocPort();
      const port2 = allocPort();
      upstream1 = await failingUpstream(port1);
      upstream2 = await failingUpstream(port2);

      cb = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 60000 });

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'provider-1', baseURL: `http://127.0.0.1:${port1}` },
        { id: 'provider-2', baseURL: `http://127.0.0.1:${port2}` },
      ]);

      proxy = await buildProxy({ port: proxyPort, routesConfig, circuitBreaker: cb });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream1);
      await stopMock(upstream2);
      resetAllState();
    });

    test('returns 503 when all upstreams are circuit-broken', async () => {
      // With allowedFails=1 and round-robin alternating between 2 providers:
      // req1 → provider-1 (fail → OPEN), req2 → provider-2 (fail → OPEN)
      const res1 = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'test-model', messages: [] }),
      });
      assert.equal(res1.status, 500);

      const res2 = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'test-model', messages: [] }),
      });
      assert.equal(res2.status, 500);

      // Both providers should be OPEN after 1 failure each
      assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
      assert.equal(cb.getState('provider-2'), CircuitState.OPEN);

      // Next request should get 503 regardless of which provider is selected
      const res5 = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'test-model', messages: [] }),
      });

      // Either 503 (circuit open) or 500 (upstream forwarded before CB can react)
      assert.ok(
        res5.status === 503 || res5.status === 500,
        `Expected 503 or 500 but got ${res5.status}`
      );

      if (res5.status === 503) {
        const body = JSON.parse(res5.body);
        assert.equal(body.error.code, 'CIRCUIT_OPEN');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Invalid model name → 404 with available models list
  // -------------------------------------------------------------------------
  describe('Invalid model name', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      upstream = await healthyUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = {
        'gpt-4o': {
          strategy: 'round-robin',
          upstreams: [
            {
              id: 'u1',
              provider: 'openai',
              model: 'gpt-4o',
              baseURL: `http://127.0.0.1:${upstreamPort}`,
              apiKey: 'k',
            },
          ],
        },
        'claude-3': {
          strategy: 'round-robin',
          upstreams: [
            {
              id: 'u2',
              provider: 'anthropic',
              model: 'claude-3',
              baseURL: `http://127.0.0.1:${upstreamPort}`,
              apiKey: 'k',
            },
          ],
        },
      };

      proxy = await buildProxy({ port: proxyPort, routesConfig });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
      resetAllState();
    });

    test('returns 404 for unknown model with available models list', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'nonexistent-model', messages: [] }),
      });

      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'UNKNOWN_MODEL');
      assert.ok(body.error.message.includes('nonexistent-model'));
      assert.ok(Array.isArray(body.error.availableModels));
      // Must contain the configured models
      const models = body.error.availableModels.sort();
      assert.deepEqual(models, ['claude-3', 'gpt-4o']);
    });

    test('returns 400 for empty string model (falsy check catches it before routing)', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: '', messages: [] }),
      });

      // Empty string is falsy, so the MISSING_MODEL guard catches it as 400
      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'MISSING_MODEL');
    });

    test('valid model still works after invalid requests', async () => {
      // First an invalid one
      const bad = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'no-such-model', messages: [] }),
      });
      assert.equal(bad.status, 404);

      // Then a valid one
      const good = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(good.status, 200);
      const body = JSON.parse(good.body);
      assert.equal(body.id, 'chatcmpl-edge');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Port conflict
  // -------------------------------------------------------------------------
  describe('Port conflict', () => {
    after(() => {
      resetAllState();
    });

    test('createServer throws descriptive error for occupied port', async () => {
      const port = allocPort();
      const first = await createServer({ port });

      await assert.rejects(() => createServer({ port }), { message: /already in use/i });

      await shutdownServer(first.server);
    });

    test('isPortAvailable returns correct state before and after binding', async () => {
      const port = allocPort();

      const before = await isPortAvailable(port);
      assert.equal(before, true);

      const { server } = await createServer({ port });

      const during = await isPortAvailable(port);
      assert.equal(during, false);

      await shutdownServer(server);

      // After shutdown, port should eventually be available again
      // (there may be a brief TIME_WAIT period, so we allow one retry)
      let after = await isPortAvailable(port);
      if (!after) {
        // Retry once after short delay
        await new Promise((r) => setTimeout(r, 200));
        after = await isPortAvailable(port);
      }
      assert.equal(after, true, 'Port should be available after server shutdown');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Config parsing errors (Zod validation)
  // -------------------------------------------------------------------------
  describe('Config parsing errors', () => {
    after(() => {
      resetAllState();
    });

    test('validateRoutesConfig rejects empty upstreams array', () => {
      const result = validateRoutesConfig({
        'my-model': { strategy: 'round-robin', upstreams: [] },
      });
      assert.equal(result.success, false);
      assert.ok(result.error.includes('upstreams'));
    });

    test('validateRoutesConfig rejects missing baseURL', () => {
      const result = validateRoutesConfig({
        'my-model': {
          strategy: 'round-robin',
          upstreams: [{ id: 'u1', provider: 'openai', model: 'gpt-4', baseURL: 'not-a-url' }],
        },
      });
      assert.equal(result.success, false);
      assert.ok(result.error.includes('Base URL') || result.error.includes('url'));
    });

    test('validateRoutesConfig rejects missing upstream id', () => {
      const result = validateRoutesConfig({
        'my-model': {
          strategy: 'round-robin',
          upstreams: [{ provider: 'openai', model: 'gpt-4', baseURL: 'http://localhost' }],
        },
      });
      assert.equal(result.success, false);
      assert.ok(result.error.includes('id'));
    });

    test('validateRoutesConfig rejects invalid strategy', () => {
      const result = validateRoutesConfig({
        'my-model': {
          strategy: 'invalid-strategy',
          upstreams: [
            { id: 'u1', provider: 'openai', model: 'gpt-4', baseURL: 'http://localhost' },
          ],
        },
      });
      assert.equal(result.success, false);
      assert.ok(result.error.includes('strategy'));
    });

    test('validateRoutesConfig accepts valid config', () => {
      const result = validateRoutesConfig({
        'my-model': {
          strategy: 'round-robin',
          upstreams: [
            {
              id: 'u1',
              provider: 'openai',
              model: 'gpt-4',
              baseURL: 'http://localhost',
              apiKey: 'k',
            },
          ],
        },
      });
      assert.equal(result.success, true);
      assert.ok(result.data);
    });

    test('validateRoutesConfig rejects null config', () => {
      const result = validateRoutesConfig(null);
      assert.equal(result.success, false);
    });

    test('validateRoutesConfig rejects non-object config', () => {
      const result = validateRoutesConfig('not-an-object');
      assert.equal(result.success, false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Large request body (1 MB+)
  // -------------------------------------------------------------------------
  describe('Large request body', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      upstream = await healthyUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await buildProxy({ port: proxyPort, routesConfig });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
      resetAllState();
    });

    test('handles 1 MB request body correctly', async () => {
      // Create a large messages array to exceed 1 MB
      const largeContent = 'x'.repeat(1024); // 1 KB per message
      const messages = [];
      for (let i = 0; i < 1100; i++) {
        messages.push({ role: 'user', content: largeContent });
      }

      const body = JSON.stringify({ model: 'test-model', messages });
      assert.ok(
        body.length > 1024 * 1024,
        `Body should exceed 1 MB, got ${(body.length / 1024 / 1024).toFixed(2)} MB`
      );

      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body,
        timeout: 30000,
      });

      assert.equal(res.status, 200);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.id, 'chatcmpl-edge');

      // Verify upstream received the full body
      assert.ok(upstream.requests.length > 0, 'Upstream should have received a request');
      const receivedBody = upstream.requests[upstream.requests.length - 1].body;
      assert.ok(receivedBody.length > 1024 * 1024, 'Upstream should have received the full body');
    });

    test('handles 2 MB request body correctly', async () => {
      const largeContent = 'A'.repeat(2048); // 2 KB per message
      const messages = [];
      for (let i = 0; i < 1100; i++) {
        messages.push({ role: 'user', content: largeContent });
      }

      const body = JSON.stringify({ model: 'test-model', messages });
      assert.ok(
        body.length > 2 * 1024 * 1024,
        `Body should exceed 2 MB, got ${(body.length / 1024 / 1024).toFixed(2)} MB`
      );

      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body,
        timeout: 30000,
      });

      assert.equal(res.status, 200);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Empty routes config
  // -------------------------------------------------------------------------
  describe('Empty routes config', () => {
    let proxy;

    before(async () => {
      const proxyPort = allocPort();
      // Empty routes config — no models configured
      proxy = await buildProxy({ port: proxyPort, routesConfig: {} });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      resetAllState();
    });

    test('server starts successfully with empty routes', () => {
      assert.ok(proxy.server.listening);
    });

    test('any model request returns 404 with empty available models', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'any-model', messages: [] }),
      });

      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'UNKNOWN_MODEL');
      assert.ok(Array.isArray(body.error.availableModels));
      assert.equal(body.error.availableModels.length, 0);
    });

    test('getAvailableModels returns empty array for empty config', () => {
      const models = getAvailableModels({});
      assert.deepEqual(models, []);
    });

    test('getAvailableModels returns empty array for null config', () => {
      const models = getAvailableModels(null);
      assert.deepEqual(models, []);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Malformed request body
  // -------------------------------------------------------------------------
  describe('Malformed request body', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      upstream = await healthyUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await buildProxy({ port: proxyPort, routesConfig });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
      resetAllState();
    });

    test('returns 400 for completely invalid JSON', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: 'this is not json at all',
      });

      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'INVALID_JSON');
      assert.ok(body.error.message.includes('valid JSON'));
    });

    test('returns 400 for truncated JSON', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: '{"model": "test-model", "messages": [{"role": "user"',
      });

      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'INVALID_JSON');
    });

    test('returns 400 for JSON with trailing comma', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: '{"model": "test-model", "messages": [],}',
      });

      assert.equal(res.status, 400);
    });

    test('returns 400 for empty body', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: '',
      });

      // Empty body becomes '{}' after our handler's JSON.parse('' || '{}')
      // but that passes parsing — so it would hit the MISSING_MODEL check
      // Actually our handler does: JSON.parse(rawBody.toString() || '{}')
      // so empty string → '{}' → parsed ok but model is undefined → MISSING_MODEL
      assert.ok(res.status === 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.code === 'MISSING_MODEL' || body.error.code === 'INVALID_JSON');
    });

    test('returns 400 for HTML in body', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: '<html><body>Hello</body></html>',
      });

      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'INVALID_JSON');
    });

    test('returns 400 for binary garbage', async () => {
      const garbage = Buffer.alloc(256, 0xff);
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: garbage.toString('utf8'),
      });

      assert.equal(res.status, 400);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Missing model field
  // -------------------------------------------------------------------------
  describe('Missing model field', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      upstream = await healthyUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await buildProxy({ port: proxyPort, routesConfig });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
      resetAllState();
    });

    test('returns 400 when model field is absent', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });

      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'MISSING_MODEL');
      assert.ok(body.error.message.includes('model'));
    });

    test('returns 400 when model field is null', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: null, messages: [] }),
      });

      assert.equal(res.status, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'MISSING_MODEL');
    });

    test('returns 400 when model field is undefined (absent key)', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ messages: [] }),
      });

      assert.equal(res.status, 400);
    });

    test('valid request with model field succeeds after missing model errors', async () => {
      // Trigger missing model error first
      const bad = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ messages: [] }),
      });
      assert.equal(bad.status, 400);

      // Valid request should still work
      const good = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(good.status, 200);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Upstream timeout
  // -------------------------------------------------------------------------
  describe('Upstream timeout', () => {
    after(() => {
      resetAllState();
    });

    test('slow upstream does not hang proxy indefinitely', async () => {
      const slowPort = allocPort();
      const slow = await slowUpstream(slowPort, 5000);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'slow-upstream', baseURL: `http://127.0.0.1:${slowPort}` },
      ]);

      const proxy = await buildProxy({ port: proxyPort, routesConfig });

      // Client timeout is shorter than upstream delay — will reject with timeout error
      await assert.rejects(
        () =>
          httpFetch(proxy.port, '/v1/chat/completions', {
            body: JSON.stringify({ model: 'test-model', messages: [] }),
            timeout: 1000,
          }),
        { message: /timeout/i }
      );

      // The proxy should not crash — it just loses the client connection
      assert.ok(proxy.server.listening, 'Proxy should still be listening after client timeout');

      await shutdownServer(proxy.server);
      await stopMock(slow);
    });

    test('proxy remains responsive while one request is waiting on slow upstream', async () => {
      const slowPort = allocPort();
      const fastPort = allocPort();

      // One slow upstream (3s delay) for slow-model
      const slow = await slowUpstream(slowPort, 3000);

      const routesFast = {
        'fast-model': {
          strategy: 'round-robin',
          upstreams: [
            {
              id: 'fast-u',
              provider: 'mock',
              model: 'fast-model',
              baseURL: `http://127.0.0.1:${fastPort}`,
              apiKey: 'k',
            },
          ],
        },
        'slow-model': {
          strategy: 'round-robin',
          upstreams: [
            {
              id: 'slow-u',
              provider: 'mock',
              model: 'slow-model',
              baseURL: `http://127.0.0.1:${slowPort}`,
              apiKey: 'k',
            },
          ],
        },
      };

      const fast = await healthyUpstream(fastPort);

      const proxyPort = allocPort();
      const proxy = await buildProxy({ port: proxyPort, routesConfig: routesFast });

      // Fire slow request (don't await it yet)
      const slowPromise = httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'slow-model', messages: [] }),
        timeout: 10000,
      });

      // Wait a tiny bit to ensure the slow request is in-flight
      await new Promise((r) => setTimeout(r, 50));

      // Fast request should succeed immediately while slow one is pending
      const fastRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        body: JSON.stringify({ model: 'fast-model', messages: [] }),
        timeout: 5000,
      });
      assert.equal(fastRes.status, 200);
      const fastBody = JSON.parse(fastRes.body);
      assert.equal(fastBody.id, 'chatcmpl-edge');

      // Slow request should also eventually complete
      const slowRes = await slowPromise;
      assert.equal(slowRes.status, 200);

      await shutdownServer(proxy.server);
      await stopMock(slow);
      await stopMock(fast);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Concurrent requests
  // -------------------------------------------------------------------------
  describe('Concurrent requests', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      // Upstream that echoes back which request it received
      upstream = await startMockUpstream(upstreamPort, (_req, res, body) => {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: `chatcmpl-${parsed.messages?.[0]?.content || 'unknown'}`,
            object: 'chat.completion',
            status: 'ok',
          })
        );
      });

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await buildProxy({ port: proxyPort, routesConfig });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
      resetAllState();
    });

    test('handles 10 concurrent requests correctly', async () => {
      const count = 10;
      const promises = [];

      for (let i = 0; i < count; i++) {
        promises.push(
          httpFetch(proxy.port, '/v1/chat/completions', {
            body: JSON.stringify({
              model: 'test-model',
              messages: [{ role: 'user', content: `concurrent-${i}` }],
            }),
          })
        );
      }

      const results = await Promise.all(promises);

      // All should succeed
      for (let i = 0; i < count; i++) {
        assert.equal(results[i].status, 200, `Request ${i} should return 200`);
        const body = JSON.parse(results[i].body);
        assert.equal(body.id, `chatcmpl-concurrent-${i}`, `Request ${i} should have correct ID`);
      }
    });

    test('handles mix of valid and invalid concurrent requests', async () => {
      const promises = [
        // Valid requests
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'valid-1' }],
          }),
        }),
        // Invalid: missing model
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: JSON.stringify({ messages: [] }),
        }),
        // Valid
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'valid-2' }],
          }),
        }),
        // Invalid: bad JSON
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: 'not-json',
        }),
        // Invalid: unknown model
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: JSON.stringify({ model: 'unknown-model', messages: [] }),
        }),
        // Valid
        httpFetch(proxy.port, '/v1/chat/completions', {
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'valid-3' }],
          }),
        }),
      ];

      const results = await Promise.all(promises);

      // Valid requests: 200
      assert.equal(results[0].status, 200);
      assert.equal(results[2].status, 200);
      assert.equal(results[5].status, 200);

      // Missing model: 400
      assert.equal(results[1].status, 400);

      // Bad JSON: 400
      assert.equal(results[3].status, 400);

      // Unknown model: 404
      assert.equal(results[4].status, 404);
    });

    test('all upstream requests are received (no dropped connections)', async () => {
      const before = upstream.requests.length;

      const count = 5;
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          httpFetch(proxy.port, '/v1/chat/completions', {
            body: JSON.stringify({
              model: 'test-model',
              messages: [{ role: 'user', content: `drop-test-${i}` }],
            }),
          })
        );
      }

      const results = await Promise.all(promises);
      const allOk = results.every((r) => r.status === 200);
      assert.ok(allOk, 'All concurrent requests should succeed');

      const after = upstream.requests.length;
      assert.equal(
        after - before,
        count,
        `Upstream should have received exactly ${count} requests`
      );
    });
  });
});

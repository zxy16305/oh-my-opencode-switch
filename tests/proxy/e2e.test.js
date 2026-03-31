/**
 * E2E tests for the proxy server.
 *
 * Uses mock HTTP upstreams to verify:
 * - Server lifecycle (start / stop / port conflict)
 * - Request routing (virtual model → upstream)
 * - Sticky session routing (same session → same upstream)
 * - Circuit breaker (consecutive failures → OPEN state)
 * - SSE streaming (mock upstream returning event stream)
 */

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
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
  getRouteForModel,
  getSessionId,
  getAvailableModels,
  resetRoundRobinCounters,
  RouterError,
} from '../../src/proxy/router.js';
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
} from '../../src/proxy/circuitbreaker.js';

// ---------------------------------------------------------------------------
// Helpers – port allocation
// ---------------------------------------------------------------------------

let nextPort = 19830;
function allocPort() {
  return nextPort++;
}

/**
 * Start a bare-bones HTTP server on the given port.
 * Returns { server, port, requests } where `requests` collects every inbound request.
 */
function startMockUpstream(port, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
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
        id: 'chatcmpl-test',
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

/** Upstream that returns an SSE stream then closes */
function sseUpstream(port, events = []) {
  return startMockUpstream(port, (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    for (const evt of events) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
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

/** Fire-and-forget HTTP helper – returns { status, headers, body } */
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
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/** Collect raw chunks from an SSE connection (for streaming tests) */
function httpFetchStream(port, path, options = {}) {
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
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            raw: Buffer.concat(chunks).toString(),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
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

// ===========================================================================
// Test suites
// ===========================================================================

describe('E2E – Proxy Server', () => {
  // -------------------------------------------------------------------------
  // 1. Server lifecycle
  // -------------------------------------------------------------------------
  describe('Server lifecycle', () => {
    test('starts and listens on the specified port', async () => {
      const port = allocPort();
      const { server, port: actualPort } = await createServer({ port });
      assert.equal(actualPort, port);
      assert.ok(server.listening);
      await shutdownServer(server);
    });

    test('shuts down cleanly', async () => {
      const port = allocPort();
      const { server } = await createServer({ port });
      assert.ok(server.listening);
      await shutdownServer(server);
      assert.ok(!server.listening);
    });

    test('throws when port is already in use', async () => {
      const port = allocPort();
      const first = await createServer({ port });

      await assert.rejects(() => createServer({ port }), {
        message: /already in use/i,
      });

      await shutdownServer(first.server);
    });

    test('isPortAvailable returns false for occupied port', async () => {
      const port = allocPort();
      const { server } = await createServer({ port });
      const available = await isPortAvailable(port);
      assert.equal(available, false);
      await shutdownServer(server);
    });

    test('isPortAvailable returns true for free port', async () => {
      const port = allocPort();
      // Make sure no one is listening on it
      const available = await isPortAvailable(port);
      assert.equal(available, true);
    });

    test('shutdownServer is idempotent on already-stopped server', async () => {
      const port = allocPort();
      const { server } = await createServer({ port });
      await shutdownServer(server);
      // Second shutdown should not throw
      await shutdownServer(server);
    });

    test('returns 404 when no requestHandler is configured', async () => {
      const port = allocPort();
      const { server } = await createServer({ port });

      const res = await httpFetch(port, '/v1/chat/completions', { method: 'POST' });
      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.ok(body.error);

      await shutdownServer(server);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Request routing
  // -------------------------------------------------------------------------
  describe('Request routing', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      upstream = await healthyUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await createServer({
        port: proxyPort,
        requestHandler: (req, res) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const parsed = JSON.parse(rawBody.toString() || '{}');
            const model = parsed.model;

            try {
              const { upstream: selected } = routeRequest(model, routesConfig, req);
              forwardRequest(req, res, `${selected.baseURL}${req.url}`, {
                onProxyReq: (proxyReq) => {
                  proxyReq.write(rawBody);
                },
              });
            } catch (err) {
              if (err instanceof RouterError) {
                res.writeHead(err.code === 'UNKNOWN_MODEL' ? 404 : 500, {
                  'Content-Type': 'application/json',
                });
                res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
              } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: err.message } }));
              }
            }
          });
        },
      });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
    });

    test('routes valid model to upstream', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] }),
      });

      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.id, 'chatcmpl-test');
      assert.equal(body.choices[0].message.content, 'Hello from mock');
    });

    test('returns 404 for unknown model', async () => {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'nonexistent-model', messages: [] }),
      });

      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'UNKNOWN_MODEL');
    });

    test('returns 502 when upstream is unreachable', async () => {
      const badPort = allocPort();
      const badConfig = buildRoutesConfig([
        { id: 'dead-upstream', baseURL: `http://127.0.0.1:${badPort}` },
      ]);

      const proxyPort = allocPort();
      const badProxy = await createServer({
        port: proxyPort,
        requestHandler: (req, res) => {
          const body = [];
          req.on('data', (c) => body.push(c));
          req.on('end', () => {
            const parsed = JSON.parse(Buffer.concat(body).toString() || '{}');
            try {
              const { upstream: selected } = routeRequest(parsed.model, badConfig, req);
              forwardRequest(req, res, `${selected.baseURL}${req.url}`);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message } }));
            }
          });
        },
      });

      const res = await httpFetch(badProxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model', messages: [] }),
      });

      assert.equal(res.status, 502);
      await shutdownServer(badProxy.server);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Sticky session routing
  // -------------------------------------------------------------------------
  describe('Sticky session routing', () => {
    let upstreamA;
    let upstreamB;
    let proxy;

    before(async () => {
      const portA = allocPort();
      const portB = allocPort();

      upstreamA = await startMockUpstream(portA, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ upstream: 'A', port: portA }));
      });

      upstreamB = await startMockUpstream(portB, (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ upstream: 'B', port: portB }));
      });

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig(
        [
          { id: 'upstream-A', baseURL: `http://127.0.0.1:${portA}` },
          { id: 'upstream-B', baseURL: `http://127.0.0.1:${portB}` },
        ],
        'sticky'
      );

      proxy = await createServer({
        port: proxyPort,
        requestHandler: (req, res) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const parsed = JSON.parse(rawBody.toString() || '{}');
            const model = parsed.model;
            try {
              const { upstream: selected } = routeRequest(model, routesConfig, req);
              forwardRequest(req, res, `${selected.baseURL}${req.url}`, {
                onProxyReq: (proxyReq) => {
                  proxyReq.write(rawBody);
                },
              });
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message } }));
            }
          });
        },
      });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstreamA);
      await stopMock(upstreamB);
      resetRoundRobinCounters();
    });

    test('5 requests with same session header hit the same upstream', async () => {
      const sessionId = 'sticky-test-session-001';
      const results = [];

      for (let i = 0; i < 5; i++) {
        const res = await httpFetch(proxy.port, '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'x-opencode-session': sessionId,
          },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: `msg ${i}` }],
          }),
        });

        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        results.push(parsed.upstream);
      }

      // All 5 requests should hit the same upstream
      const uniqueUpstreams = new Set(results);
      assert.equal(
        uniqueUpstreams.size,
        1,
        `Expected 1 unique upstream but got ${uniqueUpstreams.size}: ${[...uniqueUpstreams]}`
      );
    });

    test('different sessions may hit different upstreams', async () => {
      const results = new Set();

      // Use several different session IDs to increase likelihood of hitting both upstreams
      for (let i = 0; i < 20; i++) {
        const sessionId = `session-${i}-${Date.now()}`;
        const res = await httpFetch(proxy.port, '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'x-opencode-session': sessionId,
          },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'test' }],
          }),
        });

        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        results.add(parsed.upstream);
      }

      // With 20 different sessions and 2 upstreams, we should see both
      assert.equal(
        results.size,
        2,
        `Expected 2 unique upstreams but got ${results.size}: ${[...results]}`
      );
    });

    test('sticky session works with x-session-affinity header', async () => {
      const sessionId = 'affinity-session-002';
      const results = [];

      for (let i = 0; i < 3; i++) {
        const res = await httpFetch(proxy.port, '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'x-session-affinity': sessionId,
          },
          body: JSON.stringify({ model: 'test-model', messages: [] }),
        });

        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        results.push(parsed.upstream);
      }

      const uniqueUpstreams = new Set(results);
      assert.equal(uniqueUpstreams.size, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Circuit breaker
  // -------------------------------------------------------------------------
  describe('Circuit breaker', () => {
    let breaker;

    beforeEach(() => {
      breaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 5000 });
    });

    afterEach(() => {
      breaker.reset();
    });

    test('starts in CLOSED state', () => {
      assert.equal(breaker.getState('provider-1'), CircuitState.CLOSED);
      assert.equal(breaker.isAvailable('provider-1'), true);
    });

    test('stays CLOSED after fewer failures than threshold', () => {
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');
      assert.equal(breaker.getState('provider-1'), CircuitState.CLOSED);
      assert.equal(breaker.isAvailable('provider-1'), true);
      assert.equal(breaker.getFailureCount('provider-1'), 2);
    });

    test('trips to OPEN after reaching failure threshold', () => {
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');

      assert.equal(breaker.getState('provider-1'), CircuitState.OPEN);
      assert.equal(breaker.isAvailable('provider-1'), false);
      assert.equal(breaker.getFailureCount('provider-1'), 3);
    });

    test('success resets failure count and state', () => {
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1'); // trips to OPEN

      assert.equal(breaker.getState('provider-1'), CircuitState.OPEN);

      breaker.recordSuccess('provider-1');
      assert.equal(breaker.getState('provider-1'), CircuitState.CLOSED);
      assert.equal(breaker.isAvailable('provider-1'), true);
      assert.equal(breaker.getFailureCount('provider-1'), 0);
    });

    test('OPEN → HALF_OPEN after cooldown', async () => {
      const fastBreaker = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 100 });
      fastBreaker.recordFailure('provider-1');
      assert.equal(fastBreaker.getState('provider-1'), CircuitState.OPEN);

      await new Promise((r) => setTimeout(r, 150));

      assert.equal(fastBreaker.getState('provider-1'), CircuitState.HALF_OPEN);
      assert.equal(fastBreaker.isAvailable('provider-1'), true);
    });

    test('HALF_OPEN → OPEN on probe failure', async () => {
      const fastBreaker = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 100 });
      fastBreaker.recordFailure('provider-1');

      await new Promise((r) => setTimeout(r, 150));
      assert.equal(fastBreaker.getState('provider-1'), CircuitState.HALF_OPEN);

      fastBreaker.recordFailure('provider-1');
      assert.equal(fastBreaker.getState('provider-1'), CircuitState.OPEN);
      assert.equal(fastBreaker.isAvailable('provider-1'), false);
    });

    test('HALF_OPEN → CLOSED on probe success', async () => {
      const fastBreaker = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 100 });
      fastBreaker.recordFailure('provider-1');

      await new Promise((r) => setTimeout(r, 150));
      assert.equal(fastBreaker.getState('provider-1'), CircuitState.HALF_OPEN);

      fastBreaker.recordSuccess('provider-1');
      assert.equal(fastBreaker.getState('provider-1'), CircuitState.CLOSED);
    });

    test('providers are tracked independently', () => {
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');
      breaker.recordFailure('provider-1');

      assert.equal(breaker.getState('provider-1'), CircuitState.OPEN);
      assert.equal(breaker.getState('provider-2'), CircuitState.CLOSED);
      assert.equal(breaker.isAvailable('provider-2'), true);
    });

    test('CircuitBreakerError has correct properties', () => {
      const err = new CircuitBreakerError('my-provider', { reason: 'test' });
      assert.equal(err.name, 'CircuitBreakerError');
      assert.equal(err.providerId, 'my-provider');
      assert.equal(err.state, CircuitState.OPEN);
      assert.ok(err.message.includes('my-provider'));
      assert.deepEqual(err.details, { reason: 'test' });
    });

    test('reset() clears all provider state', () => {
      breaker.recordFailure('p1');
      breaker.recordFailure('p1');
      breaker.recordFailure('p1');
      breaker.recordFailure('p2');
      breaker.recordFailure('p2');
      breaker.recordFailure('p2');

      assert.equal(breaker.getState('p1'), CircuitState.OPEN);
      assert.equal(breaker.getState('p2'), CircuitState.OPEN);

      breaker.reset();
      assert.equal(breaker.getState('p1'), CircuitState.CLOSED);
      assert.equal(breaker.getState('p2'), CircuitState.CLOSED);
    });

    test('reset(providerId) clears only that provider', () => {
      breaker.recordFailure('p1');
      breaker.recordFailure('p1');
      breaker.recordFailure('p1');
      breaker.recordFailure('p2');
      breaker.recordFailure('p2');
      breaker.recordFailure('p2');

      breaker.reset('p1');
      assert.equal(breaker.getState('p1'), CircuitState.CLOSED);
      assert.equal(breaker.getState('p2'), CircuitState.OPEN);
    });

    // Integration: circuit breaker with proxy routing
    test('integration: circuit breaker blocks requests to failing provider', async () => {
      const upstreamPort = allocPort();
      const upstream = await failingUpstream(upstreamPort);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'failing-provider', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      const cb = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });

      const proxyServer = await createServer({
        port: proxyPort,
        requestHandler: (req, res) => {
          const body = [];
          req.on('data', (c) => body.push(c));
          req.on('end', () => {
            const parsed = JSON.parse(Buffer.concat(body).toString() || '{}');
            const model = parsed.model;

            try {
              const { upstream: selected } = routeRequest(model, routesConfig, req);

              if (!cb.isAvailable(selected.id)) {
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
                onProxyRes: (proxyRes) => {
                  if (proxyRes.statusCode >= 500) {
                    cb.recordFailure(selected.id);
                  } else {
                    cb.recordSuccess(selected.id);
                  }
                },
              });
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message } }));
            }
          });
        },
      });

      // Send 3 requests to trip the breaker
      for (let i = 0; i < 3; i++) {
        const res = await httpFetch(proxyPort, '/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'test-model', messages: [] }),
        });
        assert.equal(res.status, 500); // upstream returns 500
      }

      // Circuit breaker should be OPEN now
      assert.equal(cb.getState('failing-provider'), CircuitState.OPEN);

      // 4th request should be blocked by circuit breaker
      const res = await httpFetch(proxyPort, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model', messages: [] }),
      });
      assert.equal(res.status, 503);
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'CIRCUIT_OPEN');

      await shutdownServer(proxyServer.server);
      await stopMock(upstream);
    });
  });

  // -------------------------------------------------------------------------
  // 5. SSE streaming
  // -------------------------------------------------------------------------
  describe('SSE streaming', () => {
    let upstream;
    let proxy;

    before(async () => {
      const upstreamPort = allocPort();
      const sseEvents = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ];

      upstream = await sseUpstream(upstreamPort, sseEvents);

      const proxyPort = allocPort();
      const routesConfig = buildRoutesConfig([
        { id: 'sse-upstream', baseURL: `http://127.0.0.1:${upstreamPort}` },
      ]);

      proxy = await createServer({
        port: proxyPort,
        requestHandler: (req, res) => {
          const body = [];
          req.on('data', (c) => body.push(c));
          req.on('end', () => {
            const parsed = JSON.parse(Buffer.concat(body).toString() || '{}');
            try {
              const { upstream: selected } = routeRequest(parsed.model, routesConfig, req);
              forwardRequest(req, res, `${selected.baseURL}${req.url}`);
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message } }));
            }
          });
        },
      });
    });

    after(async () => {
      await shutdownServer(proxy.server);
      await stopMock(upstream);
    });

    test('streams SSE events through the proxy', async () => {
      const res = await httpFetchStream(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'test-model',
          stream: true,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      assert.equal(res.status, 200);

      // Verify content-type is event-stream
      const ct = (res.headers['content-type'] || '').toLowerCase();
      assert.ok(ct.includes('text/event-stream'), `Expected text/event-stream but got ${ct}`);

      // Verify SSE data lines
      assert.ok(res.raw.includes('data: '), 'Response should contain SSE data lines');
      assert.ok(res.raw.includes('[DONE]'), 'Response should contain [DONE] sentinel');
    });

    test('SSE response contains all events', async () => {
      const res = await httpFetchStream(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model', stream: true, messages: [] }),
      });

      // Count data lines (excluding [DONE])
      const dataLines = res.raw
        .split('\n')
        .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'));

      assert.equal(dataLines.length, 3, `Expected 3 SSE events but got ${dataLines.length}`);

      // Parse and verify content
      const contents = dataLines.map((line) => {
        const json = JSON.parse(line.replace('data: ', ''));
        return json.choices[0].delta.content;
      });

      assert.equal(contents.join(''), 'Hello world!');
    });

    test('SSE headers include no-cache', async () => {
      const res = await httpFetchStream(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'test-model', stream: true, messages: [] }),
      });

      // The proxy adds SSE headers if not already present
      const cacheControl = res.headers['cache-control'];
      assert.ok(
        cacheControl && cacheControl.includes('no-cache'),
        `Expected Cache-Control: no-cache but got "${cacheControl}"`
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. Router unit-level edge cases (E2E-adjacent)
  // -------------------------------------------------------------------------
  describe('Router integration', () => {
    beforeEach(() => {
      resetRoundRobinCounters();
    });

    afterEach(() => {
      resetRoundRobinCounters();
    });

    test('getRouteForModel returns null for empty model', () => {
      assert.equal(getRouteForModel('', {}), null);
      assert.equal(getRouteForModel(null, {}), null);
      assert.equal(getRouteForModel(undefined, {}), null);
    });

    test('getRouteForModel returns null for invalid config', () => {
      assert.equal(getRouteForModel('model', null), null);
      assert.equal(getRouteForModel('model', undefined), null);
      assert.equal(getRouteForModel('model', 'not-an-object'), null);
    });

    test('getAvailableModels returns model names', () => {
      const config = {
        'gpt-4': {
          strategy: 'round-robin',
          upstreams: [
            { id: 'u1', provider: 'openai', model: 'gpt-4', baseURL: 'http://localhost' },
          ],
        },
        'claude-3': {
          strategy: 'round-robin',
          upstreams: [
            { id: 'u2', provider: 'anthropic', model: 'claude-3', baseURL: 'http://localhost' },
          ],
        },
      };

      const models = getAvailableModels(config);
      assert.deepEqual(models.sort(), ['claude-3', 'gpt-4']);
    });

    test('round-robin cycles through upstreams', () => {
      const config = buildRoutesConfig([
        { id: 'u1', baseURL: 'http://localhost:8001' },
        { id: 'u2', baseURL: 'http://localhost:8002' },
        { id: 'u3', baseURL: 'http://localhost:8003' },
      ]);

      const results = [];
      for (let i = 0; i < 6; i++) {
        const { upstream } = routeRequest('test-model', config);
        results.push(upstream.id);
      }

      // Should cycle: u1, u2, u3, u1, u2, u3
      assert.deepEqual(results, ['u1', 'u2', 'u3', 'u1', 'u2', 'u3']);
    });

    test('getSessionId extracts from x-opencode-session header', () => {
      const req = { headers: { 'x-opencode-session': 'sess-123' }, method: 'POST', url: '/test' };
      assert.equal(getSessionId(req), 'sess-123');
    });

    test('getSessionId extracts from x-session-affinity header', () => {
      const req = {
        headers: { 'x-session-affinity': 'affinity-456' },
        method: 'POST',
        url: '/test',
      };
      assert.equal(getSessionId(req), 'affinity-456');
    });

    test('getSessionId generates ID when no session header', () => {
      const req = {
        headers: {},
        method: 'POST',
        url: '/test',
        socket: { remoteAddress: '127.0.0.1' },
      };
      const id = getSessionId(req);
      assert.ok(id.startsWith('ip_'), `Expected generated ID to start with "ip_" but got "${id}"`);
    });

    test('x-opencode-session takes priority over x-session-affinity', () => {
      const req = {
        headers: {
          'x-opencode-session': 'primary',
          'x-session-affinity': 'secondary',
        },
        method: 'POST',
        url: '/test',
      };
      assert.equal(getSessionId(req), 'primary');
    });
  });
});

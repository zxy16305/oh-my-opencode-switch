import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

import { createServer, shutdownServer } from '../../src/proxy/server.js';
import {
  routeRequest,
  resetAllState,
  failoverStickySession,
  getSessionUpstreamMap,
  weightManager,
} from '../../src/proxy/router.js';
import { CircuitBreaker } from '../../src/proxy/circuitbreaker.js';
import { logAccess, resetWriteQueue, resetLogState } from '../../src/utils/access-log.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

const ROUTE_KEY = 'lb-test';
const MAX_RETRIES = 1;

function startMockUpstream(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString()));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}

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

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function httpFetch(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function buildRoutesConfig(upstreams) {
  return {
    [ROUTE_KEY]: {
      strategy: 'sticky',
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

function proxyToUpstream(clientRes, targetUrl, body, extraHeaders, callbacks) {
  const parsedUrl = new URL(targetUrl);
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  headers['content-length'] = Buffer.byteLength(body);

  const proxyReq = http.request(
    {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',
      headers,
      agent: new http.Agent({ keepAlive: false }),
    },
    (proxyRes) => {
      if (callbacks.onProxyRes) {
        const shouldContinue = callbacks.onProxyRes(proxyRes);
        if (shouldContinue === false) {
          proxyRes.resume();
          return;
        }
      }
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes);
      proxyRes.on('end', () => {
        if (callbacks.onStreamEnd) callbacks.onStreamEnd();
      });
    }
  );

  proxyReq.on('error', (err) => {
    if (callbacks.onError) callbacks.onError(err);
  });

  proxyReq.write(body);
  proxyReq.end();
}

/**
 * Creates a proxy handler that handles 429 retry logic.
 * This mirrors the logic in server-manager.js for 429 handling.
 */
function createProxyHandler(routesConfig, circuitBreaker, loggedEntries) {
  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString();
      let parsed;
      try {
        parsed = JSON.parse(rawBody || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
        return;
      }

      const model = parsed.model;
      const startTime = Date.now();
      let ttfb = null;
      let proxyResStatusCode = null;
      let retryCount = 0;

      try {
        const {
          upstream: initialUpstream,
          sessionId,
          routeKey,
        } = routeRequest(model, routesConfig, req);
        const route = routesConfig[model];
        let selected = initialUpstream;

        if (!circuitBreaker.isAvailable(selected.id)) {
          const fo = failoverStickySession(
            sessionId,
            selected.id,
            route.upstreams,
            routeKey,
            model,
            (id) => circuitBreaker.isAvailable(id),
            null,
            weightManager
          );
          if (fo) {
            selected = fo;
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'All providers unavailable' } }));
            return;
          }
        }

        const forwardBody = JSON.stringify({ ...parsed, model: selected.model });
        const extraHeaders = selected.apiKey ? { authorization: `Bearer ${selected.apiKey}` } : {};

        const logEntry = (upstream, status, opts = {}) => {
          const entry = {
            sessionId: sessionId || null,
            provider: upstream.provider,
            model: upstream.model,
            virtualModel: model,
            status,
            ttfb,
            duration: Date.now() - startTime,
            ...opts,
          };
          if (loggedEntries) loggedEntries.push(entry);
          logAccess(entry).catch(() => {});
        };

        const targetUrl = `${selected.baseURL}/chat/completions`;

        proxyToUpstream(res, targetUrl, forwardBody, extraHeaders, {
          onProxyRes: (proxyRes) => {
            ttfb = Date.now() - startTime;
            proxyResStatusCode = proxyRes.statusCode;

            if (proxyRes.statusCode === 429) {
              if (
                !res.headersSent &&
                !res.socket?.destroyed &&
                !req.socket?.destroyed &&
                route.upstreams.length > 1 &&
                retryCount < MAX_RETRIES
              ) {
                const nextUpstream = failoverStickySession(
                  sessionId,
                  selected.id,
                  route.upstreams,
                  routeKey,
                  model,
                  (id) => circuitBreaker.isAvailable(id),
                  null,
                  weightManager
                );

                if (nextUpstream && nextUpstream.baseURL) {
                  retryCount++;
                  logEntry(selected, 429);

                  const retryUrl = `${nextUpstream.baseURL}/chat/completions`;
                  const retryBody = JSON.stringify({ ...parsed, model: nextUpstream.model });
                  const retryHeaders = nextUpstream.apiKey
                    ? { authorization: `Bearer ${nextUpstream.apiKey}` }
                    : {};

                  proxyToUpstream(res, retryUrl, retryBody, retryHeaders, {
                    onProxyRes: (retryProxyRes) => {
                      ttfb = Date.now() - startTime;
                      proxyResStatusCode = retryProxyRes.statusCode;
                      retryProxyRes.headers['x-used-provider'] = nextUpstream.id;
                      retryProxyRes.headers['x-retry-count'] = String(retryCount);
                      if (sessionId) {
                        retryProxyRes.headers['x-session-id'] = sessionId;
                      }
                      if (retryProxyRes.statusCode >= 400) {
                        circuitBreaker.recordFailure(nextUpstream.id);
                      } else {
                        circuitBreaker.recordSuccess(nextUpstream.id);
                      }
                    },
                    onStreamEnd: () => {
                      logEntry(nextUpstream, proxyResStatusCode);
                    },
                    onError: (retryErr) => {
                      circuitBreaker.recordFailure(nextUpstream.id);
                      if (!res.headersSent) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(
                          JSON.stringify({
                            error: { message: `Bad Gateway: ${retryErr.message}` },
                          })
                        );
                      }
                    },
                  });

                  return false;
                }
              }
            }

            proxyRes.headers['x-used-provider'] = selected.id;
            proxyRes.headers['x-retry-count'] = retryCount > 0 ? String(retryCount) : '0';
            if (sessionId) {
              proxyRes.headers['x-session-id'] = sessionId;
            }
            if (proxyRes.statusCode >= 400) {
              circuitBreaker.recordFailure(selected.id);
            } else {
              circuitBreaker.recordSuccess(selected.id);
            }
          },
          onStreamEnd: () => {
            logEntry(selected, proxyResStatusCode);
          },
          onError: (err) => {
            circuitBreaker.recordFailure(selected.id);
            logEntry(selected, 502, { error: err.message });

            if (
              !res.headersSent &&
              !res.socket?.destroyed &&
              route.upstreams.length > 1 &&
              retryCount < MAX_RETRIES
            ) {
              const next = failoverStickySession(
                sessionId,
                selected.id,
                route.upstreams,
                routeKey,
                model,
                (id) => circuitBreaker.isAvailable(id),
                null,
                weightManager
              );
              if (next && next.baseURL) {
                retryCount++;
                const retryUrl = `${next.baseURL}/chat/completions`;
                const retryBody = JSON.stringify({ ...parsed, model: next.model });
                const retryHeaders = next.apiKey
                  ? { authorization: `Bearer ${next.apiKey}` }
                  : {};

                proxyToUpstream(res, retryUrl, retryBody, retryHeaders, {
                  onProxyRes: (proxyRes2) => {
                    ttfb = Date.now() - startTime;
                    proxyResStatusCode = proxyRes2.statusCode;
                    proxyRes2.headers['x-used-provider'] = next.id;
                    proxyRes2.headers['x-retry-count'] = String(retryCount);
                    if (proxyRes2.statusCode >= 400) circuitBreaker.recordFailure(next.id);
                    else circuitBreaker.recordSuccess(next.id);
                  },
                  onStreamEnd: () => {
                    logEntry(next, proxyResStatusCode);
                  },
                  onError: (retryErr) => {
                    circuitBreaker.recordFailure(next.id);
                    if (!res.headersSent) {
                      res.writeHead(502, { 'Content-Type': 'application/json' });
                      res.end(
                        JSON.stringify({
                          error: { message: `Bad Gateway: ${retryErr.message}` },
                        })
                      );
                    }
                  },
                });
                return;
              }
            }

            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: `Bad Gateway: ${err.message}` } }));
            }
          },
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
  };
}

describe('Proxy 429 Retry Integration', () => {
  let testHome;
  let proxy;
  let mockUpstream1;
  let mockUpstream2;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
    resetAllState();
    resetLogState();
    resetWriteQueue();
  });

  afterEach(async () => {
    if (proxy) {
      await shutdownServer(proxy.server).catch(() => {});
      proxy = null;
    }
    await stopMock(mockUpstream1);
    mockUpstream1 = null;
    await stopMock(mockUpstream2);
    mockUpstream2 = null;
    await cleanupTestHome(testHome);
  });

  function forceSessionToUpstream(sessionId, upstreamId) {
    routeRequest(
      ROUTE_KEY,
      buildRoutesConfig([
        { id: 'a', baseURL: 'http://127.0.0.1:1' },
        { id: 'b', baseURL: 'http://127.0.0.1:2' },
      ]),
      { headers: { 'x-opencode-session': sessionId } }
    );

    const sessionKey = `${sessionId}:${ROUTE_KEY}`;
    getSessionUpstreamMap().set(sessionKey, {
      upstreamId,
      routeKey: ROUTE_KEY,
      timestamp: Date.now(),
      requestCount: 1,
    });
  }

  it('should retry to second upstream when first returns 429', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'success from upstream 2' } }] }));
    });

    const upstreams = [
      { id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'mock2', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-1';

    forceSessionToUpstream(sessionId, 'mock1');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 200, 'Client should receive 200 after retry');
    assert.ok(
      response.body.includes('success from upstream 2'),
      'Response body should contain upstream 2 data'
    );
    assert.equal(response.headers['x-retry-count'], '1', 'x-retry-count should be 1');
    assert.equal(response.headers['x-used-provider'], 'mock2', 'x-used-provider should be mock2');
  });

  it('should return 429 when single upstream returns 429', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    const upstreams = [{ id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` }];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-2';

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 429, 'Client should receive 429');
    assert.equal(response.headers['x-retry-count'], '0', 'x-retry-count should be 0');
  });

  it('should retry once and return 429 when all upstreams return 429', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    const upstreams = [
      { id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'mock2', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-3';

    forceSessionToUpstream(sessionId, 'mock1');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 429, 'Client should receive 429 after all upstreams fail');
    assert.equal(response.headers['x-retry-count'], '1', 'x-retry-count should be 1 (MAX_RETRIES)');
  });

  it('should include correct headers after 429 retry', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });

    const upstreams = [
      { id: 'upstream-429', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'upstream-ok', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-4';

    forceSessionToUpstream(sessionId, 'upstream-429');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 200, 'Client should receive 200 after retry');
    assert.equal(response.headers['x-retry-count'], '1', 'x-retry-count should be 1');
    assert.equal(
      response.headers['x-used-provider'],
      'upstream-ok',
      'x-used-provider should be the retry target'
    );
    assert.equal(
      response.headers['x-session-id'],
      sessionId,
      'x-session-id should match the request session ID'
    );
  });

  it('should log both 429 error and success records after retry', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });

    const upstreams = [
      { id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'mock2', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-5';
    const loggedEntries = [];

    forceSessionToUpstream(sessionId, 'mock1');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker, loggedEntries),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 200, 'Client should receive 200 after retry');

    const error429Entries = loggedEntries.filter((e) => e.status === 429);
    assert.ok(error429Entries.length >= 1, 'Should have at least one 429 log entry');

    const successEntries = loggedEntries.filter((e) => e.status === 200);
    assert.ok(successEntries.length >= 1, 'Should have at least one success log entry');

    assert.equal(
      error429Entries[0].sessionId,
      sessionId,
      '429 entry should have correct session ID'
    );
    assert.equal(
      successEntries[successEntries.length - 1].sessionId,
      sessionId,
      'Success entry should have correct session ID'
    );
  });

  it('should respect circuit breaker during 429 retry', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });

    const upstreams = [
      { id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'mock2', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-6';

    forceSessionToUpstream(sessionId, 'mock1');
    circuitBreaker.recordFailure('mock2');
    circuitBreaker.recordFailure('mock2');
    circuitBreaker.recordFailure('mock2');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 429, 'Should return 429 when circuit breaker blocks retry target');
  });

  it('should not infinite retry on repeated 429', async () => {
    const proxyPort = await getAvailablePort();

    mockUpstream1 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    mockUpstream2 = await startMockUpstream((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
    });

    const upstreams = [
      { id: 'mock1', baseURL: `http://127.0.0.1:${mockUpstream1.port}` },
      { id: 'mock2', baseURL: `http://127.0.0.1:${mockUpstream2.port}` },
    ];
    const routesConfig = buildRoutesConfig(upstreams);
    const circuitBreaker = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
    const sessionId = 'test-session-429-7';

    forceSessionToUpstream(sessionId, 'mock1');

    proxy = await createServer({
      port: proxyPort,
      requestHandler: createProxyHandler(routesConfig, circuitBreaker),
    });

    const response = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': sessionId },
      body: JSON.stringify({ model: ROUTE_KEY, messages: [{ role: 'user', content: 'Hi' }] }),
    });

    assert.equal(response.status, 429, 'Should return 429 after max retries');
    assert.equal(
      response.headers['x-retry-count'],
      '1',
      'Should only retry once (MAX_RETRIES = 1)'
    );
  });
});

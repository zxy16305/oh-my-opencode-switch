/**
 * Integration tests for proxy agent/category header logging.
 *
 * Verifies the full flow: request with headers → proxy → log output
 * - Request 1: Both x-opencode-agent and x-opencode-category headers → both fields in log
 * - Request 2: Only x-opencode-agent header → only agent field in log
 * - Request 3: Only x-opencode-category header → only category field in log
 * - Request 4: No headers → neither field in log
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { routeRequest } from '../../src/proxy/router.js';
import { logAccess, readLogs, clearLogs } from '../../src/utils/access-log.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a bare-bones HTTP server on dynamically assigned port */
function startMockUpstream(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      handler(req, res, body);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
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

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Proxy Agent/Category Header Logging', () => {
  let mockUpstream;
  let proxy;
  let testHome;

  before(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;

    // Clear any existing logs
    await clearLogs();

    // Create mock upstream that returns SSE stream
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const upstreamPort = mockUpstream.port;

    // Create proxy server with routing and logging
    const routesConfig = buildRoutesConfig([
      { id: 'mock-upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
    ]);

    proxy = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          let parsed;
          try {
            parsed = JSON.parse(rawBody.toString() || '{}');
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
            return;
          }

          const model = parsed.model;
          const startTime = Date.now();
          let ttfb = null;
          let proxyResStatusCode = null;

          // Extract agent and category headers (same as server-manager.js)
          const category = req.headers['x-opencode-category'] || null;
          const agent = req.headers['x-opencode-agent'] || null;

          try {
            const { upstream: selected, sessionId } = routeRequest(model, routesConfig, req);
            const targetUrl = `${selected.baseURL}/chat/completions`;

            forwardRequest(req, res, targetUrl, {
              body: rawBody.toString(),
              onProxyRes: (proxyRes) => {
                ttfb = Date.now() - startTime;
                proxyResStatusCode = proxyRes.statusCode;
              },
              onStreamEnd: () => {
                const duration = Date.now() - startTime;
                logAccess({
                  sessionId: sessionId || null,
                  agent,
                  category,
                  provider: selected.provider,
                  model: selected.model,
                  virtualModel: model,
                  status: proxyResStatusCode,
                  ttfb,
                  duration,
                }).catch(() => {});
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
    await stopMock(mockUpstream);
    await cleanupTestHome(testHome);
  });

  beforeEach(async () => {
    await clearLogs();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: Both headers present
  // -------------------------------------------------------------------------
  it('should log both agent and category when both headers are present', async () => {
    const res = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-opencode-agent': 'build',
        'x-opencode-category': 'code-generation',
      },
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Test 1' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for log to flush
    await new Promise((r) => setTimeout(r, 200));

    const logs = await readLogs(50);
    const testLog = logs.find((l) => l.includes('provider=mock'));

    assert.ok(testLog, `Should find log entry for this request. Logs: ${JSON.stringify(logs)}`);
    assert.ok(testLog.includes('agent=build'), 'Log should include agent=build');
    assert.ok(
      testLog.includes('category=code-generation'),
      'Log should include category=code-generation'
    );
    assert.ok(!testLog.includes('unknown'), 'Log should not contain "unknown"');
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Only agent header
  // -------------------------------------------------------------------------
  it('should log only agent when only agent header is present', async () => {
    const res = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-opencode-agent': 'oracle',
      },
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Test 2' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for log to flush
    await new Promise((r) => setTimeout(r, 200));

    const logs = await readLogs(50);
    const testLog = logs.find((l) => l.includes('provider=mock'));

    assert.ok(testLog, `Should find log entry for this request. Logs: ${JSON.stringify(logs)}`);
    assert.ok(testLog.includes('agent=oracle'), 'Log should include agent=oracle');
    assert.ok(!testLog.includes('category='), 'Log should NOT include category field');
    assert.ok(!testLog.includes('unknown'), 'Log should not contain "unknown"');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Only category header
  // -------------------------------------------------------------------------
  it('should log only category when only category header is present', async () => {
    const res = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-opencode-category': 'research',
      },
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Test 3' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for log to flush
    await new Promise((r) => setTimeout(r, 200));

    const logs = await readLogs(50);
    const testLog = logs.find((l) => l.includes('provider=mock'));

    assert.ok(testLog, `Should find log entry for this request. Logs: ${JSON.stringify(logs)}`);
    assert.ok(!testLog.includes('agent='), 'Log should NOT include agent field');
    assert.ok(testLog.includes('category=research'), 'Log should include category=research');
    assert.ok(!testLog.includes('unknown'), 'Log should not contain "unknown"');
  });

  // -------------------------------------------------------------------------
  // Scenario 4: No headers
  // -------------------------------------------------------------------------
  it('should log neither agent nor category when no headers are present', async () => {
    const res = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Test 4' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for log to flush
    await new Promise((r) => setTimeout(r, 200));

    const logs = await readLogs(50);
    const testLog = logs.find((l) => l.includes('provider=mock'));

    assert.ok(testLog, `Should find log entry for this request. Logs: ${JSON.stringify(logs)}`);
    assert.ok(!testLog.includes('agent='), 'Log should NOT include agent field');
    assert.ok(!testLog.includes('category='), 'Log should NOT include category field');
    assert.ok(!testLog.includes('unknown'), 'Log should not contain "unknown"');
  });
});

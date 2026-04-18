/**
 * Integration tests for proxy token capture.
 *
 * Verifies the full flow: mock upstream → proxy with TokenCaptivee → log contains tok= field
 * - Mock upstream returns streaming SSE responses with usage data
 * - TokenCaptivee intercepts response and parses token usage
 * - Access log contains tok=iX/oY/cZ/rW/tV compact format
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { TokenCaptivee } from '../../src/utils/token-capttee.js';
import { logAccess, readLogs, formatTokenCompact } from '../../src/utils/access-log.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

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

function buildRoutesConfig(upstreams) {
  return {
    'test-model': {
      strategy: 'round-robin',
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

describe('Proxy Token Capture Integration', () => {
  let mockUpstream;
  let proxy;
  let testHome;

  before(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;

    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write(
        'data: {"choices":[],"usage":{"prompt_tokens":150,"completion_tokens":50,"total_tokens":200,"cache_read_input_tokens":30,"cache_creation_input_tokens":10}}\n\n'
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const upstreamPort = mockUpstream.port;
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
          const capttee = new TokenCaptivee();

          try {
            const route = routesConfig[model];
            if (!route) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: `Unknown model: ${model}` } }));
              return;
            }
            const selected = route.upstreams[0];
            const targetUrl = `${selected.baseURL}/chat/completions`;

            forwardRequest(req, res, targetUrl, {
              body: rawBody.toString(),
              responseTransform: capttee,
              onProxyRes: (proxyRes) => {
                ttfb = Date.now() - startTime;
                proxyResStatusCode = proxyRes.statusCode;
              },
              onStreamEnd: () => {
                const duration = Date.now() - startTime;

                let tokens;
                try {
                  const rawUsage = capttee.getUsage();
                  tokens = rawUsage ? formatTokenCompact(rawUsage) : undefined;
                } catch {
                  tokens = undefined;
                }

                logAccess({
                  sessionId: null,
                  provider: selected.provider,
                  model: selected.model,
                  virtualModel: model,
                  status: proxyResStatusCode,
                  ttfb,
                  duration,
                  tokens,
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

  it('should forward streaming request and return correct SSE data', async () => {
    const res = await httpFetch(proxy.port, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.includes('data: '), 'Response should contain SSE data lines');
    assert.ok(res.body.includes('[DONE]'), 'Response should contain [DONE] sentinel');
    assert.ok(res.body.includes('Hello'), 'Response should contain first chunk');
    assert.ok(res.body.includes(' world'), 'Response should contain second chunk');
    assert.ok(res.body.includes('usage'), 'Response should contain usage data');
  });

  it('should log token usage in compact format tok=iX/oY/cZ/rW/tV', async () => {
    await new Promise((r) => setTimeout(r, 300));

    const logs = await readLogs(50);
    assert.ok(logs.length > 0, 'Log file should contain at least one entry');

    const testLogs = logs.filter((l) => l.includes('provider=mock') && l.includes('tok='));
    assert.ok(testLogs.length > 0, 'Should find log entries with tok= field');

    const lastLog = testLogs[testLogs.length - 1];

    assert.match(lastLog, /tok=i\d+\w?\/o\d+\w?\/c\d+\w?\/r\d+\w?\/t\d+\w?/, 
      'Log should contain tok=iX/oY/cZ/rW/tV format');
    assert.match(lastLog, /provider=mock/, 'Log should contain provider');
    assert.match(lastLog, /status=200/, 'Log should contain status=200');
    assert.ok(lastLog.includes('i150'), 'Log should contain input tokens i150');
    assert.ok(lastLog.includes('o50'), 'Log should contain output tokens o50');
    assert.ok(lastLog.includes('t200'), 'Log should contain total tokens t200');
    assert.ok(lastLog.includes('c40'), 'Log should contain cache tokens c40 (30+10)');
  });

  it('should log token usage for multiple requests', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'test-model',
          stream: true,
          messages: [{ role: 'user', content: `msg ${i}` }],
        }),
      });
      assert.equal(res.status, 200);
    }

    await new Promise((r) => setTimeout(r, 400));

    const logs = await readLogs(100);
    const testLogs = logs.filter((l) => l.includes('provider=mock') && l.includes('tok='));
    assert.ok(testLogs.length >= 4, `Should have at least 4 log entries with tokens, got ${testLogs.length}`);

    for (const line of testLogs) {
      assert.match(line, /tok=i\d+\w?\/o\d+\w?\/c\d+\w?\/r\d+\w?\/t\d+\w?/,
        `Log line should contain valid tok format: ${line}`);
    }
  });
});
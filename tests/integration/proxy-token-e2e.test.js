/**
 * End-to-end integration tests for full proxy token tracking flow.
 *
 * Validates the complete token tracking pipeline:
 * Mock upstream → Proxy with TokenCaptivee → Access log → parseLogLine verification
 *
 * Scenarios covered:
 * 1. Streaming SSE response with usage field
 * 2. Non-streaming JSON response with usage field
 * 3. Response without usage field (graceful handling)
 * 4. Token parsing and aggregation across multiple requests
 * 5. Retry flow token capture (502 → success)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { TokenCaptivee } from '../../src/utils/token-capttee.js';
import {
  logAccess,
  readLogs,
  clearLogs,
  flushLogs,
  formatTokenCompact,
  resetWriteQueue,
  resetLogState,
} from '../../src/utils/access-log.js';
import { parseLogLine } from '../../src/utils/stats.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

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

function createProxyWithTokenCapture(port, routesConfig) {
  return createServer({
    port,
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
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Proxy Token Tracking E2E', () => {
  let testHome;
  let proxy;
  let mockUpstream;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
    resetWriteQueue();
    resetLogState();
    await clearLogs();
  });

  afterEach(async () => {
    if (proxy) {
      await shutdownServer(proxy.server);
      proxy = null;
    }
    if (mockUpstream) {
      await stopMock(mockUpstream);
      mockUpstream = null;
    }
    if (testHome) {
      await cleanupTestHome(testHome);
      testHome = null;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Streaming response with usage
  // -------------------------------------------------------------------------
  it('should capture tokens from streaming SSE response and log correctly', async () => {
    const PORT1 = 18201;
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

    const routesConfig = buildRoutesConfig([
      { id: 'mock-stream', provider: 'stream-mock', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithTokenCapture(PORT1, routesConfig);

    // Send request and verify forwarded response
    const res = await httpFetch(PORT1, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.includes('data: '), 'Response should contain SSE data');
    assert.ok(res.body.includes('[DONE]'), 'Response should contain [DONE]');
    assert.ok(res.body.includes('Hello'), 'Response should contain content chunks');
    assert.ok(res.body.includes('usage'), 'Response should include usage data');

    // Wait for log to flush
    await flushLogs();
    await new Promise((r) => setTimeout(r, 200));

    // Verify log entry
    const logs = await readLogs(50);
    assert.ok(logs.length > 0, 'Should have log entries');

    const tokenLogs = logs.filter((l) => l.includes('provider=stream-mock') && l.includes('tok='));
    assert.ok(tokenLogs.length > 0, 'Should find log entries with tok= field');

    const logLine = tokenLogs[0];

    // Verify log line content
    assert.match(logLine, /tok=i\d+\w*\/o\d+\w*\/c\d+\w*\/r\d+\w*\/t\d+\w*/, 
      'Log should have tok=iX/oY/cZ/rW/tV format');
    assert.ok(logLine.includes('i150'), 'Should contain input tokens i150');
    assert.ok(logLine.includes('o50'), 'Should contain output tokens o50');
    assert.ok(logLine.includes('t200'), 'Should contain total tokens t200');
    assert.ok(logLine.includes('c40'), 'Should contain cache tokens c40 (30+10)');

    // Verify parseLogLine extracts correct values
    const parsed = parseLogLine(logLine);
    assert.ok(parsed, 'Log line should be parseable');
    assert.equal(parsed.tokens.input, 150, 'Parsed input tokens should be 150');
    assert.equal(parsed.tokens.output, 50, 'Parsed output tokens should be 50');
    assert.equal(parsed.tokens.cache, 40, 'Parsed cache tokens should be 40');
    assert.equal(parsed.tokens.total, 200, 'Parsed total tokens should be 200');
    assert.equal(parsed.tokens.reasoning, 0, 'Parsed reasoning tokens should be 0');
    assert.equal(parsed.status, 200, 'Parsed status should be 200');
    assert.equal(parsed.provider, 'stream-mock', 'Parsed provider should match');
  });

  // -------------------------------------------------------------------------
  // 2. Non-streaming JSON response with usage
  // -------------------------------------------------------------------------
  it('should capture tokens from non-streaming JSON response', async () => {
    const PORT2 = 18202;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-json-1',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello from JSON' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 25,
          total_tokens: 105,
          cache_read_input_tokens: 20,
        },
      }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-json', provider: 'json-mock', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithTokenCapture(PORT2, routesConfig);

    const res = await httpFetch(PORT2, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: false,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.choices[0].message.content, 'Hello from JSON');
    assert.ok(body.usage, 'Response should contain usage field');
    assert.equal(body.usage.prompt_tokens, 80);
    assert.equal(body.usage.completion_tokens, 25);

    // Wait for log flush
    await flushLogs();
    await new Promise((r) => setTimeout(r, 200));

    // Verify log
    const logs = await readLogs(50);
    const tokenLogs = logs.filter((l) => l.includes('provider=json-mock') && l.includes('tok='));
    assert.ok(tokenLogs.length > 0, 'Should find log entry with tok= for JSON response');

    const logLine = tokenLogs[0];
    assert.ok(logLine.includes('i80'), 'Should contain input tokens i80');
    assert.ok(logLine.includes('o25'), 'Should contain output tokens o25');
    assert.ok(logLine.includes('t105'), 'Should contain total tokens t105');
    assert.ok(logLine.includes('c20'), 'Should contain cache tokens c20');

    // Verify parseLogLine
    const parsed = parseLogLine(logLine);
    assert.ok(parsed, 'JSON log line should be parseable');
    assert.equal(parsed.tokens.input, 80, 'Parsed input should be 80');
    assert.equal(parsed.tokens.output, 25, 'Parsed output should be 25');
    assert.equal(parsed.tokens.cache, 20, 'Parsed cache should be 20');
    assert.equal(parsed.tokens.total, 105, 'Parsed total should be 105');
  });

  // -------------------------------------------------------------------------
  // 3. Response without usage field
  // -------------------------------------------------------------------------
  it('should handle response without usage field gracefully', async () => {
    const PORT3 = 18203;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"No usage here"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-nousage', provider: 'no-usage-mock', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithTokenCapture(PORT3, routesConfig);

    const res = await httpFetch(PORT3, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.includes('No usage here'), 'Response should contain content');

    // Wait for log flush
    await flushLogs();
    await new Promise((r) => setTimeout(r, 200));

    // Verify log entry exists but without tok= field
    const logs = await readLogs(50);
    assert.ok(logs.length > 0, 'Should have log entries even without usage');

    const noUsageLogs = logs.filter((l) => l.includes('provider=no-usage-mock'));
    assert.ok(noUsageLogs.length > 0, 'Should find log entry for no-usage response');

    // Log should NOT contain tok= field
    const logLine = noUsageLogs[0];
    assert.ok(!logLine.includes('tok='), 'Log should NOT contain tok= when no usage data');
    assert.match(logLine, /status=200/, 'Log should contain status=200');

    // parseLogLine should return token values all 0
    const parsed = parseLogLine(logLine);
    assert.ok(parsed, 'Log line should still be parseable');
    assert.equal(parsed.tokens.input, 0, 'Input tokens should be 0 without usage');
    assert.equal(parsed.tokens.output, 0, 'Output tokens should be 0 without usage');
    assert.equal(parsed.tokens.cache, 0, 'Cache tokens should be 0 without usage');
    assert.equal(parsed.tokens.total, 0, 'Total tokens should be 0 without usage');
    assert.equal(parsed.tokens.reasoning, 0, 'Reasoning tokens should be 0 without usage');
    assert.equal(parsed.status, 200, 'Status should still be 200');
  });

  // -------------------------------------------------------------------------
  // 4. Token parsing and aggregation
  // -------------------------------------------------------------------------
  it('should correctly parse and aggregate tokens across multiple requests', async () => {
    const PORT4 = 18204;
    let requestCount = 0;

    // Each request returns different known token values
    const tokenSets = [
      { input: 100, output: 50, total: 150, cache: 10 },
      { input: 200, output: 80, total: 280, cache: 20 },
      { input: 150, output: 60, total: 210, cache: 15 },
    ];

    mockUpstream = await startMockUpstream((_req, res) => {
      const tokens = tokenSets[requestCount % tokenSets.length];
      requestCount++;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"chunk"}}]}\n\n');
      res.write(
        `data: {"choices":[],"usage":{"prompt_tokens":${tokens.input},"completion_tokens":${tokens.output},"total_tokens":${tokens.total},"cache_read_input_tokens":${tokens.cache}}}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-aggregate', provider: 'aggregate-mock', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithTokenCapture(PORT4, routesConfig);

    // Send multiple requests with known token values
    for (let i = 0; i < 3; i++) {
      const res = await httpFetch(PORT4, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'test-model',
          stream: true,
          messages: [{ role: 'user', content: `msg ${i}` }],
        }),
      });
      assert.equal(res.status, 200, `Request ${i} should succeed`);
    }

    // Wait for logs
    await flushLogs();
    await new Promise((r) => setTimeout(r, 300));

    // Read and parse all log entries
    const logs = await readLogs(50);
    const tokenLogs = logs.filter((l) => l.includes('provider=aggregate-mock') && l.includes('tok='));
    assert.equal(tokenLogs.length, 3, 'Should have exactly 3 log entries');

    // Aggregate tokens manually from parsed values
    let totalInput = 0;
    let totalOutput = 0;
    let totalCache = 0;
    let totalTokens = 0;

    for (const line of tokenLogs) {
      const parsed = parseLogLine(line);
      assert.ok(parsed, `Log line should be parseable: ${line}`);
      assert.ok(parsed.tokens.input > 0, `Input tokens should be > 0`);
      assert.ok(parsed.tokens.output > 0, `Output tokens should be > 0`);

      totalInput += parsed.tokens.input;
      totalOutput += parsed.tokens.output;
      totalCache += parsed.tokens.cache;
      totalTokens += parsed.tokens.total;
    }

    // Expected sums: input=100+200+150=450, output=50+80+60=190, cache=10+20+15=45, total=150+280+210=640
    assert.equal(totalInput, 450, `Aggregated input tokens should be 450, got ${totalInput}`);
    assert.equal(totalOutput, 190, `Aggregated output tokens should be 190, got ${totalOutput}`);
    assert.equal(totalCache, 45, `Aggregated cache tokens should be 45, got ${totalCache}`);
    assert.equal(totalTokens, 640, `Aggregated total tokens should be 640, got ${totalTokens}`);
  });

  // -------------------------------------------------------------------------
  // 5. Retry flow token capture
  // -------------------------------------------------------------------------
  it('should capture tokens from successful retry after 502 error', async () => {
    const PORT5 = 18205;
    let attemptCount = 0;

    // First request returns 502, second returns success with tokens
    mockUpstream = await startMockUpstream((_req, res) => {
      attemptCount++;

      if (attemptCount === 1) {
        // First attempt: 502 error
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Bad Gateway' } }));
        return;
      }

      // Second attempt: success with streaming and usage
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"Retry success"}}]}\n\n');
      res.write(
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45,"total_tokens":165,"cache_read_input_tokens":25}}\n\n'
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-retry', provider: 'retry-mock', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithTokenCapture(PORT5, routesConfig);

    // Send first request → will get 502
    const res1 = await httpFetch(PORT5, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'First attempt' }],
      }),
    });
    assert.equal(res1.status, 502, 'First attempt should return 502');

    // Wait a moment before retry to ensure mock state advances
    await new Promise((r) => setTimeout(r, 100));

    // Send second request → should succeed
    const res2 = await httpFetch(PORT5, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Second attempt' }],
      }),
    });
    assert.equal(res2.status, 200, 'Second attempt should succeed');
    assert.ok(res2.body.includes('Retry success'), 'Response should contain retry content');

    // Wait for logs
    await flushLogs();
    await new Promise((r) => setTimeout(r, 200));

    // Verify logs
    const logs = await readLogs(50);
    assert.ok(logs.length >= 2, 'Should have at least 2 log entries (502 + 200)');

    // Find the successful request log
    const successLogs = logs.filter(
      (l) => l.includes('provider=retry-mock') && l.includes('status=200') && l.includes('tok=')
    );
    assert.ok(successLogs.length > 0, 'Should find successful log entry with tokens');

    const successLog = successLogs[successLogs.length - 1];

    // Verify token values from retry
    assert.ok(successLog.includes('i120'), 'Should contain input tokens i120');
    assert.ok(successLog.includes('o45'), 'Should contain output tokens o45');
    assert.ok(successLog.includes('t165'), 'Should contain total tokens t165');
    assert.ok(successLog.includes('c25'), 'Should contain cache tokens c25');

    // Verify parseLogLine extracts correct values
    const parsed = parseLogLine(successLog);
    assert.ok(parsed, 'Retry log line should be parseable');
    assert.equal(parsed.tokens.input, 120, 'Parsed input should be 120');
    assert.equal(parsed.tokens.output, 45, 'Parsed output should be 45');
    assert.equal(parsed.tokens.cache, 25, 'Parsed cache should be 25');
    assert.equal(parsed.tokens.total, 165, 'Parsed total should be 165');
    assert.equal(parsed.status, 200, 'Parsed status should be 200');
  });
});

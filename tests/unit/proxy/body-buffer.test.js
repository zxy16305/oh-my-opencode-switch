/**
 * Tests for request body buffering in the proxy server.
 *
 * Verifies that body data is correctly buffered and forwarded:
 * - Large JSON bodies (50KB+) through the proxy chain
 * - UTF-8 multi-byte characters (Chinese, emoji) preserved correctly
 * - Empty body handling
 * - Buffer.concat behavior (direct unit tests)
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../../src/proxy/server.js';
import { routeRequest, resetAllState } from '../../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Helpers (mirroring patterns from tests/proxy/e2e.test.js)
// ---------------------------------------------------------------------------

/**
 * Start a bare-bones HTTP server on dynamically assigned port.
 * Returns { server, port, receivedBodies } where `receivedBodies` collects every inbound body.
 */
function startMockUpstream() {
  const receivedBodies = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      receivedBodies.push({
        method: req.method,
        url: req.url,
        body,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ echo: 'ok', receivedLength: body.length }));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port, receivedBodies }));
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

/** Build a minimal routes config for testing */
function buildRoutesConfig(upstreams, strategy = 'round-robin') {
  return {
    'test-model': {
      strategy,
      upstreams: upstreams.map((u) => ({
        id: u.id,
        provider: 'mock',
        model: 'test-model',
        baseURL: u.baseURL,
        apiKey: 'test-key',
      })),
    },
  };
}

/** Fire-and-forget HTTP helper – returns { status, headers, body } */
function httpFetch(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path || '/v1/chat/completions',
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

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Body buffer – Buffer.concat behavior', () => {
  test('Buffer.concat on empty array returns empty buffer', () => {
    const result = Buffer.concat([]).toString();
    assert.equal(result, '');
  });

  test('Buffer.concat collects single chunk correctly', () => {
    const chunks = [Buffer.from('hello')];
    const result = Buffer.concat(chunks).toString();
    assert.equal(result, 'hello');
  });

  test('Buffer.concat joins multiple chunks in order', () => {
    const chunks = [Buffer.from('hello'), Buffer.from(' '), Buffer.from('world')];
    const result = Buffer.concat(chunks).toString();
    assert.equal(result, 'hello world');
  });

  test('Buffer.concat preserves UTF-8 multi-byte characters', () => {
    const text = '中文测试🎉🚀émoji';
    const chunks = [Buffer.from(text)];
    const result = Buffer.concat(chunks).toString();
    assert.equal(result, text);
  });

  test('Buffer.concat handles large data (>50KB)', () => {
    const largeText = 'x'.repeat(60_000);
    const chunks = [Buffer.from(largeText)];
    const result = Buffer.concat(chunks).toString();
    assert.equal(result.length, 60_000);
  });

  test('Buffer.concat preserves split multi-byte boundaries', () => {
    // Chinese character 中 is 3 bytes: e4 b8 ad
    // Split a buffer mid-character to verify concat doesn't corrupt it
    const full = Buffer.from('hello 中文 world');
    const chunks = [full.slice(0, 8), full.slice(8)];
    const result = Buffer.concat(chunks).toString();
    assert.equal(result, 'hello 中文 world');
  });
});

// ---------------------------------------------------------------------------

describe('Body buffer – proxy request forwarding', () => {
  let upstream;
  let proxy;

  before(async () => {
    upstream = await startMockUpstream();

    const routesConfig = buildRoutesConfig([
      { id: 'echo-upstream', baseURL: `http://127.0.0.1:${upstream.port}` },
    ]);

    proxy = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        // Same body buffering pattern as server-manager.js: Buffer.concat
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString();

          let parsed;
          try {
            parsed = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
            return;
          }

          try {
            const { upstream: selected } = routeRequest(parsed.model, routesConfig, req);
            // Forward the original body (same pattern as server-manager after JSON.stringify)
            const forwardBody = JSON.stringify({
              ...parsed,
              model: selected.model || parsed.model,
            });
            forwardRequest(req, res, `${selected.baseURL}${req.url}`, {
              body: forwardBody,
            });
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: err.message } }));
          }
        });
      },
    });

    resetAllState();
  });

  after(async () => {
    await shutdownServer(proxy.server);
    await stopMock(upstream);
    resetAllState();
  });

  test('forwards 50KB+ JSON body through proxy', async () => {
    // Build a 50KB+ body with padding
    const messages = [];
    const content = 'A'.repeat(1000);
    for (let i = 0; i < 60; i++) {
      messages.push({ role: 'user', content });
    }
    const body = JSON.stringify({ model: 'test-model', messages });
    assert.ok(body.length > 50_000, `Body should be >50KB, got ${body.length} bytes`);

    const res = await httpFetch(proxy.port, { method: 'POST', body });
    assert.equal(res.status, 200);

    // Verify upstream received the body
    assert.equal(upstream.receivedBodies.length, 1, 'Upstream should have received 1 request');
    const receivedBody = upstream.receivedBodies[0].body;
    const parsed = JSON.parse(receivedBody);

    // Verify the content is preserved (model gets rewritten by proxy)
    assert.equal(parsed.messages.length, 60);
    assert.equal(parsed.messages[0].content.length, 1000);
    assert.ok(receivedBody.length > 50_000, 'Received body should also be >50KB');
  });

  test('preserves UTF-8 Chinese characters through proxy', async () => {
    const chineseText = '这是一段中文测试内容，用于验证UTF-8编码的多字节字符是否正确传输。';
    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: chineseText }],
    });

    upstream.receivedBodies.length = 0; // reset
    const res = await httpFetch(proxy.port, { method: 'POST', body });
    assert.equal(res.status, 200);

    const received = upstream.receivedBodies[0];
    if (!received) {
      assert.fail('No body received by upstream');
    }
    const parsed = JSON.parse(received.body);
    assert.equal(parsed.messages[0].content, chineseText);
  });

  test('preserves emoji characters through proxy', async () => {
    const emojiText = '🎉🚀💻🔥✨ Hello World! 🌍❤️';
    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: emojiText }],
    });

    upstream.receivedBodies.length = 0;
    const res = await httpFetch(proxy.port, { method: 'POST', body });
    assert.equal(res.status, 200);

    const received = upstream.receivedBodies[0];
    if (!received) {
      assert.fail('No body received by upstream');
    }
    const parsed = JSON.parse(received.body);
    assert.equal(parsed.messages[0].content, emojiText);
  });

  test('handles mixed CJK + emoji + latin content', async () => {
    const mixedText = 'Hello 世界 🌏 こんにちは 안녕 こんにちは 中文 🎉';
    const body = JSON.stringify({
      model: 'test-model',
      messages: [{ role: 'user', content: mixedText }],
      system: '系统提示 🤖',
    });

    upstream.receivedBodies.length = 0;
    const res = await httpFetch(proxy.port, { method: 'POST', body });
    assert.equal(res.status, 200);

    const received = upstream.receivedBodies[0];
    if (!received) {
      assert.fail('No body received by upstream');
    }
    const parsed = JSON.parse(received.body);
    assert.equal(parsed.messages[0].content, mixedText);
    assert.equal(parsed.system, '系统提示 🤖');
  });

  test('handles request with minimal body (no messages)', async () => {
    const body = JSON.stringify({ model: 'test-model' });

    upstream.receivedBodies.length = 0;
    const res = await httpFetch(proxy.port, { method: 'POST', body });
    assert.equal(res.status, 200);

    const received = upstream.receivedBodies[0];
    if (!received) {
      assert.fail('No body received by upstream');
    }
    const parsed = JSON.parse(received.body);
    assert.equal(parsed.model, 'test-model');
  });

  test('handles invalid JSON body gracefully', async () => {
    const res = await httpFetch(proxy.port, {
      method: 'POST',
      body: '{invalid json content}',
    });
    assert.equal(res.status, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error);
    assert.ok(parsed.error.message.includes('Invalid JSON'));
  });
});

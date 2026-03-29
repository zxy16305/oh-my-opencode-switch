/**
 * Unit tests for proxy/server module
 * @module tests/proxy/unit/server.test
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

import {
  isPortAvailable,
  forwardRequest,
  createServer,
  shutdownServer,
} from '../../../src/proxy/server.js';

let nextPort = 29830;
function allocPort() {
  return nextPort++;
}

const cleanup = [];

function track(server) {
  cleanup.push(server);
  return server;
}

function stopTracked(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 2000).unref();
  });
}

afterEach(async () => {
  while (cleanup.length) {
    const s = cleanup.pop();
    if (s && s.listening) await stopTracked(s).catch(() => {});
  }
});

function httpGet(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
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

function startUpstream(port, handler) {
  const server = http.createServer(handler);
  track(server);
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server));
    server.once('error', reject);
  });
}

function createProxyServer(proxyPort, targetUrl, options = {}) {
  const server = http.createServer((clientReq, clientRes) => {
    const target = targetUrl(clientReq);
    forwardRequest(clientReq, clientRes, target, options);
  });
  track(server);
  return new Promise((resolve, reject) => {
    server.listen(proxyPort, () => resolve(server));
    server.once('error', reject);
  });
}

// ===========================================================================

describe('Server – isPortAvailable()', () => {
  test('returns true for unused port', async () => {
    assert.equal(await isPortAvailable(allocPort()), true);
  });

  test('returns false for port occupied by HTTP server', async () => {
    const port = allocPort();
    const s = track(http.createServer(() => {}));
    await new Promise((r) => s.listen(port, r));
    assert.equal(await isPortAvailable(port), false);
  });

  test('returns false for port occupied by raw TCP server', async () => {
    const port = allocPort();
    const s = track(net.createServer());
    await new Promise((r) => s.listen(port, r));
    assert.equal(await isPortAvailable(port), false);
  });
});

describe('Server – forwardRequest()', () => {
  test('returns 400 for invalid target URL', async () => {
    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => 'not-a-url');
    const res = await httpGet(proxyPort, '/test');
    assert.equal(res.status, 400);
    assert.ok(res.body.includes('Invalid upstream target URL'));
  });

  test('returns 502 on connection refused', async () => {
    const deadPort = allocPort();
    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${deadPort}/test`);
    const res = await httpGet(proxyPort, '/');
    assert.equal(res.status, 502);
  });

  test('forwards request to upstream', async () => {
    const upstreamPort = allocPort();
    await startUpstream(upstreamPort, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, (req) => `http://127.0.0.1:${upstreamPort}${req.url}`);

    const res = await httpGet(proxyPort, '/v1/test');
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.path, '/v1/test');
  });

  test('calls onProxyReq callback', async () => {
    const upstreamPort = allocPort();
    await startUpstream(upstreamPort, (_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    let called = false;
    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/`, {
      onProxyReq: () => {
        called = true;
      },
    });

    const res = await httpGet(proxyPort, '/');
    assert.equal(res.status, 200);
    assert.equal(called, true);
  });

  test('calls onProxyRes callback', async () => {
    const upstreamPort = allocPort();
    await startUpstream(upstreamPort, (_req, res) => {
      res.writeHead(201);
      res.end('created');
    });

    let capturedStatus = null;
    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/`, {
      onProxyRes: (proxyRes) => {
        capturedStatus = proxyRes.statusCode;
      },
    });

    const res = await httpGet(proxyPort, '/');
    assert.equal(res.status, 201);
    assert.equal(capturedStatus, 201);
  });

  test('calls onError on connection failure', async () => {
    const deadPort = allocPort();
    let errorCaptured = false;
    let errorPhase = null;

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${deadPort}/`, {
      onError: (err, phase) => {
        errorCaptured = true;
        errorPhase = phase;
      },
    });

    await httpGet(proxyPort, '/');
    assert.ok(errorCaptured);
    assert.equal(errorPhase, 'request');
  });

  test('handles SSE upstream response', async () => {
    const upstreamPort = allocPort();
    await startUpstream(upstreamPort, (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"msg":"hello"}\n\n');
      res.end();
    });

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/stream`);

    const res = await httpGet(proxyPort, '/stream');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));
  });

  test('proxies POST body to upstream', async () => {
    const upstreamPort = allocPort();
    let receivedBody = null;
    await startUpstream(upstreamPort, (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        receivedBody = Buffer.concat(chunks).toString();
        res.writeHead(200);
        res.end('ok');
      });
    });

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/chat`);

    const body = JSON.stringify({ message: 'hello' });
    await httpGet(proxyPort, '/chat', { method: 'POST', body });
    assert.equal(receivedBody, body);
  });

  test('replaces host header with target', async () => {
    const upstreamPort = allocPort();
    let capturedHost = null;
    await startUpstream(upstreamPort, (req, res) => {
      capturedHost = req.headers.host;
      res.writeHead(200);
      res.end('ok');
    });

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/test`);

    await httpGet(proxyPort, '/test');
    assert.equal(capturedHost, `127.0.0.1:${upstreamPort}`);
  });

  test('strips keep-alive header', async () => {
    const upstreamPort = allocPort();
    let capturedHeaders = null;
    await startUpstream(upstreamPort, (req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200);
      res.end('ok');
    });

    const proxyPort = allocPort();
    await createProxyServer(proxyPort, () => `http://127.0.0.1:${upstreamPort}/`);

    await httpGet(proxyPort, '/', {
      headers: { 'keep-alive': 'timeout=5' },
    });
    assert.equal(capturedHeaders['keep-alive'], undefined);
  });
});

describe('Server – createServer()', () => {
  test('creates server on specified port', async () => {
    const port = allocPort();
    const { server, port: actualPort } = await createServer({ port });
    track(server);
    assert.equal(actualPort, port);
    assert.ok(server.listening);
  });

  test('creates server with default port', async () => {
    const { server } = await createServer({ port: allocPort() });
    track(server);
    assert.ok(server.listening);
  });

  test('uses custom requestHandler', async () => {
    const port = allocPort();
    let handlerCalled = false;
    const { server } = await createServer({
      port,
      requestHandler: (_req, res) => {
        handlerCalled = true;
        res.writeHead(200);
        res.end('handled');
      },
    });
    track(server);
    const res = await httpGet(port, '/');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'handled');
    assert.ok(handlerCalled);
  });

  test('returns 404 when no requestHandler configured', async () => {
    const port = allocPort();
    const { server } = await createServer({ port });
    track(server);
    const res = await httpGet(port, '/');
    assert.equal(res.status, 404);
  });

  test('returns 500 on handler exception', async () => {
    const port = allocPort();
    const { server } = await createServer({
      port,
      requestHandler: () => {
        throw new Error('boom');
      },
    });
    track(server);
    const res = await httpGet(port, '/');
    assert.equal(res.status, 500);
    assert.ok(res.body.includes('boom'));
  });

  test('throws when port is already in use', async () => {
    const port = allocPort();
    const first = await createServer({ port });
    track(first.server);
    await assert.rejects(() => createServer({ port }), { message: /already in use/i });
  });
});

describe('Server – shutdownServer()', () => {
  test('shuts down running server', async () => {
    const { server } = await createServer({ port: allocPort() });
    assert.ok(server.listening);
    await shutdownServer(server);
    assert.ok(!server.listening);
  });

  test('is idempotent', async () => {
    const { server } = await createServer({ port: allocPort() });
    await shutdownServer(server);
    await shutdownServer(server);
  });

  test('handles null', async () => {
    await shutdownServer(null);
  });

  test('handles undefined', async () => {
    await shutdownServer(undefined);
  });

  test('handles non-listening server', async () => {
    await shutdownServer(http.createServer(() => {}));
  });
});

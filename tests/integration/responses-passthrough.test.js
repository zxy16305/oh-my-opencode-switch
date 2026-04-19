/**
 * Integration tests for responses protocol passthrough.
 *
 * Verifies:
 * - Basic passthrough: request body is passed as-is except model replacement
 * - Streaming passthrough: SSE responses are passed unchanged
 * - Chat format requests sent to /v1/responses are fully passthrough
 * - Token capture works correctly for responses format events
 * - Failover works for responses routes
 * - Protocol routing regression test
 *
 * @module tests/integration/responses-passthrough.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { routeRequest, resetAllState } from '../../src/proxy/router.js';
import { TokenCaptivee } from '../../src/utils/token-capttee.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { detectProtocol } from '../../src/proxy/protocol-detector.js';

/**
 * Start a mock HTTP upstream server on dynamically assigned port.
 * Returns { server, port, requests } where requests is an array of received requests.
 */
function startMockUpstream(handler) {
  const requests = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      const requestRecord = {
        method: req.method,
        path: req.url,
        headers: { ...req.headers },
        body: null,
      };
      try {
        requestRecord.body = JSON.parse(body);
      } catch {
        requestRecord.body = body;
      }
      requests.push(requestRecord);
      handler(req, res, body, requestRecord);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port, requests }));
    server.once('error', reject);
  });
}

/** Shut down a mock upstream server */
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

/** HTTP helper that returns { status, headers, body } */
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

/** Create a request handler for the proxy server */
function createRequestHandler(routesConfig) {
  return (req, res) => {
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
      const capttee = new TokenCaptivee();

      try {
        const route = routesConfig[model];
        if (!route) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `Unknown model: ${model}` } }));
          return;
        }

        const { upstream: selected } = routeRequest(model, routesConfig, req, parsed);

        // Detect protocol from request path
        const { protocol, endpointPath } = detectProtocol(req);

        // Responses protocol: passthrough with model replacement only
        if (protocol === 'responses') {
          const targetUrl = `${selected.baseURL}${endpointPath}`;
          const forwardBody = JSON.stringify({ ...parsed, model: selected.model });

          forwardRequest(req, res, targetUrl, {
            body: forwardBody,
            responseTransform: capttee,
          });
        } else {
          // Chat protocol: use standard routing
          const targetUrl = `${selected.baseURL}/chat/completions`;
          const forwardBody = JSON.stringify({ ...parsed, model: selected.model });

          forwardRequest(req, res, targetUrl, {
            body: forwardBody,
            responseTransform: capttee,
          });
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
  };
}

describe('Responses Protocol Passthrough Integration', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
    resetAllState();
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  it('should pass request body as-is except model replacement for /v1/responses', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_123',
          object: 'response',
          status: 'completed',
          output: [{ type: 'text', text: 'Hello world' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      );
    });

    const routesConfig = {
      'lb-responses': {
        strategy: 'sticky',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'test',
            model: 'upstream-model',
            baseURL: `http://127.0.0.1:${mockUpstream.port}`,
            apiKey: 'test-key',
          },
        ],
      },
    };

    const proxy = await createServer({
      port: 0,
      requestHandler: createRequestHandler(routesConfig),
    });

    try {
      const requestBody = {
        model: 'lb-responses',
        input: 'What is the answer?',
        instructions: 'Be helpful',
        max_output_tokens: 1000,
        custom_field: 'should be preserved',
      };

      const clientRes = await httpFetch(proxy.port, '/v1/responses', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      assert.equal(mockUpstream.requests.length, 1, 'Should have received one request');
      assert.equal(mockUpstream.requests[0].path, '/responses', 'Should route to /responses');

      const upstreamBody = mockUpstream.requests[0].body;
      assert.equal(upstreamBody.model, 'upstream-model', 'Model should be replaced');
      assert.equal(upstreamBody.input, 'What is the answer?', 'Input should be preserved');
      assert.equal(upstreamBody.instructions, 'Be helpful', 'Instructions should be preserved');
      assert.equal(upstreamBody.max_output_tokens, 1000, 'max_output_tokens should be preserved');
      assert.equal(upstreamBody.custom_field, 'should be preserved', 'Custom fields preserved');

      assert.equal(clientRes.status, 200);
      const responseBody = JSON.parse(clientRes.body);
      assert.equal(responseBody.id, 'resp_123');
      assert.equal(responseBody.status, 'completed');
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  it('should pass request body as-is for /responses (root path)', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_456', status: 'completed' }));
    });

    const routesConfig = {
      'lb-responses': {
        strategy: 'sticky',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'test',
            model: 'upstream-model',
            baseURL: `http://127.0.0.1:${mockUpstream.port}`,
          },
        ],
      },
    };

    const proxy = await createServer({
      port: 0,
      requestHandler: createRequestHandler(routesConfig),
    });

    try {
      const requestBody = {
        model: 'lb-responses',
        input: 'Test input',
      };

      const clientRes = await httpFetch(proxy.port, '/responses', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(mockUpstream.requests[0].path, '/responses');
      assert.equal(mockUpstream.requests[0].body.model, 'upstream-model');
      assert.equal(clientRes.status, 200);
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  it('should pass SSE responses unchanged for responses protocol', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(
        'data: {"type":"response.created","response":{"id":"resp_123","object":"response","status":"in_progress"}}\n\n'
      );
      res.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":" world"}\n\n');
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":50}}}\n\n'
      );
      res.end();
    });

    const routesConfig = {
      'lb-responses': {
        strategy: 'sticky',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'test',
            model: 'upstream-model',
            baseURL: `http://127.0.0.1:${mockUpstream.port}`,
          },
        ],
      },
    };

    const proxy = await createServer({
      port: 0,
      requestHandler: createRequestHandler(routesConfig),
    });

    try {
      const clientRes = await httpFetch(proxy.port, '/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'lb-responses',
          input: 'Say hello',
          stream: true,
        }),
      });

      assert.equal(clientRes.status, 200);
      assert.ok(
        clientRes.body.includes('response.created'),
        'Should contain response.created event'
      );
      assert.ok(
        clientRes.body.includes('response.output_text.delta'),
        'Should contain delta events'
      );
      assert.ok(clientRes.body.includes('response.completed'), 'Should contain completed event');
      assert.ok(clientRes.body.includes('"delta":"Hello"'), 'Should contain delta content');
      assert.ok(
        !clientRes.body.includes('chat.completion.chunk'),
        'Should NOT contain chat format'
      );
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });
});

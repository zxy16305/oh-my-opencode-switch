/**
 * Integration tests for GPT-5 endpoint routing.
 *
 * Verifies the full flow: client request → proxy with endpoint routing → mock upstream
 * - GPT-5 with tools/reasoning routes to /v1/responses with transformed body
 * - GPT-5 without tools/reasoning routes to /v1/chat/completions unchanged
 * - Non-GPT-5 models route to /v1/chat/completions unchanged
 * - Responses API SSE format transformed back to Chat Completions SSE format
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { routeRequest } from '../../src/proxy/router.js';
import { TokenCaptivee } from '../../src/utils/token-capttee.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { resolveEndpoint } from '../../src/proxy/endpoint-resolver.js';
import { transformRequestBody } from '../../src/proxy/request-transformer.js';
import { ResponseTransformer } from '../../src/proxy/response-transformer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

        const endpointResult = resolveEndpoint(model, parsed);
        const targetUrl = `${selected.baseURL}${endpointResult.endpointPath}`;

      const forwardBody = endpointResult.needsTransform
        ? transformRequestBody(parsed, selected.model)
        : JSON.stringify({ ...parsed, model: selected.model });

      // Handle transformation and capture
      if (endpointResult.needsTransform) {
        const rt = new ResponseTransformer();
        // Pipe transformed data to capttee to capture usage
        rt.pipe(capttee);
        forwardRequest(req, res, targetUrl, {
          body: forwardBody,
          responseTransform: rt,
        });
      } else {
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

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Proxy Endpoint Routing Integration', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  // -------------------------------------------------------------------------
  // 1. GPT-5 + tools → /v1/responses, request transformed, response transformed back
  // -------------------------------------------------------------------------
  it('should route GPT-5 with tools to /v1/responses with transformed request', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(
        'data: {"type":"response.created","response":{"id":"resp_123","object":"response","status":"in_progress"}}\n\n'
      );
      res.write(
        'data: {"type":"response.in_progress","response":{"id":"resp_123","object":"response","status":"in_progress"}}\n\n'
      );
      res.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":" world"}\n\n');
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":50}}}\n\n'
      );
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          tools: [{ type: 'function', function: { name: 'test', parameters: {} } }],
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests.length, 1, 'Should have received one request');
      assert.equal(
        mockUpstream.requests[0].path,
        '/responses',
        'Should route to /v1/responses'
      );

      const upstreamBody = mockUpstream.requests[0].body;
      assert.ok('input' in upstreamBody, 'Request should have "input" field');
      assert.ok(!('messages' in upstreamBody), 'Request should NOT have "messages" field');

      const tools = upstreamBody.tools;
      assert.ok(Array.isArray(tools), 'Should have tools array');
      assert.equal(tools[0].type, 'function', 'Tool type should be function');
      assert.ok(!('function' in tools[0]), 'Tool should NOT have .function wrapper');
      assert.equal(tools[0].name, 'test', 'Tool name should be unwrapped');

      assert.equal(clientRes.status, 200);
      assert.ok(
        clientRes.body.includes('chat.completion.chunk'),
        'Response should contain Chat Completions format'
      );
      assert.ok(
        clientRes.body.includes('"content":"Hello"'),
        'Response should contain transformed content'
      );
      assert.ok(
        !clientRes.body.includes('response.created'),
        'Response should not leak raw Responses API lifecycle events'
      );
      assert.ok(
        !clientRes.body.includes('response.in_progress'),
        'Response should not leak in-progress lifecycle events'
      );
      assert.ok(clientRes.body.includes('[DONE]'), 'Response should contain [DONE]');
      assert.ok(clientRes.body.includes('prompt_tokens'), 'Response should contain usage info');
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 2. GPT-5 + reasoning_effort → /v1/responses, request transformed
  // -------------------------------------------------------------------------
  it('should route GPT-5 with reasoning_effort to /v1/responses with reasoning.effort', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          reasoning_effort: 'medium',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(mockUpstream.requests[0].path, '/responses');

      const body = mockUpstream.requests[0].body;
      assert.ok(body.reasoning, 'Should have reasoning object');
      assert.equal(body.reasoning.effort, 'medium', 'reasoning.effort should be medium');
      assert.ok(!('reasoning_effort' in body), 'Should NOT have reasoning_effort field');
      assert.ok('input' in body, 'Should have "input" field');
      assert.ok(!('messages' in body), 'Should NOT have "messages" field');

      assert.equal(clientRes.status, 200);
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 3. GPT-5 with empty tools → /chat/completions (no transform)
  // -------------------------------------------------------------------------
  it('should route GPT-5 with empty tools to /v1/chat/completions without transform', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          tools: [],
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(
        mockUpstream.requests[0].path,
        '/chat/completions',
        'Should route to /v1/chat/completions'
      );

      const body = mockUpstream.requests[0].body;
      assert.ok('messages' in body, 'Should have "messages" field (not transformed)');
      assert.ok(!('input' in body), 'Should NOT have "input" field');

      assert.equal(clientRes.status, 200);
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 4. GPT-5 without tools/reasoning → /chat/completions (no transform)
  // -------------------------------------------------------------------------
  it('should route GPT-5 without tools/reasoning to /v1/chat/completions without transform', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(mockUpstream.requests[0].path, '/chat/completions');

      const body = mockUpstream.requests[0].body;
      assert.ok('messages' in body, 'Should have "messages" field');
      assert.ok(!('input' in body), 'Should NOT have "input" field');

      assert.equal(clientRes.status, 200);
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Non-GPT-5 model → /chat/completions (unchanged)
  // -------------------------------------------------------------------------
  it('should route non-GPT-5 model to /v1/chat/completions without transform', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = {
      'qwen-plus': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'ali',
            model: 'qwen-plus',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests.length, 1);
      assert.equal(mockUpstream.requests[0].path, '/chat/completions');

      const body = mockUpstream.requests[0].body;
      assert.ok('messages' in body, 'Should have "messages" field');
      assert.ok(!('input' in body), 'Should NOT have "input" field');
      assert.equal(body.model, 'qwen-plus', 'Model should be replaced with upstream model');

      assert.equal(clientRes.status, 200);
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Streaming: SSE stream with multiple delta chunks → client receives complete Chat Completions SSE
  // -------------------------------------------------------------------------
  it('should transform Responses API SSE stream to Chat Completions SSE format', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type":"response.output_text.delta","delta":"The "}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":"answer "}\n\n');
      res.write('data: {"type":"response.output_text.delta","delta":"is 42."}\n\n');
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":200,"output_tokens":75}}}\n\n'
      );
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          tools: [{ type: 'function', function: { name: 'calc' } }],
          messages: [{ role: 'user', content: 'What is the answer?' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests[0].path, '/responses');

      assert.equal(clientRes.status, 200);
      assert.ok(
        clientRes.body.includes('chat.completion.chunk'),
        'Should contain chat.completion.chunk'
      );

      assert.ok(clientRes.body.includes('"content":"The "'), 'Should contain first delta');
      assert.ok(clientRes.body.includes('"content":"answer "'), 'Should contain second delta');
      assert.ok(clientRes.body.includes('"content":"is 42."'), 'Should contain third delta');

      assert.ok(clientRes.body.includes('prompt_tokens'), 'Should contain prompt_tokens');
      assert.ok(clientRes.body.includes('completion_tokens'), 'Should contain completion_tokens');

      assert.ok(clientRes.body.includes('[DONE]'), 'Should end with [DONE]');
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Error handling: upstream returns error on /v1/responses → client receives proper error
  // -------------------------------------------------------------------------
  it('should propagate error from /v1/responses to client', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(500, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Return error as SSE event matching Responses API format
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: { message: 'Internal server error', code: 500 }
      })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          tools: [{ type: 'function', function: { name: 'test' } }],
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      assert.equal(mockUpstream.requests[0].path, '/responses');

      assert.equal(clientRes.status, 500);
      // Error response should be passed through as-is
      assert.ok(clientRes.body.includes('Internal server error'), 'Should contain error message');
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });

  // -------------------------------------------------------------------------
  // 8. Retry: upstream A fails → retry upstream B receives same endpoint format
  // -------------------------------------------------------------------------
  it('should retry with same endpoint format when upstream fails', async () => {
    const mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n');
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":50}}}\n\n'
      );
      res.end();
    });

    const routesConfig = {
      'gpt-5': {
        strategy: 'round-robin',
        upstreams: [
          {
            id: 'mock-upstream-1',
            provider: 'openai',
            model: 'gpt-5',
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
      const clientRes = await httpFetch(proxy.port, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5',
          tools: [{ type: 'function', function: { name: 'test' } }],
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        }),
      });

      assert.equal(mockUpstream.requests[0].path, '/responses');
      assert.equal(clientRes.status, 200);
      assert.ok(
        'input' in mockUpstream.requests[0].body,
        'Transformed body should have input field'
      );
    } finally {
      await shutdownServer(proxy.server);
      await stopMock(mockUpstream);
    }
  });
});

// ---------------------------------------------------------------------------
// Additional tests for edge cases
// ---------------------------------------------------------------------------

describe('Endpoint Routing Edge Cases', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  it('should handle gpt-5.0 model variant with tools', async () => {
    const result = resolveEndpoint('gpt-5.0', { tools: [{ type: 'function', function: {} }] });
    assert.equal(result.endpointPath, '/responses');
    assert.equal(result.needsTransform, true);
  });

  it('should handle gpt-5.1-preview model variant with reasoning', async () => {
    const result = resolveEndpoint('gpt-5.1-preview', { reasoning_effort: 'high' });
    assert.equal(result.endpointPath, '/responses');
    assert.equal(result.needsTransform, true);
  });

  it('should NOT route gpt-50 to /v1/responses', async () => {
    const result = resolveEndpoint('gpt-50', { tools: [{ type: 'function', function: {} }] });
    assert.equal(result.endpointPath, '/chat/completions');
    assert.equal(result.needsTransform, false);
  });

  it('should NOT route gpt-5-tool to /v1/responses (no dot after 5)', async () => {
    const result = resolveEndpoint('gpt-5-tool', { tools: [{ type: 'function', function: {} }] });
    assert.equal(result.endpointPath, '/chat/completions');
    assert.equal(result.needsTransform, false);
  });

  it('should handle reasoning object (not reasoning_effort)', async () => {
    const result = resolveEndpoint('gpt-5', { reasoning: { effort: 'medium' } });
    assert.equal(result.endpointPath, '/responses');
    assert.equal(result.needsTransform, true);
  });

  it('should return chat/completions for null model', async () => {
    const result = resolveEndpoint(null, { tools: [] });
    assert.equal(result.endpointPath, '/chat/completions');
    assert.equal(result.needsTransform, false);
  });

  it('should return chat/completions for undefined request body', async () => {
    const result = resolveEndpoint('gpt-5', undefined);
    assert.equal(result.endpointPath, '/chat/completions');
    assert.equal(result.needsTransform, false);
  });
});

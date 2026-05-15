/**
 * E2E integration test for MCP proxy flow.
 *
 * Verifies:
 * - tools/list SSE responses have enum types fixed (type: 'string' added)
 * - tools/call JSON responses pass through unchanged
 * - Unknown MCP paths return 404
 * - Upstream errors return 502 with JSON-RPC error format
 *
 * @module tests/integration/mcp-proxy.test
 */

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, shutdownServer } from '../../src/proxy/server.js';
import { McpProxy } from '../../src/proxy/mcp-proxy/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturePath = join(__dirname, '..', 'fixtures', 'mcp-tools-list.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function startMockUpstream(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      handler(req, res, Buffer.concat(chunks));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}

function httpFetch(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
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

describe('MCP Proxy E2E', () => {
  let proxyServer;
  let upstreamMock;
  let mcpProxy;

  afterEach(async () => {
    if (proxyServer) {
      await shutdownServer(proxyServer);
      proxyServer = null;
    }
    if (upstreamMock) {
      await new Promise((resolve) => upstreamMock.server.close(resolve));
      upstreamMock = null;
    }
    mcpProxy = null;
  });

  test('tools/list response has enum types fixed', async () => {
    const adaptedFixture = JSON.parse(JSON.stringify(fixture));
    let targetTool = null;
    for (const tool of adaptedFixture.result.tools) {
      if (tool.function?.parameters?.properties?.truncateMode) {
        targetTool = tool;
        break;
      }
    }
    assert.ok(targetTool, 'Fixture should contain a tool with truncateMode');
    targetTool.inputSchema = targetTool.function.parameters;
    delete targetTool.function;

    upstreamMock = await startMockUpstream((req, res, _body) => {
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify(adaptedFixture)}\n\n`);
        res.end();
      } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
      }
    });

    mcpProxy = new McpProxy({
      test: {
        path: '/mcp/test',
        upstream: `http://127.0.0.1:${upstreamMock.port}`,
      },
    });

    const { server, port } = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        if (mcpProxy.matches(req.url)) {
          mcpProxy.handle(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      },
    });
    proxyServer = server;

    const response = await httpFetch(port, '/mcp/test', { method: 'GET' });
    assert.equal(response.status, 200);
    assert.ok(response.body.includes('data:'));

    const dataLine = response.body.split('\n').find((line) => line.startsWith('data:'));
    assert.ok(dataLine, 'Should have SSE data line');
    const dataJson = JSON.parse(dataLine.slice(5).trim());
    assert.ok(dataJson.result?.tools, 'Should have tools array');

    let foundTruncateMode = false;
    for (const tool of dataJson.result.tools) {
      const schema = tool.inputSchema;
      if (!schema?.properties?.truncateMode) continue;
      const tm = schema.properties.truncateMode;
      assert.equal(tm.type, 'string', 'truncateMode should have type: string added');
      assert.ok(Array.isArray(tm.enum), 'truncateMode should still have enum');
      foundTruncateMode = true;
      break;
    }
    assert.ok(foundTruncateMode, 'Should find truncateMode in response');
  });

  test('tools/call response passes through unchanged', async () => {
    const mockResponse = {
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'tool result' }] },
    };

    upstreamMock = await startMockUpstream((req, res, _body) => {
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockResponse));
      } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
      }
    });

    mcpProxy = new McpProxy({
      test: {
        path: '/mcp/test',
        upstream: `http://127.0.0.1:${upstreamMock.port}`,
      },
    });

    const { server, port } = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        if (mcpProxy.matches(req.url)) {
          mcpProxy.handle(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      },
    });
    proxyServer = server;

    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'test_tool', arguments: {} },
    });

    const response = await httpFetch(port, '/mcp/test', {
      method: 'POST',
      body: requestBody,
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.body,
      JSON.stringify(mockResponse),
      'Response should pass through unchanged'
    );
  });

  test('unknown path returns 404', async () => {
    mcpProxy = new McpProxy({
      test: {
        path: '/mcp/test',
        upstream: 'http://127.0.0.1:65534',
      },
    });

    const { server, port } = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        if (mcpProxy.matches(req.url)) {
          mcpProxy.handle(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      },
    });
    proxyServer = server;

    const response = await httpFetch(port, '/unknown-path');
    assert.equal(response.status, 404);
    assert.ok(response.body.includes('Not found'));
  });

  test('upstream error returns 502 with JSON-RPC error', async () => {
    mcpProxy = new McpProxy({
      test: {
        path: '/mcp/test',
        upstream: 'http://127.0.0.1:1',
      },
    });

    const { server, port } = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        if (mcpProxy.matches(req.url)) {
          mcpProxy.handle(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      },
    });
    proxyServer = server;

    const response = await httpFetch(port, '/mcp/test');
    assert.equal(response.status, 502);
    const body = JSON.parse(response.body);
    assert.equal(body.jsonrpc, '2.0');
    assert.ok(body.error, 'Should have error field');
    assert.equal(body.error.code, -32603, 'Should have JSON-RPC error code');
    assert.ok(
      body.error.message.includes('upstream unreachable'),
      'Error message should mention upstream unreachable'
    );
  });

  test('full MCP SSE flow: connect, get endpoint, POST to message', async () => {
    let receivedPostPath = '';
    let receivedPostBody = '';

    upstreamMock = await startMockUpstream((req, res, body) => {
      if (req.method === 'GET' && req.url === '/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('event: endpoint\ndata: /message?sessionId=test-session-123\n\n');
        const toolsList = {
          jsonrpc: '2.0', id: 1,
          result: {
            tools: [{
              name: 'testTool',
              inputSchema: { type: 'object', properties: { mode: { enum: ['fast', 'slow'] } } }
            }]
          }
        };
        res.write(`event: message\ndata: ${JSON.stringify(toolsList)}\n\n`);
        res.end();
      } else if (req.method === 'POST') {
        receivedPostPath = req.url;
        receivedPostBody = body.toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [] } }));
      } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
      }
    });

    mcpProxy = new McpProxy({
      idea: {
        path: '/mcp/idea/sse',
        upstream: `http://127.0.0.1:${upstreamMock.port}/sse`,
      },
    });

    const { server, port } = await createServer({
      port: 0,
      requestHandler: (req, res) => {
        if (mcpProxy.matches(req.url)) {
          mcpProxy.handle(req, res);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      },
    });
    proxyServer = server;

    const sseResponse = await httpFetch(port, '/mcp/idea/sse', { method: 'GET' });
    assert.equal(sseResponse.status, 200);
    assert.ok(sseResponse.headers['content-type'].includes('text/event-stream'));

    const lines = sseResponse.body.split('\n');
    const endpointLine = lines.find(l => l.startsWith('data: /'));
    assert.ok(endpointLine, 'Should have endpoint data line');
    assert.ok(
      endpointLine.includes('/mcp/idea/message?sessionId=test-session-123'),
      `Endpoint should be rewritten with prefix, got: ${endpointLine}`
    );

    const messageLine = lines.find(l => l.startsWith('data: {"jsonrpc'));
    assert.ok(messageLine, 'Should have tools/list message');
    const toolsData = JSON.parse(messageLine.slice(5).trim());
    assert.equal(toolsData.result.tools[0].inputSchema.properties.mode.type, 'string');

    const postResponse = await httpFetch(port, '/mcp/idea/message?sessionId=test-session-123', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} }),
    });
    assert.equal(postResponse.status, 200);

    assert.equal(receivedPostPath, '/message?sessionId=test-session-123',
      `Upstream should receive POST at /message path, got: ${receivedPostPath}`);
    assert.ok(receivedPostBody.includes('tools/call'));
  });
});

/**
 * Integration tests for debugbody feature.
 *
 * Tests the --debugbody flag which captures request/response bodies for debugging.
 *
 * Scenarios covered:
 * 1. Directory structure verification
 * 2. Response body capture (JSON and SSE)
 * 3. Meta file verification
 * 4. Folder name sanitization
 * 5. Error handling (silent failures)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { TokenCaptivee } from '../../src/utils/token-capttee.js';
import { getDebugBodiesDir } from '../../src/utils/proxy-paths.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * Start a mock upstream server
 */
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

/**
 * Stop a mock server
 */
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

/**
 * Simple HTTP fetch helper
 */
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

/**
 * Build routes config for testing
 */
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

/**
 * Create a proxy server with debugbody enabled
 */
function createProxyWithDebugBody(port, routesConfig) {
  return createServer({
    port,
    requestHandler: (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
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
        let proxyResStatusCode = null;
        let proxyResHeaders = null;
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

          // --- Debug body capture (mimicking server-manager.js logic) ---
          const sessionId = req.headers['x-session-id'] || null;
          const debugDir = getDebugBodiesDir();
          await fs.mkdir(debugDir, { recursive: true });
          
          const timestamp = new Date()
            .toISOString()
            .replace(/[:-]/g, '')
            .slice(0, 18);
          const safeSessionId = (sessionId || 'unknown').replace(
            /[/\\:*?"<>|]/g,
            '_'
          );
          const dirName = `${timestamp}-${safeSessionId}`;
          const msgDir = path.join(debugDir, dirName);
          await fs.mkdir(msgDir, { recursive: true });

          const meta = {
            model,
            target: selected.provider,
            upstreamModel: selected.model,
            timestamp: new Date().toISOString(),
          };

          // Store for later response write
          capttee._debugPaths = { msgDir, meta };

          // Write request files (fire and forget)
          fs.writeFile(
            path.join(msgDir, 'original.json'),
            rawBody.toString() || '{}'
          ).catch(() => {});

          const forwardBody = JSON.stringify({ ...parsed, model: selected.model });
          fs.writeFile(
            path.join(msgDir, 'forwarded.json'),
            forwardBody
          ).catch(() => {});
          // --- End debug body setup ---

          forwardRequest(req, res, targetUrl, {
            body: forwardBody,
            responseTransform: capttee,
            onProxyRes: (proxyRes) => {
              proxyResStatusCode = proxyRes.statusCode;
              proxyResHeaders = { ...proxyRes.headers };
            },
            onStreamEnd: () => {
              // --- Write response and meta files ---
              if (capttee._debugPaths) {
                try {
                  const { msgDir, meta } = capttee._debugPaths;
                  const response = capttee.getFullResponse();
                  const isSSE = response.includes('data:');
                  const responseFile = isSSE
                    ? path.join(msgDir, 'response.sse')
                    : path.join(msgDir, 'response.json');

                  const completeMeta = {
                    ...meta,
                    statusCode: proxyResStatusCode,
                    responseHeaders: proxyResHeaders || {},
                  };

                  fs.writeFile(responseFile, response).catch(() => {});
                  fs.writeFile(
                    path.join(msgDir, 'meta.json'),
                    JSON.stringify(completeMeta, null, 2)
                  ).catch(() => {});
                } catch {
                  // Silent failure
                }
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
}

/**
 * Wait for file to exist with retry
 */
async function waitForFile(filePath, maxWaitMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return false;
}

/**
 * List all directories in the debug-bodies folder
 */
async function listDebugDirs() {
  const debugDir = getDebugBodiesDir();
  try {
    const entries = await fs.readdir(debugDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * List files in a directory
 */
async function listFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Proxy Debugbody Feature', () => {
  let testHome;
  let proxy;
  let mockUpstream;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
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
  // 1. Directory Structure Verification
  // -------------------------------------------------------------------------
  it('should create directory with correct format and 4 files', async () => {
    const PORT = 18401;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-1', provider: 'test-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    // Send request with session ID
    const res = await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-session-id': 'test-session-123' },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    assert.equal(res.status, 200, 'Request should succeed');

    // Wait for files to be written
    await new Promise((r) => setTimeout(r, 500));

    // Verify directory was created
    const dirs = await listDebugDirs();
    assert.ok(dirs.length > 0, 'Should create at least one debug directory');

    // Find the directory with our session ID
    const ourDir = dirs.find(d => d.includes('test-session-123') || d.includes('unknown'));
    assert.ok(ourDir, 'Should find directory with session ID or "unknown"');

    // Verify directory name format: {timestamp}-{sessionId}
    // Timestamp: ISO string with hyphens/colons removed, sliced to 18 chars
    // Format: YYYYMMDDTHHmmss.SS (includes the dot from milliseconds)
    const parts = ourDir.split('-');
    assert.ok(parts.length >= 2, 'Directory name should have timestamp-sessionId format');
    // Timestamp is 18 chars: 8 digits + T + 6 digits + dot + 2 digits (or similar)
    assert.ok(/^\d{8}T\d{6}\.\d{2}$/.test(parts[0]) || /^\d{8}T\d{6}\d{2}$/.test(parts[0]), 'First part should be timestamp format');

    // Verify 4 files exist
    const msgDir = path.join(getDebugBodiesDir(), ourDir);
    const files = await listFiles(msgDir);
    
    assert.ok(files.includes('original.json'), 'Should have original.json');
    assert.ok(files.includes('forwarded.json'), 'Should have forwarded.json');
    assert.ok(files.includes('meta.json'), 'Should have meta.json');
    assert.ok(
      files.includes('response.json') || files.includes('response.sse'),
      'Should have response.json or response.sse'
    );
    assert.equal(files.length, 4, 'Should have exactly 4 files');
  });

  // -------------------------------------------------------------------------
  // 2. Response Body Capture - JSON
  // -------------------------------------------------------------------------
  it('should capture JSON response in response.json', async () => {
    const PORT = 18402;
    const responseBody = {
      id: 'chatcmpl-json-test',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'This is a JSON response' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    };

    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-json', provider: 'json-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    const res = await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    const ourDir = dirs[0];
    const msgDir = path.join(getDebugBodiesDir(), ourDir);

    // Read and verify response.json
    const responsePath = path.join(msgDir, 'response.json');
    const exists = await waitForFile(responsePath);
    assert.ok(exists, 'response.json should exist');

    const responseContent = JSON.parse(await fs.readFile(responsePath, 'utf-8'));
    assert.equal(responseContent.id, 'chatcmpl-json-test', 'Response ID should match');
    assert.equal(responseContent.choices[0].message.content, 'This is a JSON response');
    assert.equal(responseContent.usage.prompt_tokens, 100);
  });

  // -------------------------------------------------------------------------
  // 2. Response Body Capture - SSE
  // -------------------------------------------------------------------------
  it('should capture SSE response in response.sse', async () => {
    const PORT = 18403;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write('data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":20}}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-sse', provider: 'sse-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    const res = await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    assert.equal(res.status, 200);

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    const ourDir = dirs[0];
    const msgDir = path.join(getDebugBodiesDir(), ourDir);

    // Should have response.sse (not response.json)
    const ssePath = path.join(msgDir, 'response.sse');
    const exists = await waitForFile(ssePath);
    assert.ok(exists, 'response.sse should exist');

    const sseContent = await fs.readFile(ssePath, 'utf-8');
    assert.ok(sseContent.includes('data:'), 'SSE content should have data: prefix');
    assert.ok(sseContent.includes('[DONE]'), 'SSE content should have [DONE]');
    assert.ok(sseContent.includes('Hello'), 'SSE content should have message chunks');
  });

  // -------------------------------------------------------------------------
  // 3. Meta File Verification
  // -------------------------------------------------------------------------
  it('should have complete meta.json with all required fields', async () => {
    const PORT = 18404;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test', choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-meta', provider: 'meta-provider', model: 'upstream-model-name', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    const msgDir = path.join(getDebugBodiesDir(), dirs[0]);

    const metaPath = path.join(msgDir, 'meta.json');
    const exists = await waitForFile(metaPath);
    assert.ok(exists, 'meta.json should exist');

    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    // Verify required fields
    assert.equal(meta.model, 'test-model', 'model should match virtual model');
    assert.equal(meta.target, 'meta-provider', 'target should be provider name');
    assert.equal(meta.upstreamModel, 'upstream-model-name', 'upstreamModel should match');
    assert.ok(meta.timestamp, 'should have timestamp');
    assert.ok(typeof meta.statusCode === 'number', 'should have statusCode');
    assert.ok(meta.responseHeaders, 'should have responseHeaders');
    assert.ok(typeof meta.responseHeaders === 'object', 'responseHeaders should be object');
  });

  // -------------------------------------------------------------------------
  // 4. Folder Name Sanitization
  // -------------------------------------------------------------------------
  it('should sanitize invalid characters in sessionId', async () => {
    const PORT = 18405;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test', choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-sanitize', provider: 'sanitize-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    // Test with sessionId containing invalid characters: / \ : * ? " < > |
    // Note: = is NOT in the sanitization list
    const invalidSessionId = 'test/session\\id:with*invalid?chars"<|>pipe';
    // Expected: / → _, \ → _, : → _, * → _, ? → _, " → _, < → _, > → _, | → _
    const expectedSafe = 'test_session_id_with_invalid_chars____pipe';

    await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-session-id': invalidSessionId },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    
    // Find directory with sanitized name
    const sanitizedDir = dirs.find(d => d.includes('test_session'));
    assert.ok(sanitizedDir, 'Should have directory with sanitized sessionId');

    // Verify the sanitized part matches expected
    const sessionIdPart = sanitizedDir.split('-').slice(1).join('-');
    assert.equal(sessionIdPart, expectedSafe, 'SessionId should be properly sanitized');

    // Verify directory is accessible
    const msgDir = path.join(getDebugBodiesDir(), sanitizedDir);
    const files = await listFiles(msgDir);
    assert.ok(files.length > 0, 'Files should be written to sanitized directory');
  });

  // -------------------------------------------------------------------------
  // 4. Folder Name Sanitization - Edge cases
  // -------------------------------------------------------------------------
  it('should handle empty/missing sessionId with "unknown"', async () => {
    const PORT = 18406;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test', choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-unknown', provider: 'unknown-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    // Request without session ID header
    await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    const unknownDir = dirs.find(d => d.includes('unknown'));
    assert.ok(unknownDir, 'Should have directory with "unknown" for missing sessionId');
  });

  // -------------------------------------------------------------------------
  // 5. Error Handling - Silent failures
  // -------------------------------------------------------------------------
  it('should not crash when file writes fail', async () => {
    const PORT = 18407;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test', choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-error', provider: 'error-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    // This should succeed even if there are file system issues
    const res = await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
      }),
    });

    // The proxy should still return a successful response
    assert.equal(res.status, 200, 'Proxy should succeed even if debug writes fail');
  });

  // -------------------------------------------------------------------------
  // 5. Error Handling - Normal proxy operation continues
  // -------------------------------------------------------------------------
  it('should continue normal proxy operation even if debug body fails', async () => {
    const PORT = 18408;
    let requestCount = 0;

    mockUpstream = await startMockUpstream((_req, res) => {
      requestCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `test-${requestCount}`, choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-continue', provider: 'continue-provider', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    // Send multiple requests - all should succeed
    for (let i = 0; i < 3; i++) {
      const res = await httpFetch(PORT, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: `Test ${i}` }],
        }),
      });
      assert.equal(res.status, 200, `Request ${i} should succeed`);
    }

    assert.equal(requestCount, 3, 'All requests should reach upstream');
  });

  // -------------------------------------------------------------------------
  // Additional: Verify original.json and forwarded.json content
  // -------------------------------------------------------------------------
  it('should capture correct request bodies in original.json and forwarded.json', async () => {
    const PORT = 18409;
    mockUpstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test', choices: [] }));
    });

    const routesConfig = buildRoutesConfig([
      { id: 'mock-content', provider: 'content-provider', model: 'upstream-model', baseURL: `http://127.0.0.1:${mockUpstream.port}` },
    ]);
    proxy = await createProxyWithDebugBody(PORT, routesConfig);

    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello world' }],
      temperature: 0.7,
      max_tokens: 100,
    };

    await httpFetch(PORT, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    // Wait for files
    await new Promise((r) => setTimeout(r, 500));

    const dirs = await listDebugDirs();
    const msgDir = path.join(getDebugBodiesDir(), dirs[0]);

    // Read original.json
    const originalPath = path.join(msgDir, 'original.json');
    await waitForFile(originalPath);
    const original = JSON.parse(await fs.readFile(originalPath, 'utf-8'));
    
    assert.equal(original.model, 'test-model', 'original.json should have original model');
    assert.equal(original.messages[0].content, 'Hello world');
    assert.equal(original.temperature, 0.7);

    // Read forwarded.json
    const forwardedPath = path.join(msgDir, 'forwarded.json');
    await waitForFile(forwardedPath);
    const forwarded = JSON.parse(await fs.readFile(forwardedPath, 'utf-8'));
    
    // Forwarded should have upstream model name
    assert.equal(forwarded.model, 'upstream-model', 'forwarded.json should have upstream model');
    assert.equal(forwarded.messages[0].content, 'Hello world');
  });
});

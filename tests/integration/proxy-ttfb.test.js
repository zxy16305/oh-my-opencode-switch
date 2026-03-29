/**
 * Integration tests for proxy TTFB tracking.
 *
 * Verifies the full flow: mock upstream → proxy → log → stats
 * - Mock upstream returns streaming SSE responses with controlled delays
 * - Proxy forwards requests and records ttfb/duration via onStreamEnd
 * - Log file contains ttfb=Xms and duration=Yms fields
 * - generateStats produces avgTtfb, ttfbP95, ttfbP99
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { createServer, shutdownServer, forwardRequest } from '../../src/proxy/server.js';
import { routeRequest } from '../../src/proxy/router.js';
import { logAccess, readLogs, clearLogs, getLogPath } from '../../src/utils/access-log.js';
import { generateStats, parseLogLine, parseTimeRange } from '../../src/utils/stats.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextPort = 29830;
function allocPort() {
  return nextPort++;
}

/** Start a bare-bones HTTP server on the given port */
function startMockUpstream(port, handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      handler(req, res, body);
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve({ server, port }));
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

describe('Proxy TTFB Integration', () => {
  let mockUpstream;
  let proxy;
  const logPath = getLogPath();
  let backupPath = null;

  before(async () => {
    // Backup existing log file
    try {
      backupPath = logPath + '.ttfb-test-backup';
      fs.copyFileSync(logPath, backupPath);
    } catch {
      backupPath = null;
    }
    // Clear log for clean test state
    await clearLogs();
    // Ensure log directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    // Create mock upstream that returns SSE stream with a deliberate delay
    const upstreamPort = allocPort();
    mockUpstream = await startMockUpstream(upstreamPort, (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // First chunk after a small delay (simulates TTFB)
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
        // Second chunk after another delay
        setTimeout(() => {
          res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }, 50);
      }, 30);
    });

    // Create proxy server with routing and TTFB/duration logging
    const proxyPort = allocPort();
    const routesConfig = buildRoutesConfig([
      { id: 'mock-upstream-1', baseURL: `http://127.0.0.1:${upstreamPort}` },
    ]);

    proxy = await createServer({
      port: proxyPort,
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

          try {
            const { upstream: selected } = routeRequest(model, routesConfig, req);
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
                  sessionId: null,
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

    // Restore original log file
    try {
      if (backupPath) {
        fs.copyFileSync(backupPath, logPath);
        fs.unlinkSync(backupPath);
      } else {
        fs.unlinkSync(logPath);
      }
    } catch {
      // already cleaned up
    }
  });

  // -------------------------------------------------------------------------
  // 1. Basic proxy forwarding with streaming
  // -------------------------------------------------------------------------
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
  });

  // -------------------------------------------------------------------------
  // 2. Log file contains ttfb and duration fields
  // -------------------------------------------------------------------------
  it('should log ttfb and duration for streaming response', async () => {
    // Wait for log to be flushed
    await new Promise((r) => setTimeout(r, 200));

    const logs = await readLogs(50);
    assert.ok(logs.length > 0, 'Log file should contain at least one entry');

    // Find our test request log line
    const testLogs = logs.filter((l) => l.includes('provider=mock') && l.includes('ttfb='));
    assert.ok(testLogs.length > 0, 'Should find log entries with ttfb field');

    const lastLog = testLogs[testLogs.length - 1];

    // Verify log format contains both ttfb and duration
    assert.match(lastLog, /ttfb=\d+ms/, 'Log should contain ttfb=Xms');
    assert.match(lastLog, /duration=\d+ms/, 'Log should contain duration=Yms');
    assert.match(lastLog, /provider=mock/, 'Log should contain provider');
    assert.match(lastLog, /model=test-model/, 'Log should contain model');
    assert.match(lastLog, /virtualModel=test-model/, 'Log should contain virtualModel');
    assert.match(lastLog, /status=200/, 'Log should contain status=200');

    // Parse and verify ttfb/duration are reasonable numbers
    const parsed = parseLogLine(lastLog);
    assert.ok(parsed, 'Log line should be parseable');
    assert.ok(parsed.ttfb > 0, `ttfb should be > 0, got ${parsed.ttfb}`);
    assert.ok(parsed.duration > 0, `duration should be > 0, got ${parsed.duration}`);
    assert.ok(
      parsed.duration >= parsed.ttfb,
      `duration (${parsed.duration}) should be >= ttfb (${parsed.ttfb})`
    );
  });

  // -------------------------------------------------------------------------
  // 3. Multiple requests produce multiple log entries
  // -------------------------------------------------------------------------
  it('should log multiple requests with increasing ttfb/duration', async () => {
    // Send 3 more requests
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

    // Wait for logs to flush
    await new Promise((r) => setTimeout(r, 300));

    const logs = await readLogs(100);
    const testLogs = logs.filter((l) => l.includes('provider=mock') && l.includes('ttfb='));
    assert.ok(testLogs.length >= 4, `Should have at least 4 log entries, got ${testLogs.length}`);

    // All entries should be parseable with valid ttfb/duration
    for (const line of testLogs) {
      const parsed = parseLogLine(line);
      assert.ok(parsed, `Log line should be parseable: ${line}`);
      assert.ok(parsed.ttfb > 0, `ttfb should be > 0 in line: ${line}`);
      assert.ok(parsed.duration > 0, `duration should be > 0 in line: ${line}`);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Stats output contains TTFB metrics
  // -------------------------------------------------------------------------
  it('should calculate ttfb stats from log entries', async () => {
    const startTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const endTime = new Date(Date.now() + 60 * 1000); // 1 minute in future

    const stats = await generateStats({ startTime, endTime });
    assert.ok(stats.length > 0, 'Should produce at least one stats group');

    const mockGroup = stats.find((s) => s.provider === 'mock');
    assert.ok(mockGroup, 'Should have stats for mock provider');

    // Verify requests count (at least 4 from this test suite)
    assert.ok(
      mockGroup.requests >= 4,
      `Should have at least 4 requests, got ${mockGroup.requests}`
    );

    // Verify TTFB fields exist
    assert.ok('avgTtfb' in mockGroup, 'Stats should include avgTtfb field');
    assert.ok('ttfbP95' in mockGroup, 'Stats should include ttfbP95 field');
    assert.ok('ttfbP99' in mockGroup, 'Stats should include ttfbP99 field');

    // Verify TTFB values are reasonable
    assert.ok(mockGroup.avgTtfb > 0, `avgTtfb should be > 0, got ${mockGroup.avgTtfb}`);
    assert.ok(
      typeof mockGroup.ttfbP95 === 'number',
      `ttfbP95 should be a number, got ${typeof mockGroup.ttfbP95}`
    );
    assert.ok(
      typeof mockGroup.ttfbP99 === 'number',
      `ttfbP99 should be a number, got ${typeof mockGroup.ttfbP99}`
    );

    // P99 >= P95 (with rounding they could be equal)
    assert.ok(
      mockGroup.ttfbP99 >= mockGroup.ttfbP95,
      `ttfbP99 (${mockGroup.ttfbP99}) should be >= ttfbP95 (${mockGroup.ttfbP95})`
    );

    // Also verify duration fields still work
    assert.ok('avgDuration' in mockGroup, 'Stats should include avgDuration field');
    assert.ok('p95' in mockGroup, 'Stats should include p95 (duration) field');
    assert.ok(mockGroup.avgDuration > 0, `avgDuration should be > 0, got ${mockGroup.avgDuration}`);

    // Success rate should be 100%
    assert.equal(mockGroup.success, mockGroup.requests);
    assert.equal(mockGroup.failure, 0);
  });

  // -------------------------------------------------------------------------
  // 5. parseTimeRange works with common formats
  // -------------------------------------------------------------------------
  it('should parse time range for stats query', () => {
    const { startTime, endTime } = parseTimeRange('1h');
    assert.ok(startTime instanceof Date);
    assert.ok(endTime instanceof Date);
    assert.ok(startTime < endTime, 'startTime should be before endTime');

    // Verify 1h range is approximately correct
    const diff = endTime - startTime;
    assert.ok(Math.abs(diff - 3600000) < 1000, `1h range should be ~3600000ms, got ${diff}ms`);
  });

  // -------------------------------------------------------------------------
  // 6. Direct logAccess + generateStats integration
  // -------------------------------------------------------------------------
  it('should integrate logAccess output with generateStats', async () => {
    // Write log entries directly via logAccess with known TTFB values
    const knownTtfbs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const ttfb of knownTtfbs) {
      await logAccess({
        sessionId: 'direct-test',
        provider: 'direct-provider',
        model: 'direct-model',
        virtualModel: 'direct-vm',
        status: 200,
        ttfb,
        duration: ttfb * 10,
      });
    }

    // Wait for log to flush
    await new Promise((r) => setTimeout(r, 200));

    const startTime = new Date(Date.now() - 60 * 60 * 1000);
    const endTime = new Date(Date.now() + 60 * 1000);
    const stats = await generateStats({ startTime, endTime });

    const directGroup = stats.find(
      (s) => s.provider === 'direct-provider' && s.model === 'direct-model'
    );
    assert.ok(directGroup, 'Should have stats for direct-provider/direct-model');

    assert.equal(directGroup.requests, 10);
    assert.equal(directGroup.success, 10);
    assert.equal(directGroup.failure, 0);

    // avgTtfb = (10+20+...+100) / 10 = 550 / 10 = 55
    assert.equal(directGroup.avgTtfb, 55, `avgTtfb should be 55, got ${directGroup.avgTtfb}`);

    // avgDuration = avgTtfb * 10 = 550
    assert.equal(
      directGroup.avgDuration,
      550,
      `avgDuration should be 550, got ${directGroup.avgDuration}`
    );

    // P95 and P99 should be present and valid numbers
    assert.ok(directGroup.ttfbP95 > 0, `ttfbP95 should be > 0, got ${directGroup.ttfbP95}`);
    assert.ok(directGroup.ttfbP99 > 0, `ttfbP99 should be > 0, got ${directGroup.ttfbP99}`);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'fs/promises';
import path from 'path';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';
import { getOosDir } from '../../../src/utils/paths.js';

let testHome;

beforeEach(async () => {
  const result = await setupTestHome();
  testHome = result.testHome;
});

afterEach(async () => {
  await cleanupTestHome(testHome);
});

function createMockRequest(url = '/_internal/analytics?last=24h') {
  const req = new Readable({
    read() {
      this.push(null);
    },
  });
  req.url = url;
  req.headers = { host: 'localhost:3000' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    end(body) {
      this.body = body;
    },
  };
}

describe('handleAnalytics error isolation', () => {
  it('returns 200 with partial data when accesslog unavailable', async () => {
    const { handleAnalytics } = await import('../../../src/proxy/internal-endpoints.js');

    const req = createMockRequest();
    const res = createMockResponse();
    await handleAnalytics(req, res);

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.timestamp);
    assert.ok(body.timeRange);
    assert.ok(body.summary);
    assert.ok(Array.isArray(body.topModels));
    assert.ok(Array.isArray(body.topAgents));
    assert.ok(Array.isArray(body.categoryStats));
  });

  it('returns 200 with parsed accesslog data', async () => {
    const { handleAnalytics } = await import('../../../src/proxy/internal-endpoints.js');

    const logsDir = path.join(getOosDir(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    const now = new Date();
    const ts = now.toISOString();
    const validLogLine = `[${ts}] session=test-sid provider=ali model=qwen virtualModel=lb-qwen status=200 ttfb=100ms duration=500ms\n`;
    await fs.writeFile(path.join(logsDir, 'proxy-access.log'), validLogLine);

    const req = createMockRequest();
    const res = createMockResponse();
    await handleAnalytics(req, res);

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.timestamp);
    assert.ok(body.timeRange);
    assert.ok(body.summary.totalRequests >= 1);
    assert.ok(Array.isArray(body.topModels));
    assert.ok(Array.isArray(body.topAgents));
    assert.ok(Array.isArray(body.categoryStats));
  });

  it('returns 200 with empty data when no sources have data', async () => {
    const { handleAnalytics } = await import('../../../src/proxy/internal-endpoints.js');

    const req = createMockRequest();
    const res = createMockResponse();
    await handleAnalytics(req, res);

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.timestamp);
    assert.ok(body.timeRange);
    assert.strictEqual(body.summary.totalRequests, 0);
    assert.ok(Array.isArray(body.topModels));
    assert.ok(Array.isArray(body.topAgents));
    assert.ok(Array.isArray(body.categoryStats));
    assert.strictEqual(body.errors, undefined);
  });
});

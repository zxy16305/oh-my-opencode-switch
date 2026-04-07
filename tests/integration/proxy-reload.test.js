/**
 * Integration tests for proxy hot reload end-to-end flow.
 * @module tests/integration/proxy-reload
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ProxyServerManager } from '../../src/proxy/server-manager.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { writeJson, ensureDir } from '../../src/utils/files.js';
import { getProxyConfigPath, getOpencodeConfigPath } from '../../src/utils/proxy-paths.js';
import { getOosDir } from '../../src/utils/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let testHome;
let manager;
let backendServer;
let originalProcessExit;

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

beforeEach(async () => {
  const setup = await setupTestHome();
  testHome = setup.testHome;

  originalProcessExit = process.exit;
  process.exit = (code) => {
    throw new Error(`process.exit(${code}) called during test`);
  };

  await ensureDir(getOosDir());

  const opencodeConfigPath = getOpencodeConfigPath();
  await ensureDir(path.dirname(opencodeConfigPath));
  await writeJson(opencodeConfigPath, {
    provider: {
      'test-provider': {
        options: {
          baseURL: 'http://localhost:9999',
        },
      },
    },
  });

  manager = new ProxyServerManager();
});

afterEach(async () => {
  process.exit = originalProcessExit;

  if (manager) {
    await manager.stopAll().catch(() => {});
  }

  if (backendServer) {
    await new Promise((resolve) => backendServer.close(resolve));
    backendServer = null;
  }

  await cleanupTestHome(testHome);
});

describe('Proxy Reload - End-to-End', () => {
  it('should reload config successfully and return diff', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    backendServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const reloadResponse = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(reloadResponse.status, 200);
    assert.equal(reloadResponse.data.success, true);
    assert.ok(reloadResponse.data.diff);
    assert.equal(reloadResponse.data.diff.hasChanges, false);

    const newConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
            {
              provider: 'test-provider',
              model: 'model-b',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
        'lb-new': {
          strategy: 'sticky',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), newConfig);

    const reloadResponse2 = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(reloadResponse2.status, 200);
    assert.equal(reloadResponse2.data.success, true);
    assert.ok(reloadResponse2.data.diff);
    assert.equal(reloadResponse2.data.diff.hasChanges, true);
    assert.equal(reloadResponse2.data.diff.added.length, 1);
    assert.equal(reloadResponse2.data.diff.added[0], 'lb-new');
    assert.equal(reloadResponse2.data.diff.modified.length, 1);
    assert.equal(reloadResponse2.data.diff.modified[0], 'lb-test');
    assert.equal(reloadResponse2.data.diff.removed.length, 0);

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });

  it('should preserve old config when new config is invalid', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    backendServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-valid': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const invalidConfig = {
      port: proxyPort,
      routes: {},
    };

    await writeJson(getProxyConfigPath(), invalidConfig);

    const reloadResponse = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(reloadResponse.status, 400);
    assert.equal(reloadResponse.data.success, false);
    assert.ok(reloadResponse.data.error);

    const debugResponse = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/debug`);
    assert.equal(debugResponse.status, 200);
    assert.ok(debugResponse.data.routes['lb-valid']);

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });

  it('should reject concurrent reload requests', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    backendServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const newConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'sticky',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };
    await writeJson(getProxyConfigPath(), newConfig);

    const reloadPromises = [];
    for (let i = 0; i < 3; i++) {
      reloadPromises.push(
        makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    const results = await Promise.all(reloadPromises);

    const successCount = results.filter((r) => r.status === 200).length;
    const deferredCount = results.filter(
      (r) => r.status === 400 && r.data.error?.includes('progress')
    ).length;

    assert.equal(successCount, 1, 'Exactly one reload should succeed');
    assert.equal(deferredCount, 2, 'Other reloads should be deferred');

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });

  it('should not interrupt in-flight requests during reload', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    let requestStarted = false;
    let requestCompleted = false;

    backendServer = http.createServer((req, res) => {
      requestStarted = true;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'delayed response' } }] }));
        requestCompleted = true;
      }, 500);
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const proxyRequestPromise = makeRequest(`http://127.0.0.1:${proxyPort}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'lb-test', messages: [{ role: 'user', content: 'test' }] }),
    });

    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (requestStarted) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 200);
    });

    const newConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'sticky',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };
    await writeJson(getProxyConfigPath(), newConfig);

    const reloadResponse = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(reloadResponse.status, 200);

    const proxyResponse = await proxyRequestPromise;
    assert.equal(proxyResponse.status, 200);
    assert.ok(requestCompleted, 'In-flight request should complete');

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });

  it('should reject non-localhost reload requests', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    backendServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.168.1.100',
      },
    });

    assert.equal(response.status, 403);
    assert.ok(response.data.error?.includes('Forbidden'));

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });

  it('should handle reload when config file does not exist', async () => {
    const proxyPort = await getAvailablePort();
    const backendPort = await getAvailablePort();

    backendServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'test' } }] }));
    });
    await new Promise((resolve) => backendServer.listen(backendPort, resolve));

    const initialConfig = {
      port: proxyPort,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'test-provider',
              model: 'model-a',
              baseURL: `http://127.0.0.1:${backendPort}`,
              apiKey: 'test-key',
            },
          ],
        },
      },
    };

    await writeJson(getProxyConfigPath(), initialConfig);
    await manager.start({ port: proxyPort });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const configPath = getProxyConfigPath();
    await fs.unlink(configPath);

    const response = await makeRequest(`http://127.0.0.1:${proxyPort}/_internal/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.equal(response.status, 400);
    assert.ok(response.data.error?.includes('not found'));

    await manager.stopAll();
    await new Promise((resolve) => backendServer.close(resolve));
  });
});

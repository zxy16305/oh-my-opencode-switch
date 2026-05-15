import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { McpProxy } from '../../../src/proxy/mcp-proxy/index.js';

describe('McpProxy', () => {
  test('matches configured path', () => {
    const proxy = new McpProxy({
      test: { upstream: 'http://localhost:8080/sse', path: '/mcp/test/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/test/sse'), true);
  });

  test('matches path with query string', () => {
    const proxy = new McpProxy({
      test: { upstream: 'http://localhost:8080/sse', path: '/mcp/test/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/test/sse?foo=bar'), true);
  });

  test('does not match unknown path', () => {
    const proxy = new McpProxy({
      test: { upstream: 'http://localhost:8080/sse', path: '/mcp/test/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/unknown/sse'), false);
  });

  test('returns false for unmatched handle', () => {
    const proxy = new McpProxy({
      test: { upstream: 'http://localhost:8080/sse', path: '/mcp/test/sse' },
    });
    const result = proxy.handle({ url: '/unknown', method: 'GET' }, {});
    assert.strictEqual(result, false);
  });

  test('updateRoutes replaces existing routes', () => {
    const proxy = new McpProxy({
      a: { upstream: 'http://a/sse', path: '/mcp/a/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/a/sse'), true);

    proxy.updateRoutes({
      b: { upstream: 'http://b/sse', path: '/mcp/b/sse' },
    });

    assert.strictEqual(proxy.matches('/mcp/a/sse'), false);
    assert.strictEqual(proxy.matches('/mcp/b/sse'), true);
  });

  test('handles empty config', () => {
    const proxy = new McpProxy({});
    assert.strictEqual(proxy.matches('/anything'), false);
  });

  test('matches multiple routes', () => {
    const proxy = new McpProxy({
      a: { upstream: 'http://a/sse', path: '/mcp/a/sse' },
      b: { upstream: 'http://b/sse', path: '/mcp/b/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/a/sse'), true);
    assert.strictEqual(proxy.matches('/mcp/b/sse'), true);
    assert.strictEqual(proxy.matches('/mcp/c/sse'), false);
  });

  test('matches sub-paths via prefix derivation', () => {
    // path="/mcp/idea/sse", upstream pathname="/sse" → prefix="/mcp/idea"
    const proxy = new McpProxy({
      idea: { upstream: 'http://localhost:64342/sse', path: '/mcp/idea/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/idea/sse'), true);
    assert.strictEqual(proxy.matches('/mcp/idea/message'), true);
    assert.strictEqual(proxy.matches('/mcp/idea/message?sessionId=abc'), true);
    assert.strictEqual(proxy.matches('/mcp/other/sse'), false);
    assert.strictEqual(proxy.matches('/mcp/idea'), true);
  });

  test('prefix does not match partial segments', () => {
    // prefix="/mcp/idea" should NOT match "/mcp/ideal-world"
    const proxy = new McpProxy({
      idea: { upstream: 'http://localhost:64342/sse', path: '/mcp/idea/sse' },
    });
    assert.strictEqual(proxy.matches('/mcp/ideal-world'), false);
  });

  test('exact match when upstream has no path', () => {
    // upstream="http://localhost:8080" (pathname="/"), path="/mcp/test" → prefix="/mcp/test"
    const proxy = new McpProxy({
      test: { upstream: 'http://localhost:8080', path: '/mcp/test' },
    });
    assert.strictEqual(proxy.matches('/mcp/test'), true);
    assert.strictEqual(proxy.matches('/mcp/test/something'), true);
    assert.strictEqual(proxy.matches('/mcp/other'), false);
  });
});

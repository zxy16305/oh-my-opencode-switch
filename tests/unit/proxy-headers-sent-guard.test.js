/**
 * Unit tests for writeHead guards in forwardRequest function.
 *
 * Tests the defensive checks added to prevent "write after end" errors:
 * 1. headersSent guard - skip writeHead if headers already sent
 * 2. socket.destroyed guard - skip writeHead if client socket is destroyed
 * 3. Error handler guards - safe handling when socket dies mid-response
 *
 * These are pure unit tests with mocked HTTP - no real connections.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

import { forwardRequest } from '../../src/proxy/server.js';

// ---------------------------------------------------------------------------
// Helper: Create mock client request
// ---------------------------------------------------------------------------
function createMockClientRequest(options = {}) {
  return {
    method: options.method || 'GET',
    url: options.url || '/test',
    headers: options.headers || {},
    socket: options.socket || { destroyed: options.socketDestroyed ?? false },
    pipe: mock.fn(),
    on: mock.fn((event, handler) => {
      // Store handlers for later invocation
      if (!options.handlers) options.handlers = {};
      options.handlers[event] = handler;
    }),
    destroy: mock.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helper: Create mock client response
// ---------------------------------------------------------------------------
function createMockClientResponse(options = {}) {
  const res = {
    headersSent: options.headersSent ?? false,
    socket: options.socket ?? { destroyed: options.socketDestroyed ?? false },
    writeHead: mock.fn(),
    end: mock.fn(),
    on: mock.fn(),
  };
  return res;
}

// ---------------------------------------------------------------------------
// Helper: Create mock proxy request
// ---------------------------------------------------------------------------
function createMockProxyRequest() {
  const handlers = {};
  return {
    on: mock.fn((event, handler) => {
      handlers[event] = handler;
    }),
    write: mock.fn(),
    end: mock.fn(),
    destroy: mock.fn(),
    _handlers: handlers,
  };
}

// ---------------------------------------------------------------------------
// Helper: Create mock proxy response
// ---------------------------------------------------------------------------
function createMockProxyResponse(options = {}) {
  const handlers = {};
  return {
    statusCode: options.statusCode || 200,
    headers: options.headers || { 'content-type': 'application/json' },
    pipe: mock.fn(),
    resume: mock.fn(),
    on: mock.fn((event, handler) => {
      handlers[event] = handler;
    }),
    _handlers: handlers,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('forwardRequest - writeHead Guards', () => {
  let originalHttpRequest;
  let originalHttpsRequest;

  beforeEach(() => {
    // Save originals
    originalHttpRequest = http.request;
    originalHttpsRequest = https.request;
  });

  afterEach(() => {
    // Restore originals
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  });

  // ---------------------------------------------------------------------------
  // Test 1: headersSent = true - Should NOT call writeHead
  // ---------------------------------------------------------------------------
  it('should NOT call writeHead when headers already sent', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse({ headersSent: true });

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Simulate upstream response - trigger the callback
    const mockProxyRes = createMockProxyResponse();
    const requestCallback = http.request.mock.calls[0].arguments[1];
    requestCallback(mockProxyRes);

    // writeHead should NOT be called because headersSent = true
    assert.equal(
      clientRes.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called when headers already sent'
    );

    // Response should be drained
    assert.equal(
      mockProxyRes.resume.mock.callCount(),
      1,
      'proxyRes.resume() should be called to drain'
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: socket.destroyed = true - Should NOT call writeHead
  // ---------------------------------------------------------------------------
  it('should NOT call writeHead when client socket is destroyed', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse({ socketDestroyed: true });

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Simulate upstream response
    const mockProxyRes = createMockProxyResponse();
    const requestCallback = http.request.mock.calls[0].arguments[1];
    requestCallback(mockProxyRes);

    // writeHead should NOT be called because socket is destroyed
    assert.equal(
      clientRes.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called when socket is destroyed'
    );

    // Response should be drained
    assert.equal(
      mockProxyRes.resume.mock.callCount(),
      1,
      'proxyRes.resume() should be called to drain'
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: Normal flow - writeHead SHOULD be called
  // ---------------------------------------------------------------------------
  it('should call writeHead when guards pass (normal flow)', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse();

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Simulate upstream response
    const mockProxyRes = createMockProxyResponse({ statusCode: 201 });
    const requestCallback = http.request.mock.calls[0].arguments[1];
    requestCallback(mockProxyRes);

    // writeHead SHOULD be called in normal flow
    assert.equal(
      clientRes.writeHead.mock.callCount(),
      1,
      'writeHead should be called in normal flow'
    );
    assert.equal(
      clientRes.writeHead.mock.calls[0].arguments[0],
      201,
      'writeHead should be called with correct status code'
    );

    // Response should be piped
    assert.equal(mockProxyRes.pipe.mock.callCount(), 1, 'proxyRes should be piped to clientRes');
  });

  // ---------------------------------------------------------------------------
  // Test 4: proxyRes error in normal flow - error handler registered
  // ---------------------------------------------------------------------------
  it('should register proxyRes error handler and handle errors in normal flow', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse();

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    const mockProxyRes = createMockProxyResponse();
    const requestCallback = http.request.mock.calls[0].arguments[1];
    requestCallback(mockProxyRes);

    const errorHandler = mockProxyRes._handlers['error'];
    assert.ok(errorHandler, 'proxyRes should have error handler in normal flow');

    // writeHead was already called by normal flow
    assert.equal(clientRes.writeHead.mock.callCount(), 1);

    // Trigger error - should call clientRes.end() since headersSent is now true
    assert.doesNotThrow(() => {
      errorHandler(new Error('Upstream stream error'));
    });

    // Since headers were already sent (writeHead called), error handler calls end()
    assert.equal(clientRes.end.mock.callCount(), 1, 'end() should be called after error');
  });

  // ---------------------------------------------------------------------------
  // Test 5: proxyRes error when socket destroyed mid-stream
  // ---------------------------------------------------------------------------
  it('should call end() when proxyRes errors after socket destroyed', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse();

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    const mockProxyRes = createMockProxyResponse();
    const requestCallback = http.request.mock.calls[0].arguments[1];
    requestCallback(mockProxyRes);

    // Normal flow sets writeHead
    assert.equal(clientRes.writeHead.mock.callCount(), 1);

    // Now destroy the socket mid-stream
    clientRes.socket.destroyed = true;

    const errorHandler = mockProxyRes._handlers['error'];
    assert.ok(errorHandler, 'proxyRes should have error handler');

    assert.doesNotThrow(() => {
      errorHandler(new Error('Upstream stream error'));
    });

    assert.equal(
      clientRes.end.mock.callCount(),
      1,
      'end() should be called after error with destroyed socket'
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: proxyReq error - Should check headersSent guard
  // ---------------------------------------------------------------------------
  it('should handle proxyReq error with headersSent guard', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse({ headersSent: true });

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Trigger error on proxyReq (connection failure)
    const errorHandler = mockProxyReq._handlers['error'];
    assert.ok(errorHandler, 'proxyReq should have error handler');

    // This should NOT throw
    assert.doesNotThrow(() => {
      errorHandler(new Error('Connection refused'));
    }, 'proxyReq error handler should not throw when headers already sent');

    // writeHead should NOT be called because headersSent = true
    assert.equal(
      clientRes.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called in proxyReq error handler when headers sent'
    );

    // end() should be called
    assert.equal(clientRes.end.mock.callCount(), 1, 'clientRes.end() should be called');
  });

  // ---------------------------------------------------------------------------
  // Test 7: proxyReq error - Should send 502 when guards pass
  // ---------------------------------------------------------------------------
  it('should send 502 on proxyReq error when guards pass', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse();

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Trigger error on proxyReq
    const errorHandler = mockProxyReq._handlers['error'];
    errorHandler(new Error('Connection refused'));

    assert.equal(
      clientRes.writeHead.mock.callCount(),
      1,
      'writeHead should be called via sendError when guards pass'
    );
    assert.equal(clientRes.writeHead.mock.calls[0].arguments[0], 502, 'Status code should be 502');
  });

  // ---------------------------------------------------------------------------
  // Test 8: clientReq error with destroyed socket - Should NOT crash
  // ---------------------------------------------------------------------------
  it('should handle clientReq error gracefully when socket is destroyed', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse({ socketDestroyed: true });

    const mockProxyReq = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'http://localhost:8001/test');

    // Get the clientReq error handler (registered via clientReq.on('error', ...))
    const clientReqOnCalls = clientReq.on.mock.calls;
    const errorHandlerCall = clientReqOnCalls.find((call) => call.arguments[0] === 'error');
    assert.ok(errorHandlerCall, 'clientReq should have error handler');

    const errorHandler = errorHandlerCall.arguments[1];

    // This should NOT throw
    assert.doesNotThrow(() => {
      errorHandler(new Error('Client disconnected'));
    }, 'clientReq error handler should not throw when socket is destroyed');

    // writeHead should NOT be called
    assert.equal(
      clientRes.writeHead.mock.callCount(),
      0,
      'writeHead should NOT be called in clientReq error handler when socket destroyed'
    );

    // proxyReq should be destroyed
    assert.equal(mockProxyReq.destroy.mock.callCount(), 1, 'proxyReq should be destroyed');
  });

  // ---------------------------------------------------------------------------
  // Test 9: Combined guard - headersSent OR socket.destroyed
  // ---------------------------------------------------------------------------
  it('should guard with headersSent=true OR socket.destroyed=true (both conditions)', () => {
    // Test: headersSent = true, socket.destroyed = false
    const clientRes1 = createMockClientResponse({ headersSent: true, socketDestroyed: false });
    const clientReq1 = createMockClientRequest();
    const mockProxyReq1 = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq1);

    forwardRequest(clientReq1, clientRes1, 'http://localhost:8001/test');
    const requestCallback1 = http.request.mock.calls[0].arguments[1];
    requestCallback1(createMockProxyResponse());

    assert.equal(
      clientRes1.writeHead.mock.callCount(),
      0,
      'writeHead NOT called with headersSent=true'
    );

    // Test: headersSent = false, socket.destroyed = true
    http.request = originalHttpRequest;
    const clientRes2 = createMockClientResponse({ headersSent: false, socketDestroyed: true });
    const clientReq2 = createMockClientRequest();
    const mockProxyReq2 = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq2);

    forwardRequest(clientReq2, clientRes2, 'http://localhost:8001/test');
    const requestCallback2 = http.request.mock.calls[0].arguments[1];
    requestCallback2(createMockProxyResponse());

    assert.equal(
      clientRes2.writeHead.mock.callCount(),
      0,
      'writeHead NOT called with socket.destroyed=true'
    );

    // Test: both true
    http.request = originalHttpRequest;
    const clientRes3 = createMockClientResponse({ headersSent: true, socketDestroyed: true });
    const clientReq3 = createMockClientRequest();
    const mockProxyReq3 = createMockProxyRequest();
    http.request = mock.fn(() => mockProxyReq3);

    forwardRequest(clientReq3, clientRes3, 'http://localhost:8001/test');
    const requestCallback3 = http.request.mock.calls[0].arguments[1];
    requestCallback3(createMockProxyResponse());

    assert.equal(
      clientRes3.writeHead.mock.callCount(),
      0,
      'writeHead NOT called with both guards true'
    );
  });

  // ---------------------------------------------------------------------------
  // Test 10: HTTPS target uses https.request
  // ---------------------------------------------------------------------------
  it('should use https.request for HTTPS target URLs', () => {
    const clientReq = createMockClientRequest();
    const clientRes = createMockClientResponse();

    const mockProxyReq = createMockProxyRequest();
    https.request = mock.fn(() => mockProxyReq);

    forwardRequest(clientReq, clientRes, 'https://secure.example.com/test');

    // Should call https.request for https:// URL
    assert.equal(
      https.request.mock.callCount(),
      1,
      'https.request should be called for HTTPS target'
    );
  });
});

/**
 * Unit tests for proxy/protocol-detector module
 * @module tests/unit/protocol-detector.test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { detectProtocol } from '../../src/proxy/protocol-detector.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('detectProtocol()', () => {
  // -------------------------------------------------------------------------
  // Responses protocol detection
  // -------------------------------------------------------------------------

  test('/v1/responses → responses protocol', () => {
    const result = detectProtocol({ url: '/v1/responses' });
    assert.deepEqual(result, { protocol: 'responses', endpointPath: '/responses' });
  });

  test('/responses → responses protocol', () => {
    const result = detectProtocol({ url: '/responses' });
    assert.deepEqual(result, { protocol: 'responses', endpointPath: '/responses' });
  });

  test('/v1/responses?stream=true → responses protocol (ignores query)', () => {
    const result = detectProtocol({ url: '/v1/responses?stream=true' });
    assert.deepEqual(result, { protocol: 'responses', endpointPath: '/responses' });
  });

  test('/responses?model=gpt-5 → responses protocol (ignores query)', () => {
    const result = detectProtocol({ url: '/responses?model=gpt-5' });
    assert.deepEqual(result, { protocol: 'responses', endpointPath: '/responses' });
  });

  // -------------------------------------------------------------------------
  // Chat protocol (default)
  // -------------------------------------------------------------------------

  test('/v1/chat/completions → chat protocol', () => {
    const result = detectProtocol({ url: '/v1/chat/completions' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('/v1/chat/completions?stream=true → chat protocol', () => {
    const result = detectProtocol({ url: '/v1/chat/completions?stream=true' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('/any/other/path → chat protocol', () => {
    const result = detectProtocol({ url: '/any/other/path' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('/v1/models → chat protocol', () => {
    const result = detectProtocol({ url: '/v1/models' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  // -------------------------------------------------------------------------
  // Edge cases: NOT responses paths
  // -------------------------------------------------------------------------

  test('/v1/responses-extra → chat protocol (not exact match)', () => {
    const result = detectProtocol({ url: '/v1/responses-extra' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('/responses/123 → chat protocol (has trailing path)', () => {
    const result = detectProtocol({ url: '/responses/123' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('/v1/responses2 → chat protocol (not exact match)', () => {
    const result = detectProtocol({ url: '/v1/responses2' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  // -------------------------------------------------------------------------
  // Graceful fallback for missing/invalid request
  // -------------------------------------------------------------------------

  test('undefined req → chat protocol', () => {
    const result = detectProtocol(undefined);
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('null req → chat protocol', () => {
    const result = detectProtocol(null);
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('req with undefined url → chat protocol', () => {
    const result = detectProtocol({ url: undefined });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('req with null url → chat protocol', () => {
    const result = detectProtocol({ url: null });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('req with empty string url → chat protocol', () => {
    const result = detectProtocol({ url: '' });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });

  test('req with number url → chat protocol', () => {
    const result = detectProtocol({ url: 123 });
    assert.deepEqual(result, { protocol: 'chat', endpointPath: '/chat/completions' });
  });
});

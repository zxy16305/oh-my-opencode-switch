/**
 * Unit tests for proxy/endpoint-resolver module
 * @module tests/unit/endpoint-resolver.test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEndpoint } from '../../src/proxy/endpoint-resolver.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('resolveEndpoint()', () => {
  // -------------------------------------------------------------------------
  // GPT-5 with triggering params → /v1/responses
  // -------------------------------------------------------------------------

  test('gpt-5 + tools (non-empty) → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  test('gpt-5 + reasoning_effort → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5', { reasoning_effort: 'high' });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  test('gpt-5 + reasoning object → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5', { reasoning: { effort: 'medium' } });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  // -------------------------------------------------------------------------
  // GPT-5 without triggering params → /v1/chat/completions
  // -------------------------------------------------------------------------

  test('gpt-5 + empty tools array → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-5', { tools: [] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('gpt-5 without any params → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-5', {});
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  // -------------------------------------------------------------------------
  // GPT-5 variant models
  // -------------------------------------------------------------------------

  test('gpt-5.0 + tools → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5.0', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  test('gpt-5.1-preview + reasoning_effort → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5.1-preview', { reasoning_effort: 'low' });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  // -------------------------------------------------------------------------
  // Non-GPT-5 models → /v1/chat/completions
  // -------------------------------------------------------------------------

  test('gpt-4 → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-4', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('qwen-plus → /v1/chat/completions', () => {
    const result = resolveEndpoint('qwen-plus', { reasoning_effort: 'high' });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('glm-4 → /v1/chat/completions', () => {
    const result = resolveEndpoint('glm-4', { reasoning: { effort: 'high' } });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  // -------------------------------------------------------------------------
  // Edge cases: model name should NOT match
  // -------------------------------------------------------------------------

  test('gpt-5-tool (should NOT match) → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-5-tool', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('gpt-50 (should NOT match) → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-50', { reasoning_effort: 'high' });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  // -------------------------------------------------------------------------
  // Graceful fallback for null/undefined
  // -------------------------------------------------------------------------

  test('undefined requestBody → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-5', undefined);
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('null requestBody → /v1/chat/completions', () => {
    const result = resolveEndpoint('gpt-5', null);
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('undefined model → /v1/chat/completions', () => {
    const result = resolveEndpoint(undefined, { tools: [] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('null model → /v1/chat/completions', () => {
    const result = resolveEndpoint(null, { tools: [] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  test('gpt-5 with empty string model → /v1/chat/completions', () => {
    const result = resolveEndpoint('', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/chat/completions', needsTransform: false });
  });

  test('gpt-5. with trailing dot → /v1/responses (matches)', () => {
    const result = resolveEndpoint('gpt-5.', { tools: [{ type: 'function' }] });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });

  test('gpt-5 with multiple triggering params → /v1/responses', () => {
    const result = resolveEndpoint('gpt-5', {
      tools: [{ type: 'function' }],
      reasoning_effort: 'high',
      reasoning: { effort: 'medium' },
    });
    assert.deepEqual(result, { endpointPath: '/responses', needsTransform: true });
  });
});

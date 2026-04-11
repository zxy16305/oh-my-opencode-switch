/**
 * Unit tests for route validation — Zod validation at load time, not per-request.
 * @module tests/proxy/unit/route-validation.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateRoute,
  routeRequest,
  resetAllState,
  RouterError,
} from '../../../src/proxy/router.js';

import { makeUpstream, makeRoute, makeConfig } from '../../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('validateRoute()', () => {
  test('returns valid:true for well-formed route', () => {
    const route = makeRoute([makeUpstream({ id: 'u1' })]);
    const result = validateRoute(route);
    assert.equal(result.valid, true);
    assert.ok(result.data);
    assert.equal(result.data.strategy, 'sticky');
    assert.equal(result.error, undefined);
  });

  test('returns valid:true for missing strategy field (schema defaults to sticky)', () => {
    const route = {
      upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, true);
    assert.equal(result.data.strategy, 'sticky');
  });

  test('returns valid:false for empty upstreams array', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('upstream'));
  });

  test('returns valid:false for missing upstreams', () => {
    const route = {
      strategy: 'sticky',
    };
    const result = validateRoute(route);
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('returns valid:false for upstream with empty ID', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: '', provider: 'p', model: 'm', baseURL: 'http://x' }],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('returns valid:false for upstream with invalid baseURL', () => {
    const route = {
      strategy: 'sticky',
      upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'not-a-url' }],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('baseURL'));
  });

  test('returns valid:false for invalid strategy', () => {
    const route = {
      strategy: 'invalid-strategy',
      upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('strategy'));
  });

  test('returns valid:false for entirely empty input', () => {
    const result = validateRoute({});
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('returns valid:false for null input', () => {
    const result = validateRoute(null);
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('returns valid:false for undefined input', () => {
    const result = validateRoute(undefined);
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  test('valid route with multiple upstreams', () => {
    const route = makeRoute([
      makeUpstream({ id: 'u1' }),
      makeUpstream({ id: 'u2' }),
      makeUpstream({ id: 'u3' }),
    ]);
    const result = validateRoute(route);
    assert.equal(result.valid, true);
    assert.equal(result.data.upstreams.length, 3);
  });

  test('parses and applies default values', () => {
    const route = {
      upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
    };
    const result = validateRoute(route);
    assert.equal(result.valid, true);
    assert.equal(result.data.strategy, 'sticky');
    assert.equal(result.data.stickyReassignThreshold, 10);
    assert.equal(result.data.stickyReassignMinGap, 2);
  });
});

describe('routeRequest() — trusts pre-validated routes', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('routes valid config without Zod overhead', () => {
    const config = makeConfig(
      'gpt-4',
      [makeUpstream({ id: 'u1' }), makeUpstream({ id: 'u2' })],
      'sticky'
    );

    const req = { headers: { 'x-opencode-session': 'test-sess' }, method: 'POST', url: '/' };
    const result = routeRequest('gpt-4', config, req);
    assert.ok(['u1', 'u2'].includes(result.upstream.id));
    assert.equal(result.routeKey, 'gpt-4');
  });

  test('throws UNKNOWN_MODEL for missing model (not INVALID_ROUTE_CONFIG)', () => {
    const config = makeConfig('existing-model', [makeUpstream()]);
    assert.throws(
      () => routeRequest('unknown-model', config),
      (err) => err instanceof RouterError && err.code === 'UNKNOWN_MODEL'
    );
  });
});

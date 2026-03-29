/**
 * Unit tests for proxy/router module
 * @module tests/proxy/unit/router.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeRequest,
  getRouteForModel,
  getAvailableModels,
  selectUpstreamRoundRobin,
  selectUpstreamRandom,
  selectUpstreamWeighted,
  selectUpstreamSticky,
  getSessionId,
  validateRoutesConfig,
  hashSessionToBackend,
  failoverStickySession,
  resetRoundRobinCounters,
  getSessionMapSize,
  RouterError,
  upstreamSchema,
  routeSchema,
  routesConfigSchema,
} from '../../../src/proxy/router.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUpstream(overrides = {}) {
  return {
    id: overrides.id || 'u1',
    provider: overrides.provider || 'test-provider',
    model: overrides.model || 'test-model',
    baseURL: overrides.baseURL || 'http://localhost:8001',
    apiKey: overrides.apiKey || 'key-123',
    ...overrides,
  };
}

function makeRoute(upstreams, strategy = 'round-robin') {
  return { strategy, upstreams };
}

function makeConfig(routeKey = 'test-model', upstreams, strategy) {
  return { [routeKey]: makeRoute(upstreams || [makeUpstream()], strategy) };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Router – getRouteForModel()', () => {
  test('returns route for valid model', () => {
    const config = makeConfig('gpt-4', [makeUpstream({ id: 'u1' })]);
    const route = getRouteForModel('gpt-4', config);
    assert.ok(route);
    assert.equal(route.strategy, 'round-robin');
    assert.equal(route.upstreams.length, 1);
  });

  test('returns null for null model', () => {
    assert.equal(getRouteForModel(null, {}), null);
  });

  test('returns null for undefined model', () => {
    assert.equal(getRouteForModel(undefined, {}), null);
  });

  test('returns null for empty string model', () => {
    assert.equal(getRouteForModel('', {}), null);
  });

  test('returns null for non-string model (number)', () => {
    assert.equal(getRouteForModel(123, {}), null);
  });

  test('returns null for non-string model (boolean)', () => {
    assert.equal(getRouteForModel(true, {}), null);
  });

  test('returns null when config is null', () => {
    assert.equal(getRouteForModel('model', null), null);
  });

  test('returns null when config is undefined', () => {
    assert.equal(getRouteForModel('model', undefined), null);
  });

  test('returns null when config is a string', () => {
    assert.equal(getRouteForModel('model', 'bad'), null);
  });

  test('returns null when config is a number', () => {
    assert.equal(getRouteForModel('model', 42), null);
  });

  test('returns null when model does not exist in config', () => {
    const config = makeConfig('gpt-4');
    assert.equal(getRouteForModel('claude-3', config), null);
  });
});

describe('Router – selectUpstreamRoundRobin()', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('cycles through upstreams in order', () => {
    const upstreams = [
      makeUpstream({ id: 'a' }),
      makeUpstream({ id: 'b' }),
      makeUpstream({ id: 'c' }),
    ];

    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push(selectUpstreamRoundRobin(upstreams, 'route-1').id);
    }
    assert.deepEqual(ids, ['a', 'b', 'c', 'a', 'b', 'c']);
  });

  test('different route keys have independent counters', () => {
    const upstreams = [makeUpstream({ id: 'x' }), makeUpstream({ id: 'y' })];

    assert.equal(selectUpstreamRoundRobin(upstreams, 'route-A').id, 'x');
    assert.equal(selectUpstreamRoundRobin(upstreams, 'route-A').id, 'y');
    // route-B starts fresh
    assert.equal(selectUpstreamRoundRobin(upstreams, 'route-B').id, 'x');
  });

  test('returns single upstream when only one available', () => {
    const upstreams = [makeUpstream({ id: 'solo' })];
    const result = selectUpstreamRoundRobin(upstreams, 'route-1');
    assert.equal(result.id, 'solo');
  });

  test('throws RouterError for empty array', () => {
    assert.throws(
      () => selectUpstreamRoundRobin([], 'route-1'),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('throws RouterError for null upstreams', () => {
    assert.throws(
      () => selectUpstreamRoundRobin(null, 'route-1'),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('throws RouterError for undefined upstreams', () => {
    assert.throws(
      () => selectUpstreamRoundRobin(undefined, 'route-1'),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });
});

describe('Router – selectUpstreamRandom()', () => {
  test('returns one of the upstreams', () => {
    const upstreams = [
      makeUpstream({ id: 'r1' }),
      makeUpstream({ id: 'r2' }),
      makeUpstream({ id: 'r3' }),
    ];

    for (let i = 0; i < 50; i++) {
      const selected = selectUpstreamRandom(upstreams);
      assert.ok(['r1', 'r2', 'r3'].includes(selected.id));
    }
  });

  test('returns single upstream when only one available', () => {
    const upstreams = [makeUpstream({ id: 'only' })];
    assert.equal(selectUpstreamRandom(upstreams).id, 'only');
  });

  test('throws RouterError for empty array', () => {
    assert.throws(
      () => selectUpstreamRandom([]),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('throws RouterError for null', () => {
    assert.throws(
      () => selectUpstreamRandom(null),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('distributes across upstreams (statistical)', () => {
    const upstreams = [makeUpstream({ id: 'a' }), makeUpstream({ id: 'b' })];
    const counts = { a: 0, b: 0 };

    for (let i = 0; i < 1000; i++) {
      counts[selectUpstreamRandom(upstreams).id]++;
    }

    // Both should get at least 30% with 1000 samples
    assert.ok(counts.a > 300, `Expected a > 300, got ${counts.a}`);
    assert.ok(counts.b > 300, `Expected b > 300, got ${counts.b}`);
  });
});

describe('Router – selectUpstreamWeighted()', () => {
  test('returns one of the upstreams', () => {
    const upstreams = [
      makeUpstream({ id: 'w1', weight: 1 }),
      makeUpstream({ id: 'w2', weight: 2 }),
    ];

    for (let i = 0; i < 50; i++) {
      const selected = selectUpstreamWeighted(upstreams);
      assert.ok(['w1', 'w2'].includes(selected.id));
    }
  });

  test('returns single upstream when only one available', () => {
    const upstreams = [makeUpstream({ id: 'solo', weight: 5 })];
    assert.equal(selectUpstreamWeighted(upstreams).id, 'solo');
  });

  test('uses default weight of 1 when weight not specified', () => {
    const upstreams = [makeUpstream({ id: 'no-weight-1' }), makeUpstream({ id: 'no-weight-2' })];

    const counts = { 'no-weight-1': 0, 'no-weight-2': 0 };
    for (let i = 0; i < 1000; i++) {
      counts[selectUpstreamWeighted(upstreams).id]++;
    }

    // With equal default weights, both should get > 300
    assert.ok(counts['no-weight-1'] > 300);
    assert.ok(counts['no-weight-2'] > 300);
  });

  test('respects weights (statistical)', () => {
    const upstreams = [
      makeUpstream({ id: 'heavy', weight: 9 }),
      makeUpstream({ id: 'light', weight: 1 }),
    ];

    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 1000; i++) {
      counts[selectUpstreamWeighted(upstreams).id]++;
    }

    // heavy should get ~900, light ~100 — allow generous margin
    assert.ok(counts.heavy > 700, `Expected heavy > 700, got ${counts.heavy}`);
    assert.ok(counts.light < 400, `Expected light < 400, got ${counts.light}`);
  });

  test('throws RouterError for empty array', () => {
    assert.throws(
      () => selectUpstreamWeighted([]),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('throws RouterError for null', () => {
    assert.throws(
      () => selectUpstreamWeighted(null),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });
});

describe('Router – selectUpstreamSticky()', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('returns consistent upstream for same session', () => {
    const upstreams = [makeUpstream({ id: 'sa' }), makeUpstream({ id: 'sb' })];

    const first = selectUpstreamSticky(upstreams, 'route-1', 'session-xyz');
    const second = selectUpstreamSticky(upstreams, 'route-1', 'session-xyz');
    assert.equal(first.id, second.id);
  });

  test('returns single upstream when only one available', () => {
    const upstreams = [makeUpstream({ id: 'only' })];
    assert.equal(selectUpstreamSticky(upstreams, 'route-1', 'sess').id, 'only');
  });

  test('different sessions may map to different upstreams', () => {
    const upstreams = [makeUpstream({ id: 'p' }), makeUpstream({ id: 'q' })];

    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(selectUpstreamSticky(upstreams, 'route-1', `session-${i}`).id);
    }

    assert.ok(ids.size >= 1);
  });

  test('remaps session if previous upstream is gone', () => {
    const upstreams = [makeUpstream({ id: 'a' }), makeUpstream({ id: 'b' })];

    // First, establish a mapping
    selectUpstreamSticky(upstreams, 'route-1', 'sess-gone');

    // Now remove upstream 'a' from the list
    const newUpstreams = [makeUpstream({ id: 'b' })];
    const result = selectUpstreamSticky(newUpstreams, 'route-1', 'sess-gone');
    assert.equal(result.id, 'b');
  });

  test('different route keys for same session are scoped independently', () => {
    const upstreams = [makeUpstream({ id: 'x' }), makeUpstream({ id: 'y' })];

    // Map session to route-A
    selectUpstreamSticky(upstreams, 'route-A', 'sess-scope');
    // Same session on route-B should work independently
    const result = selectUpstreamSticky(upstreams, 'route-B', 'sess-scope');
    assert.ok(['x', 'y'].includes(result.id));
  });

  test('throws RouterError for empty upstreams', () => {
    assert.throws(
      () => selectUpstreamSticky([], 'route', 'sess'),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });

  test('throws RouterError for null upstreams', () => {
    assert.throws(
      () => selectUpstreamSticky(null, 'route', 'sess'),
      (err) => err instanceof RouterError && err.code === 'NO_UPSTREAMS'
    );
  });
});

describe('Router – failoverStickySession()', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('returns another upstream when failed one is excluded', () => {
    const upstreams = [makeUpstream({ id: 'fa' }), makeUpstream({ id: 'fb' })];

    // Establish sticky mapping
    selectUpstreamSticky(upstreams, 'route', 'sess-fail');

    const next = failoverStickySession('sess-fail', 'fa', upstreams, 'route');
    assert.ok(next);
    assert.equal(next.id, 'fb');
  });

  test('returns null when all upstreams have failed', () => {
    const upstreams = [makeUpstream({ id: 'only-one' })];
    const result = failoverStickySession('sess', 'only-one', upstreams, 'route');
    assert.equal(result, null);
  });

  test('returns null for empty upstreams', () => {
    assert.equal(failoverStickySession('sess', 'x', [], 'route'), null);
  });

  test('returns null for null upstreams', () => {
    assert.equal(failoverStickySession('sess', 'x', null, 'route'), null);
  });

  test('updates session map with new upstream', () => {
    const upstreams = [
      makeUpstream({ id: 'f1' }),
      makeUpstream({ id: 'f2' }),
      makeUpstream({ id: 'f3' }),
    ];

    // Establish sticky
    selectUpstreamSticky(upstreams, 'route', 'sess-fo');
    const sizeBefore = getSessionMapSize();

    const next = failoverStickySession('sess-fo', 'f1', upstreams, 'route');
    assert.ok(next);
    assert.notEqual(next.id, 'f1');

    // Map size should be the same (replaced, not added)
    assert.equal(getSessionMapSize(), sizeBefore);
  });
});

describe('Router – getSessionId()', () => {
  test('extracts from x-opencode-session header', () => {
    const req = {
      headers: { 'x-opencode-session': 'my-session' },
      method: 'POST',
      url: '/test',
      socket: { remoteAddress: '1.2.3.4' },
    };
    assert.equal(getSessionId(req), 'my-session');
  });

  test('extracts from x-session-affinity header (fallback)', () => {
    const req = {
      headers: { 'x-session-affinity': 'affinity-id' },
      method: 'POST',
      url: '/test',
      socket: { remoteAddress: '1.2.3.4' },
    };
    assert.equal(getSessionId(req), 'affinity-id');
  });

  test('x-opencode-session takes priority over x-session-affinity', () => {
    const req = {
      headers: {
        'x-opencode-session': 'primary',
        'x-session-affinity': 'secondary',
      },
      method: 'POST',
      url: '/test',
    };
    assert.equal(getSessionId(req), 'primary');
  });

  test('generates ID when no session headers present', () => {
    const req = {
      headers: {},
      method: 'GET',
      url: '/path',
      socket: { remoteAddress: '10.0.0.1' },
    };
    const id = getSessionId(req);
    assert.ok(id.startsWith('gen_'), `Expected "gen_" prefix, got "${id}"`);
  });

  test('generates ID uses x-forwarded-for if available', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.1' },
      method: 'POST',
      url: '/api',
    };
    const id = getSessionId(req);
    assert.ok(id.startsWith('gen_'));
  });

  test('handles request with null headers', () => {
    const req = { headers: null, method: 'GET', url: '/' };
    const id = getSessionId(req);
    assert.ok(typeof id === 'string');
    assert.ok(id.length > 0);
  });

  test('handles request with undefined headers', () => {
    const req = { method: 'GET', url: '/' };
    const id = getSessionId(req);
    assert.ok(typeof id === 'string');
  });

  test('ignores non-string x-opencode-session header', () => {
    const req = {
      headers: { 'x-opencode-session': ['array-val'] },
      method: 'POST',
      url: '/',
      socket: { remoteAddress: '127.0.0.1' },
    };
    // Should fall through to generation
    const id = getSessionId(req);
    assert.ok(id.startsWith('gen_'));
  });

  test('ignores empty string x-opencode-session header', () => {
    const req = {
      headers: { 'x-opencode-session': '' },
      method: 'POST',
      url: '/',
      socket: { remoteAddress: '127.0.0.1' },
    };
    // Empty string is falsy → fall through
    const id = getSessionId(req);
    assert.ok(id.startsWith('gen_'));
  });
});

describe('Router – hashSessionToBackend()', () => {
  test('returns deterministic index', () => {
    const idx1 = hashSessionToBackend('my-session', 5);
    const idx2 = hashSessionToBackend('my-session', 5);
    assert.equal(idx1, idx2);
  });

  test('returns index in range [0, backendCount)', () => {
    for (let i = 0; i < 100; i++) {
      const idx = hashSessionToBackend(`sess-${i}`, 10);
      assert.ok(idx >= 0 && idx < 10, `Index ${idx} out of range`);
    }
  });

  test('returns 0 for backendCount <= 0', () => {
    assert.equal(hashSessionToBackend('sess', 0), 0);
    assert.equal(hashSessionToBackend('sess', -1), 0);
  });

  test('different sessions produce different indices (statistical)', () => {
    const indices = new Set();
    for (let i = 0; i < 100; i++) {
      indices.add(hashSessionToBackend(`unique-sess-${i}`, 10));
    }
    // Should have spread across many indices
    assert.ok(indices.size > 1, 'Expected different sessions to hash to different backends');
  });
});

describe('Router – routeRequest()', () => {
  beforeEach(() => resetRoundRobinCounters());
  afterEach(() => resetRoundRobinCounters());

  test('routes to valid model with round-robin', () => {
    const config = makeConfig(
      'gpt-4',
      [makeUpstream({ id: 'u1' }), makeUpstream({ id: 'u2' })],
      'round-robin'
    );

    const result = routeRequest('gpt-4', config);
    assert.equal(result.upstream.id, 'u1');
    assert.equal(result.routeKey, 'gpt-4');
    assert.equal(result.route.strategy, 'round-robin');
  });

  test('routes with random strategy', () => {
    const config = makeConfig(
      'model-r',
      [makeUpstream({ id: 'r1' }), makeUpstream({ id: 'r2' })],
      'random'
    );

    const result = routeRequest('model-r', config);
    assert.ok(['r1', 'r2'].includes(result.upstream.id));
  });

  test('routes with weighted strategy', () => {
    const config = makeConfig(
      'model-w',
      [makeUpstream({ id: 'w1', weight: 1 }), makeUpstream({ id: 'w2', weight: 2 })],
      'weighted'
    );

    const result = routeRequest('model-w', config);
    assert.ok(['w1', 'w2'].includes(result.upstream.id));
  });

  test('routes with sticky strategy (includes sessionId)', () => {
    const config = makeConfig(
      'model-s',
      [makeUpstream({ id: 's1' }), makeUpstream({ id: 's2' })],
      'sticky'
    );

    const req = {
      headers: { 'x-opencode-session': 'sticky-sess' },
      method: 'POST',
      url: '/',
    };

    const result = routeRequest('model-s', config, req);
    assert.ok(result.sessionId, 'sticky route should include sessionId');
    assert.equal(result.sessionId, 'sticky-sess');
  });

  test('sticky without request generates auto sessionId', () => {
    const config = makeConfig('model-s', [makeUpstream({ id: 's1' })], 'sticky');

    const result = routeRequest('model-s', config, null);
    assert.ok(result.sessionId);
    assert.ok(result.sessionId.startsWith('auto_'));
  });

  test('throws RouterError for unknown model', () => {
    const config = makeConfig('existing-model');
    assert.throws(
      () => routeRequest('unknown-model', config),
      (err) => {
        assert.ok(err instanceof RouterError);
        assert.equal(err.code, 'UNKNOWN_MODEL');
        assert.ok(err.details.availableModels.includes('existing-model'));
        return true;
      }
    );
  });

  test('throws RouterError with available models in details', () => {
    const config = {
      'model-a': makeRoute([makeUpstream()]),
      'model-b': makeRoute([makeUpstream()]),
    };

    assert.throws(
      () => routeRequest('nope', config),
      (err) => {
        assert.deepEqual(err.details.availableModels.sort(), ['model-a', 'model-b']);
        return true;
      }
    );
  });

  test('throws RouterError for invalid route config (bad upstream)', () => {
    const config = {
      'bad-model': {
        strategy: 'round-robin',
        upstreams: [{ id: '', provider: '', model: '', baseURL: 'not-a-url' }],
      },
    };

    assert.throws(
      () => routeRequest('bad-model', config),
      (err) => {
        assert.ok(err instanceof RouterError);
        assert.equal(err.code, 'INVALID_ROUTE_CONFIG');
        assert.ok(err.details.errors.length > 0);
        return true;
      }
    );
  });

  test('round-robin cycles correctly through routeRequest', () => {
    const config = makeConfig(
      'cycle',
      [makeUpstream({ id: 'c1' }), makeUpstream({ id: 'c2' }), makeUpstream({ id: 'c3' })],
      'round-robin'
    );

    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push(routeRequest('cycle', config).upstream.id);
    }
    assert.deepEqual(ids, ['c1', 'c2', 'c3', 'c1', 'c2', 'c3']);
  });
});

describe('Router – validateRoutesConfig()', () => {
  test('valid config passes validation', () => {
    const config = {
      'gpt-4': {
        strategy: 'round-robin',
        upstreams: [
          { id: 'u1', provider: 'openai', model: 'gpt-4', baseURL: 'https://api.openai.com' },
        ],
      },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.ok(result.data['gpt-4']);
  });

  test('returns error for empty config', () => {
    const result = validateRoutesConfig({});
    assert.equal(result.success, true);
    assert.deepEqual(result.data, {});
  });

  test('returns error for null config', () => {
    const result = validateRoutesConfig(null);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  test('returns error for non-object config', () => {
    const result = validateRoutesConfig('bad');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  test('returns error for missing upstreams', () => {
    const config = {
      'gpt-4': { strategy: 'round-robin', upstreams: [] },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('upstreams'));
  });

  test('returns error for invalid strategy', () => {
    const config = {
      'gpt-4': {
        strategy: 'invalid-strategy',
        upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
      },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('strategy'));
  });

  test('returns error for upstream missing required fields', () => {
    const config = {
      'gpt-4': {
        strategy: 'round-robin',
        upstreams: [{ id: '' }],
      },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  test('returns error for invalid baseURL', () => {
    const config = {
      'gpt-4': {
        strategy: 'round-robin',
        upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'not-a-url' }],
      },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('baseURL'));
  });

  test('defaults strategy to round-robin when omitted', () => {
    const config = {
      'gpt-4': {
        upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
      },
    };

    const result = validateRoutesConfig(config);
    assert.equal(result.success, true);
    assert.equal(result.data['gpt-4'].strategy, 'round-robin');
  });
});

describe('Router – getAvailableModels()', () => {
  test('returns model names from config', () => {
    const config = {
      'gpt-4': makeRoute([makeUpstream()]),
      'claude-3': makeRoute([makeUpstream()]),
    };

    const models = getAvailableModels(config);
    assert.deepEqual(models.sort(), ['claude-3', 'gpt-4']);
  });

  test('returns empty array for null config', () => {
    assert.deepEqual(getAvailableModels(null), []);
  });

  test('returns empty array for undefined config', () => {
    assert.deepEqual(getAvailableModels(undefined), []);
  });

  test('returns empty array for non-object config', () => {
    assert.deepEqual(getAvailableModels('string'), []);
    assert.deepEqual(getAvailableModels(42), []);
  });

  test('returns empty array for empty config', () => {
    assert.deepEqual(getAvailableModels({}), []);
  });
});

describe('Router – RouterError', () => {
  test('has correct name', () => {
    const err = new RouterError('test', 'TEST_CODE');
    assert.equal(err.name, 'RouterError');
  });

  test('stores code', () => {
    const err = new RouterError('msg', 'MY_CODE');
    assert.equal(err.code, 'MY_CODE');
  });

  test('stores details', () => {
    const err = new RouterError('msg', 'CODE', { foo: 'bar' });
    assert.deepEqual(err.details, { foo: 'bar' });
  });

  test('defaults details to empty object', () => {
    const err = new RouterError('msg', 'CODE');
    assert.deepEqual(err.details, {});
  });

  test('is instanceof Error', () => {
    const err = new RouterError('msg', 'CODE');
    assert.ok(err instanceof Error);
  });
});

describe('Router – resetRoundRobinCounters()', () => {
  test('clears session map and counters', () => {
    const config = makeConfig(
      'reset-test',
      [makeUpstream({ id: 'a' }), makeUpstream({ id: 'b' })],
      'sticky'
    );

    const req = { headers: { 'x-opencode-session': 'sess' }, method: 'POST', url: '/' };
    routeRequest('reset-test', config, req);
    assert.ok(getSessionMapSize() > 0);

    resetRoundRobinCounters();
    assert.equal(getSessionMapSize(), 0);
  });
});

describe('Router – Zod schemas', () => {
  test('upstreamSchema validates correct upstream', () => {
    const result = upstreamSchema.safeParse({
      id: 'u1',
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'https://api.openai.com',
      apiKey: 'key-123',
    });
    assert.equal(result.success, true);
  });

  test('upstreamSchema rejects missing id', () => {
    const result = upstreamSchema.safeParse({
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'https://api.openai.com',
    });
    assert.equal(result.success, false);
  });

  test('upstreamSchema rejects invalid baseURL', () => {
    const result = upstreamSchema.safeParse({
      id: 'u1',
      provider: 'openai',
      model: 'gpt-4',
      baseURL: 'not-a-url',
    });
    assert.equal(result.success, false);
  });

  test('routeSchema validates with defaults', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.data.strategy, 'round-robin');
  });

  test('routesConfigSchema validates full config', () => {
    const result = routesConfigSchema.safeParse({
      'gpt-4': {
        strategy: 'weighted',
        upstreams: [{ id: 'u1', provider: 'p', model: 'm', baseURL: 'http://x', weight: 5 }],
      },
    });
    assert.equal(result.success, true);
  });
});

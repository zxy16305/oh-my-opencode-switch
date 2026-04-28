import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import {
  cleanRemovedUpstreamSessions,
  incrementSessionCount,
} from '../../../src/proxy/session-manager.js';

describe('cleanRemovedUpstreamSessions', () => {
  let sm;

  beforeEach(() => {
    sm = createStateManager();
  });

  afterEach(() => {
    sm.reset();
  });

  function addSession(sessionKey, upstreamId, routeKey) {
    sm.sessionMap.set(sessionKey, {
      upstreamId,
      routeKey,
      timestamp: Date.now(),
      requestCount: 1,
    });
    incrementSessionCount(sm, routeKey, upstreamId);
  }

  it('returns 0 when sessionMap is empty', () => {
    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-ali' }],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 0);
  });

  it('returns 0 when all sessions are bound to valid upstreams', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');
    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-ali' }],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 0);
    assert.strictEqual(sm.sessionMap.size, 1);
  });

  it('cleans sessions bound to removed upstreams', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');
    addSession('sess:2', 'up-baidu', 'lb-qwen');

    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-ali' }],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 1);
    assert.strictEqual(sm.sessionMap.size, 1);
    assert.ok(sm.sessionMap.has('sess:1'));
    assert.ok(!sm.sessionMap.has('sess:2'));
  });

  it('decrements upstreamSessionCounts correctly', () => {
    addSession('sess:1', 'up-baidu', 'lb-qwen');
    addSession('sess:2', 'up-baidu', 'lb-qwen');

    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-ali' }],
      },
    };
    cleanRemovedUpstreamSessions(routes, sm);

    const innerMap = sm.upstreamSessionCounts.get('lb-qwen');
    assert.ok(!innerMap || innerMap.get('up-baidu') === undefined);
  });

  it('handles multiple routes with mixed upstreams', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');
    addSession('sess:2', 'up-baidu', 'lb-qwen');
    addSession('sess:3', 'up-openai', 'lb-gpt');

    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-baidu' }],
      },
      'lb-gpt': {
        upstreams: [{ id: 'up-openai' }],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 1);
    assert.ok(!sm.sessionMap.has('sess:1'));
    assert.ok(sm.sessionMap.has('sess:2'));
    assert.ok(sm.sessionMap.has('sess:3'));
  });

  it('cleans all sessions when routes config is empty', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');
    addSession('sess:2', 'up-baidu', 'lb-qwen');

    const cleaned = cleanRemovedUpstreamSessions({}, sm);
    assert.strictEqual(cleaned, 2);
    assert.strictEqual(sm.sessionMap.size, 0);
    assert.strictEqual(sm.upstreamSessionCounts.size, 0);
  });

  it('handles routes with no upstreams array', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');

    const routes = {
      'lb-qwen': {},
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 1);
    assert.strictEqual(sm.sessionMap.size, 0);
  });

  it('handles routes with empty upstreams array', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');

    const routes = {
      'lb-qwen': {
        upstreams: [],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 1);
    assert.strictEqual(sm.sessionMap.size, 0);
  });

  it('cleans session when upstream is removed from its route even if present elsewhere', () => {
    addSession('sess:1', 'up-ali', 'lb-qwen');

    const routes = {
      'lb-qwen': {
        upstreams: [{ id: 'up-baidu' }],
      },
      'lb-model': {
        upstreams: [{ id: 'up-ali' }],
      },
    };
    const cleaned = cleanRemovedUpstreamSessions(routes, sm);
    assert.strictEqual(cleaned, 1);
    assert.ok(!sm.sessionMap.has('sess:1'));
  });
});

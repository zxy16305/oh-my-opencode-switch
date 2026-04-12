import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { getSessionCountsByRoute } from '../../../src/proxy/session-manager.js';

describe('getSessionCountsByRoute', () => {
  it('should count unique sessions (same sessionKey → count=1, NOT requestCount)', () => {
    const sm = createStateManager();
    sm.sessionMap.set('ses_abc:model-v1', {
      upstreamId: 'up-ali',
      routeKey: 'lb-qwen',
      timestamp: Date.now(),
    });
    sm.sessionMap.set('ses_abc:model-v1', {
      upstreamId: 'up-ali',
      routeKey: 'lb-qwen',
      timestamp: Date.now() + 1,
    });

    const result = getSessionCountsByRoute(sm);

    assert.ok(result.has('lb-qwen'), 'should have routeKey lb-qwen');
    const routeMap = result.get('lb-qwen');
    assert.strictEqual(routeMap.get('up-ali'), 1, 'should count as 1 unique session');
  });

  it('should count two sessions on same route and upstream as 2', () => {
    const sm = createStateManager();
    sm.sessionMap.set('ses_abc:model-v1', {
      upstreamId: 'up-ali',
      routeKey: 'lb-qwen',
      timestamp: Date.now(),
    });
    sm.sessionMap.set('ses_def:model-v1', {
      upstreamId: 'up-ali',
      routeKey: 'lb-qwen',
      timestamp: Date.now(),
    });

    const result = getSessionCountsByRoute(sm);

    assert.ok(result.has('lb-qwen'));
    const routeMap = result.get('lb-qwen');
    assert.strictEqual(routeMap.get('up-ali'), 2, 'should count 2 sessions on same upstream');
  });

  it('should count sessions on same route but different upstreams separately', () => {
    const sm = createStateManager();
    sm.sessionMap.set('ses_abc:model-v1', {
      upstreamId: 'up-ali',
      routeKey: 'lb-qwen',
      timestamp: Date.now(),
    });
    sm.sessionMap.set('ses_def:model-v2', {
      upstreamId: 'up-baidu',
      routeKey: 'lb-qwen',
      timestamp: Date.now(),
    });

    const result = getSessionCountsByRoute(sm);

    assert.ok(result.has('lb-qwen'));
    const routeMap = result.get('lb-qwen');
    assert.strictEqual(routeMap.get('up-ali'), 1, 'up-ali should have 1 session');
    assert.strictEqual(routeMap.get('up-baidu'), 1, 'up-baidu should have 1 session');
  });

  it('should return empty result for empty sessionMap', () => {
    const sm = createStateManager();

    const result = getSessionCountsByRoute(sm);

    assert.strictEqual(result.size, 0, 'result should be empty for empty sessionMap');
    assert.ok(!result.has('lb-qwen'), 'should not have any routeKey entries');
  });
});

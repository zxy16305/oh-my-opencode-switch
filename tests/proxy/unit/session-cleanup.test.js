import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import {
  incrementSessionCount,
  decrementSessionCount,
} from '../../../src/proxy/session-manager.js';

describe('decrementSessionCount cleanup', () => {
  let sm;

  beforeEach(() => {
    sm = createStateManager();
  });

  it('should delete zero-count entry from inner Map', () => {
    incrementSessionCount(sm, 'lb-qwen', 'up-ali');
    incrementSessionCount(sm, 'lb-qwen', 'up-baidu');

    decrementSessionCount(sm, 'lb-qwen', 'up-ali');

    const innerMap = sm.upstreamSessionCounts.get('lb-qwen');
    assert.strictEqual(
      innerMap.get('up-ali'),
      undefined,
      'upstreamId entry should be deleted when count reaches 0'
    );
    assert.strictEqual(innerMap.get('up-baidu'), 1, 'other upstream entry should remain');
    assert.ok(
      sm.upstreamSessionCounts.has('lb-qwen'),
      'outer Map should still have routeKey when inner Map is not empty'
    );
  });

  it('should delete empty inner Map from outer Map', () => {
    incrementSessionCount(sm, 'lb-qwen', 'up-ali');
    decrementSessionCount(sm, 'lb-qwen', 'up-ali');

    assert.strictEqual(
      sm.upstreamSessionCounts.get('lb-qwen'),
      undefined,
      'routeKey entry should be deleted when inner Map becomes empty'
    );
    assert.strictEqual(sm.upstreamSessionCounts.size, 0, 'outer Map should be empty after cleanup');
  });

  it('should recreate entry correctly after full cleanup', () => {
    incrementSessionCount(sm, 'lb-qwen', 'up-ali');
    decrementSessionCount(sm, 'lb-qwen', 'up-ali');

    assert.strictEqual(
      sm.upstreamSessionCounts.get('lb-qwen'),
      undefined,
      'should be fully cleaned up'
    );

    incrementSessionCount(sm, 'lb-qwen', 'up-ali');

    const innerMap = sm.upstreamSessionCounts.get('lb-qwen');
    assert.ok(innerMap, 'inner Map should exist after re-increment');
    assert.strictEqual(
      innerMap.get('up-ali'),
      1,
      'entry should reappear with count 1 after re-increment'
    );
  });
});

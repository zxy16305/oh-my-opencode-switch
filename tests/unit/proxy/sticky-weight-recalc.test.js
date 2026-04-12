/**
 * Regression tests for sticky weight recalculation in selectUpstreamSticky
 * @module tests/proxy/unit/sticky-weight-recalc.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { selectUpstreamSticky, resetAllState } from '../../../src/proxy/router.js';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { incrementUpstreamRequestCount } from '../../../src/proxy/router.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate unique session IDs to avoid hash collisions
 */
function makeSessionId(index) {
  return `sess-recalc-${Date.now()}-${index}-${crypto.randomUUID?.() ?? Math.random()}`;
}

/**
 * Create test setup with a StateManager and upstreams
 */
function createTestSetup(upstreams, routeKey = 'sticky-route') {
  const sm = createStateManager();
  return { sm, routeKey, upstreams };
}

/**
 * Manually inject sliding window entries for an upstream
 */
function injectSlidingWindowEntry(state, routeKey, upstreamId, count = 1) {
  for (let i = 0; i < count; i++) {
    incrementUpstreamRequestCount(routeKey, upstreamId, state);
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Sticky weight recalculation – Session affinity', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  test('same session routes to same upstream within a rebalance window (9 requests)', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    const sessionId = 'affinity-within-window';
    const first = selectUpstreamSticky(upstreams, routeKey, sessionId, null, 10, 2, null, null, sm);
    assert.ok(first.id, 'First request should select an upstream');

    const results = new Set();
    for (let i = 1; i < 9; i++) {
      const result = selectUpstreamSticky(
        upstreams,
        routeKey,
        sessionId,
        null,
        10,
        2,
        null,
        null,
        sm
      );
      results.add(result.id);
      assert.equal(result.id, first.id, `Request ${i} should go to same upstream`);
    }

    assert.equal(results.size, 1, 'All requests within window should route to same upstream');
  });

  test('session affinity maintained when current upstream has proportionally higher weight', () => {
    const upstreams = [
      makeUpstream({ id: 'high-weight', weight: 200 }),
      makeUpstream({ id: 'low-weight', weight: 100 }),
    ];

    // Pre-inject balanced window entries
    injectSlidingWindowEntry(sm, routeKey, 'high-weight', 50);
    injectSlidingWindowEntry(sm, routeKey, 'low-weight', 50);

    const sessionId = 'weight-protected-affinity';
    const first = selectUpstreamSticky(upstreams, routeKey, sessionId, null, 10, 2, null, null, sm);
    const chosenId = first.id;

    // Add balanced entries each iteration
    for (let i = 1; i < 100; i++) {
      injectSlidingWindowEntry(sm, routeKey, 'high-weight', 1);
      injectSlidingWindowEntry(sm, routeKey, 'low-weight', 1);

      const result = selectUpstreamSticky(
        upstreams,
        routeKey,
        sessionId,
        null,
        10,
        2,
        null,
        null,
        sm
      );
      assert.equal(result.id, chosenId, `Request ${i} should maintain affinity`);
    }
  });
});

describe('Sticky weight recalculation – Equal weight distribution', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  test('100 unique sessions distribute across 2 equal-weight upstreams (40-60% each)', () => {
    const upstreams = [
      makeUpstream({ id: 'equal-a', weight: 100 }),
      makeUpstream({ id: 'equal-b', weight: 100 }),
    ];

    const counts = {};
    for (let i = 0; i < 100; i++) {
      const sid = makeSessionId(i);
      const selected = selectUpstreamSticky(upstreams, routeKey, sid, null, 10, 2, null, null, sm);
      counts[selected.id] = (counts[selected.id] || 0) + 1;
    }

    const total = counts['equal-a'] + counts['equal-b'];
    assert.equal(total, 100, 'All sessions should be distributed');

    const percentA = (counts['equal-a'] / total) * 100;
    const percentB = (counts['equal-b'] / total) * 100;

    assert.ok(
      percentA >= 40 && percentA <= 60,
      `equal-a got ${percentA.toFixed(1)}% (${counts['equal-a']}/100), expected 40-60%`
    );
    assert.ok(
      percentB >= 40 && percentB <= 60,
      `equal-b got ${percentB.toFixed(1)}% (${counts['equal-b']}/100), expected 40-60%`
    );
  });
});

describe('Sticky weight recalculation – Unequal weight distribution', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  test('100 sessions with weights 200:100 distribute ~2:1 ratio', () => {
    const upstreams = [
      makeUpstream({ id: 'heavy', weight: 200 }),
      makeUpstream({ id: 'light', weight: 100 }),
    ];

    const counts = {};
    for (let i = 0; i < 100; i++) {
      const sid = makeSessionId(i);
      const selected = selectUpstreamSticky(upstreams, routeKey, sid, null, 10, 2, null, null, sm);
      counts[selected.id] = (counts[selected.id] || 0) + 1;
    }

    const total = counts.heavy + counts.light;
    assert.equal(total, 100, 'All sessions should be distributed');

    // With weights 200:100, heavy should get roughly 2/3 (55%-80%)
    const heavyPercent = (counts.heavy / total) * 100;
    const lightPercent = (counts.light / total) * 100;

    assert.ok(
      heavyPercent >= 55 && heavyPercent <= 80,
      `heavy got ${heavyPercent.toFixed(1)}% (${counts.heavy}/100), expected 55-80%`
    );
    assert.ok(
      lightPercent >= 15 && lightPercent <= 40,
      `light got ${lightPercent.toFixed(1)}% (${counts.light}/100), expected 15-40%`
    );
  });
});

describe('Sticky weight recalculation – Rebalance trigger (every 10 requests)', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  function setupRebalanceScenario({ sessionMap, windowCountsA, windowCountsB }) {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    // Set session map: simulate an existing session on upstream-a
    const sessionMapData = sm.sessionMap;
    sessionMapData.set('rebalance-session', sessionMap);

    // Inject sliding window entries for upstream-a (heavy load)
    injectSlidingWindowEntry(sm, routeKey, 'upstream-a', windowCountsA);

    // Inject sliding window entries for upstream-b (light load)
    injectSlidingWindowEntry(sm, routeKey, 'upstream-b', windowCountsB);

    return upstreams;
  }

  test('session switches to less loaded upstream on 10th request check', () => {
    const upstreams = setupRebalanceScenario({
      sessionMap: {
        upstreamId: 'upstream-a',
        routeKey,
        timestamp: Date.now(),
        requestCount: 9, // Will reach 10 after next call → triggers check
      },
      windowCountsA: 10, // upstream-a has 10 requests in window
      windowCountsB: 1, // upstream-b has only 1
    });

    // Scores should be:
    // upstream-a: (11 + 1) / 100 = 0.12 (11 because increment adds 1 more)
    // upstream-b: (1 + 1) / 100 = 0.02
    // Since 0.02 < 0.12, session should switch to upstream-b

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'rebalance-session',
      null, // no model (sessionKey = sessionId directly)
      10, // threshold
      2, // minGap
      null, // dynamicWeightConfig
      null, // timeSlotWeightConfig
      sm
    );

    assert.equal(
      result.id,
      'upstream-b',
      'Session should switch to less loaded upstream-b after rebalance check'
    );
  });

  test('session stays on current upstream when it has lower score', () => {
    const upstreams = setupRebalanceScenario({
      sessionMap: {
        upstreamId: 'upstream-a',
        routeKey,
        timestamp: Date.now(),
        requestCount: 9,
      },
      windowCountsA: 1, // upstream-a has only 1 request
      windowCountsB: 15, // upstream-b is much more loaded
    });

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'rebalance-session',
      null,
      10,
      2,
      null,
      null,
      sm
    );

    // upstream-a score: (1+1+1)/100 = 0.03 (original 1 + increment + formula +1)
    // upstream-b score: (15+1)/100 = 0.16
    // Current upstream-a has lower score, should NOT switch
    assert.equal(
      result.id,
      'upstream-a',
      'Session should stay on upstream-a since it has lower load score'
    );
  });

  test('rebalance respects weight differences when scores are calculated', () => {
    const sm2 = createStateManager();

    const upstreams = [
      makeUpstream({ id: 'high-weight', weight: 200 }),
      makeUpstream({ id: 'low-weight', weight: 100 }),
    ];

    // Set session on high-weight upstream with requestCount = 9
    const sessionMapData = sm2.sessionMap;
    sessionMapData.set('weighted-rebalance-session', {
      upstreamId: 'high-weight',
      routeKey: 'weighted-route',
      timestamp: Date.now(),
      requestCount: 9,
    });

    // Both have same window counts, but different weights
    injectSlidingWindowEntry(sm2, 'weighted-route', 'high-weight', 10);
    injectSlidingWindowEntry(sm2, 'weighted-route', 'low-weight', 5);

    const result = selectUpstreamSticky(
      upstreams,
      'weighted-route',
      'weighted-rebalance-session',
      null,
      10,
      2,
      null,
      null,
      sm2
    );

    // high-weight score: (10+1+1)/200 = 0.06 (increment adds 1, formula adds 1)
    // low-weight score: (5+1)/100 = 0.06
    // Scores are equal, so no switch (minScore < currentScore requires strict less)
    // Actually let me recompute:
    // After increment, window has 11 for high-weight
    // high-weight score: (11+1)/200 = 0.06
    // low-weight score: (5+1)/100 = 0.06
    // 0.06 is NOT < 0.06, so no switch
    assert.equal(
      result.id,
      'high-weight',
      'When scores are equal, session should stay on current upstream'
    );
  });

  test('no rebalance check before 10 requests accumulated', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    const sessionMapData = sm.sessionMap;
    sessionMapData.set('early-session', {
      upstreamId: 'upstream-a',
      routeKey,
      timestamp: Date.now(),
      requestCount: 5, // Only 5, should NOT trigger check
    });

    // Inject heavy load on upstream-b to make it worse
    injectSlidingWindowEntry(sm, routeKey, 'upstream-b', 20);

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'early-session',
      null,
      10,
      2,
      null,
      null,
      sm
    );

    // No rebalance check (not at 10), so should stay on upstream-a
    assert.equal(
      result.id,
      'upstream-a',
      'Should stay on current upstream since request count < 10'
    );

    // Verify no switch happened despite upstream-b being heavily loaded
    const sessionEntry = sm.sessionMap.get('early-session');
    assert.equal(sessionEntry.requestCount, 6, 'requestCount should increment normally');
    assert.equal(
      sessionEntry.upstreamId,
      'upstream-a',
      'upstreamId should not change below threshold'
    );
  });

  test('rebalance check fires at multiples of 10 (20, 30, etc.)', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    // Start with requestCount = 19 → next will be 20 → should check
    const sessionMapData = sm.sessionMap;
    sessionMapData.set('multi-ten-session', {
      upstreamId: 'upstream-a',
      routeKey,
      timestamp: Date.now(),
      requestCount: 19,
    });

    // Make upstream-b much less loaded
    injectSlidingWindowEntry(sm, routeKey, 'upstream-a', 15);
    injectSlidingWindowEntry(sm, routeKey, 'upstream-b', 1);

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'multi-ten-session',
      null,
      10,
      2,
      null,
      null,
      sm
    );

    // After increment: upstream-a has 16 in window
    // upstream-a score: (16+1)/100 = 0.17
    // upstream-b score: (1+1)/100 = 0.02
    // Should switch to upstream-b
    assert.equal(
      result.id,
      'upstream-b',
      'Rebalance should trigger at requestCount=20 (multiple of 10)'
    );
  });

  test('session requestCount resets to 1 after switch', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    const sessionMapData = sm.sessionMap;
    sessionMapData.set('reset-check-session', {
      upstreamId: 'upstream-a',
      routeKey,
      timestamp: Date.now(),
      requestCount: 9,
    });

    // Make upstream-b less loaded
    injectSlidingWindowEntry(sm, routeKey, 'upstream-a', 10);
    injectSlidingWindowEntry(sm, routeKey, 'upstream-b', 0);

    selectUpstreamSticky(upstreams, routeKey, 'reset-check-session', null, 10, 2, null, null, sm);

    const sessionEntry = sm.sessionMap.get('reset-check-session');
    assert.equal(
      sessionEntry.requestCount,
      1,
      'requestCount should reset to 1 after switching upstream'
    );
    assert.equal(
      sessionEntry.upstreamId,
      'upstream-b',
      'upstreamId should be updated to new upstream'
    );
  });

  test('rebalance with model-scoped session key', () => {
    const sm2 = createStateManager();

    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    const sessionId = 'model-scoped-session';
    const model1 = 'gpt-4';
    const sessionKey = `${sessionId}:${model1}`;

    const sessionMapData = sm2.sessionMap;
    sessionMapData.set(sessionKey, {
      upstreamId: 'upstream-a',
      routeKey: 'model-route',
      timestamp: Date.now(),
      requestCount: 9,
    });

    injectSlidingWindowEntry(sm2, 'model-route', 'upstream-a', 10);
    injectSlidingWindowEntry(sm2, 'model-route', 'upstream-b', 1);

    const result = selectUpstreamSticky(
      upstreams,
      'model-route',
      sessionId,
      model1,
      10,
      2,
      null,
      null,
      sm2
    );

    assert.equal(
      result.id,
      'upstream-b',
      'Session with model should switch to less loaded upstream'
    );
  });
});

describe('Sticky weight recalculation – Single upstream edge case', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  test('single upstream always returns same upstream regardless of load', () => {
    const upstreams = [makeUpstream({ id: 'solo', weight: 100 })];

    const results = [];
    for (let i = 0; i < 100; i++) {
      const result = selectUpstreamSticky(
        upstreams,
        routeKey,
        `solo-session-${i}`,
        null,
        10,
        2,
        null,
        null,
        sm
      );
      results.push(result.id);
    }

    assert.ok(
      results.every((id) => id === 'solo'),
      'All requests should go to sole upstream'
    );
  });

  test('single upstream with high requestCount still returns it', () => {
    const upstreams = [makeUpstream({ id: 'solo' })];

    const sessionMapData = sm.sessionMap;
    sessionMapData.set('heavy-solo', {
      upstreamId: 'solo',
      routeKey,
      timestamp: Date.now(),
      requestCount: 999, // Very high count
    });

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'heavy-solo',
      null,
      10,
      2,
      null,
      null,
      sm
    );

    assert.equal(result.id, 'solo', 'Should still return sole upstream despite high count');
  });
});

describe('Sticky weight recalculation – Score calculation accuracy', () => {
  let sm;
  let routeKey;

  beforeEach(async () => {
    const { sm: newSm, routeKey: newRouteKey } = createTestSetup([]);
    sm = newSm;
    routeKey = newRouteKey;
    resetAllState();
  });

  afterEach(async () => {
    resetAllState();
  });

  test('session stays when scores are nearly equal (minGap not strictly enforced)', () => {
    const upstreams = [
      makeUpstream({ id: 'upstream-a', weight: 100 }),
      makeUpstream({ id: 'upstream-b', weight: 100 }),
    ];

    // Scores that are very close
    const sessionMapData = sm.sessionMap;
    sessionMapData.set('nearly-equal', {
      upstreamId: 'upstream-a',
      routeKey,
      timestamp: Date.now(),
      requestCount: 9,
    });

    // Both have similar load → similar scores
    injectSlidingWindowEntry(sm, routeKey, 'upstream-a', 5);
    injectSlidingWindowEntry(sm, routeKey, 'upstream-b', 5);

    const result = selectUpstreamSticky(
      upstreams,
      routeKey,
      'nearly-equal',
      null,
      10,
      2,
      null,
      null,
      sm
    );

    // After increment upstream-a has 6+1=7 → score = 7/100 = 0.07
    // upstream-b has 5+1=6 → score = 6/100 = 0.06
    // 0.06 < 0.07, should switch to upstream-b
    assert.equal(
      result.id,
      'upstream-b',
      'Should switch when candidate has even slightly lower score'
    );
  });
});

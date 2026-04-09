/**
 * Integration tests for weight recovery via consecutive success count.
 *
 * Verifies the complete end-to-end flow:
 * - Error causes weight reduction → consecutive successes trigger recovery
 * - Failure mid-recovery resets count → fresh 5 successes needed
 * - Independent counting per route/upstream
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetAllState,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForError,
  recordUpstreamError,
  incrementUpstreamRequestCount,
  resetSuccessCount,
  adjustWeightForSuccess,
  getCurrentWeightLevel,
  getDynamicWeightState,
} from '../../src/proxy/router.js';

import { makeUpstream, makeDynamicWeightConfig as makeConfig } from '../helpers/proxy-fixtures.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Integration – Weight Recovery via Consecutive Success', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  // 1. Full recovery path: error → weight reduced → 5 successes → weight recovers one level

  test('full recovery path: error reduces weight, 5 successes recover one level', () => {
    const upstreams = [makeUpstream({ id: 'target' })];
    const config = makeConfig();
    const configuredWeight = 100;

    incrementUpstreamRequestCount('route1', 'target');
    recordUpstreamError('route1', 'target', 429);
    const errorData = new Map([['target', [429]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    const reducedWeight = getDynamicWeight('route1', 'target', configuredWeight);
    assert.strictEqual(reducedWeight, 10);
    // 10/100 = 10% → 'medium' level (≤35% threshold)
    assert.strictEqual(getCurrentWeightLevel('route1', 'target', configuredWeight), 'medium');

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }

    // medium → half: 10% recovers to 50%
    const recoveredWeight = getDynamicWeight('route1', 'target', configuredWeight);
    assert.strictEqual(recoveredWeight, configuredWeight * 0.5);
    assert.strictEqual(getCurrentWeightLevel('route1', 'target', configuredWeight), 'half');

    const state = getDynamicWeightState('route1', 'target');
    assert.strictEqual(state?.consecutiveSuccessCount, 0);
  });

  // 2. Reset scenario: 3 successes → failure → count resets → 5 more successes → recovery

  test('failure resets success count, requiring fresh 5 successes for recovery', () => {
    const upstreams = [makeUpstream({ id: 'target' })];
    const config = makeConfig();
    const configuredWeight = 100;

    incrementUpstreamRequestCount('route1', 'target');
    recordUpstreamError('route1', 'target', 429);
    const errorData = new Map([['target', [429]]]);
    adjustWeightForError('route1', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('route1', 'target', configuredWeight), 10);

    for (let i = 0; i < 3; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }

    assert.strictEqual(
      getDynamicWeight('route1', 'target', configuredWeight),
      10,
      '3 successes should not trigger recovery'
    );

    resetSuccessCount('route1', 'target');

    const stateAfterReset = getDynamicWeightState('route1', 'target');
    assert.strictEqual(stateAfterReset?.consecutiveSuccessCount, 0);

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }

    // medium → half: fresh 5 successes recover from 10 to 50
    const recoveredWeight = getDynamicWeight('route1', 'target', configuredWeight);
    assert.strictEqual(recoveredWeight, configuredWeight * 0.5);
    assert.strictEqual(getCurrentWeightLevel('route1', 'target', configuredWeight), 'half');
  });

  // 3. Independent per-route counting

  test('success counting is independent per route', () => {
    const upstreams = [makeUpstream({ id: 'shared' })];
    const config = makeConfig();
    const configuredWeight = 100;

    for (const route of ['routeA', 'routeB']) {
      incrementUpstreamRequestCount(route, 'shared');
      recordUpstreamError(route, 'shared', 429);
      const errorData = new Map([['shared', [429]]]);
      adjustWeightForError(route, upstreams, config, errorData);
    }

    assert.strictEqual(getDynamicWeight('routeA', 'shared', configuredWeight), 10);
    assert.strictEqual(getDynamicWeight('routeB', 'shared', configuredWeight), 10);

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('routeA', 'shared', configuredWeight);
    }

    assert.strictEqual(
      getDynamicWeight('routeA', 'shared', configuredWeight),
      configuredWeight * 0.5,
      'RouteA should recover after 5 successes'
    );
    assert.strictEqual(
      getDynamicWeight('routeB', 'shared', configuredWeight),
      10,
      'RouteB should stay reduced'
    );

    assert.strictEqual(getCurrentWeightLevel('routeA', 'shared', configuredWeight), 'half');
    assert.strictEqual(getCurrentWeightLevel('routeB', 'shared', configuredWeight), 'medium');
  });

  // 4. Independent per-upstream within same route

  test('success counting is independent per upstream within same route', () => {
    const upstreams = [makeUpstream({ id: 'upstream-1' }), makeUpstream({ id: 'upstream-2' })];
    const config = makeConfig();
    const configuredWeight = 100;

    incrementUpstreamRequestCount('route1', 'upstream-1');
    incrementUpstreamRequestCount('route1', 'upstream-2');
    recordUpstreamError('route1', 'upstream-1', 429);
    recordUpstreamError('route1', 'upstream-2', 429);
    const errorData = new Map([
      ['upstream-1', [429]],
      ['upstream-2', [429]],
    ]);
    adjustWeightForError('route1', upstreams, config, errorData);

    assert.strictEqual(getDynamicWeight('route1', 'upstream-1', configuredWeight), 10);
    assert.strictEqual(getDynamicWeight('route1', 'upstream-2', configuredWeight), 10);

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'upstream-1', configuredWeight);
    }

    assert.strictEqual(
      getDynamicWeight('route1', 'upstream-1', configuredWeight),
      configuredWeight * 0.5,
      'upstream-1 should recover'
    );
    assert.strictEqual(
      getDynamicWeight('route1', 'upstream-2', configuredWeight),
      10,
      'upstream-2 should stay reduced'
    );
  });

  // 5. Full multi-level recovery: min → medium → half → normal

  test('complete multi-level recovery through repeated success cycles', () => {
    const configuredWeight = 100;

    setDynamicWeight('route1', 'target', configuredWeight * 0.05);
    assert.strictEqual(getCurrentWeightLevel('route1', 'target', configuredWeight), 'min');

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }
    assert.strictEqual(
      getDynamicWeight('route1', 'target', configuredWeight),
      configuredWeight * 0.2
    );

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }
    assert.strictEqual(
      getDynamicWeight('route1', 'target', configuredWeight),
      configuredWeight * 0.5
    );

    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'target', configuredWeight);
    }
    assert.strictEqual(getDynamicWeight('route1', 'target', configuredWeight), configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'target', configuredWeight), 'normal');
  });
});

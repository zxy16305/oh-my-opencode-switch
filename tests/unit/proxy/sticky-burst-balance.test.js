import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { selectUpstreamSticky, resetAllState } from '../../../src/proxy/router.js';
import { selectLeastLoadedUpstream } from '../../../src/proxy/route-strategy.js';
import { createStateManager } from '../../../src/proxy/state-manager.js';
import { getPendingAssignmentCount } from '../../../src/proxy/session-manager.js';
import { WeightManager } from '../../../src/proxy/weight/index.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

describe('Sticky burst balance', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('equal-weight burst spreads evenly across active sessions', () => {
    const sm = createStateManager();
    const upstreams = [
      makeUpstream({ id: 'a', weight: 100 }),
      makeUpstream({ id: 'b', weight: 100 }),
      makeUpstream({ id: 'c', weight: 100 }),
    ];

    for (let i = 0; i < 6; i++) {
      selectUpstreamSticky(upstreams, 'burst-route', `sess-${i}`, null, 10, 2, null, null, sm);
    }

    assert.deepEqual(Object.fromEntries(sm.upstreamSessionCounts.get('burst-route').entries()), {
      a: 2,
      b: 2,
      c: 2,
    });
  });

  test('pending assignments influence the next selection before session commit', () => {
    const sm = createStateManager();
    const routeKey = 'pending-route';
    const upstreams = [
      makeUpstream({ id: 'a', weight: 100 }),
      makeUpstream({ id: 'b', weight: 100 }),
    ];
    const weightManager = new WeightManager();

    weightManager.initRoutes({ [routeKey]: { upstreams } });

    const first = selectLeastLoadedUpstream(sm, upstreams, routeKey, null, weightManager);
    assert.equal(getPendingAssignmentCount(sm, routeKey, first.id), 1);

    const second = selectLeastLoadedUpstream(sm, upstreams, routeKey, null, weightManager);
    assert.notEqual(second.id, first.id);
  });
});

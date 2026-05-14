/**
 * Route strategy module - handles upstream selection strategies
 * @module proxy/route-strategy
 */

import { stateManager } from './state-manager.js';
import { RouterError } from './errors.js';
import { calculateEffectiveWeight, calculateLeastLoadedScore } from './weight-calculator.js';
import {
  getPendingAssignmentCount,
  getSessionCountForUpstream,
  incrementPendingAssignment,
} from './session-manager.js';

const SCORE_EPSILON = 1e-9;

/**
 * Get the StateManager instance to use (provided or singleton)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {StateManager}
 */
function getState(state) {
  return state ?? stateManager;
}

/**
 * 选择负载最低的 upstream（考虑动态权重）
 * effectiveWeight = min(staticWeight, latencyWeight, errorWeight)
 * score = (activeSessions + pendingAssignments + 1) / effectiveWeight（越低越好）
 * @param {StateManager} [state] - State manager instance
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @param {object} [dynamicWeightConfig] - Optional dynamic weight config
 * @param {import('./weight/WeightManager.js').WeightManager} weightManager - WeightManager instance
 * @returns {Upstream}
 */
function selectLeastLoadedUpstream(
  state,
  upstreams,
  routeKey,
  dynamicWeightConfig = null,
  weightManager
) {
  const sm = getState(state);

  // Filter out upstreams with effective weight <= 0
  const validUpstreams = [];
  for (const upstream of upstreams) {
    const configuredWeight = weightManager.getConfiguredWeight(upstream);
    const effectiveWeight = Math.max(
      1,
      calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight: configuredWeight,
        dynamicWeightConfig,
        weightManager,
      })
    );
    if (effectiveWeight > 0) {
      validUpstreams.push({ upstream, effectiveWeight });
    }
  }

  if (validUpstreams.length === 0) {
    throw new RouterError('No valid upstreams available', 'NO_VALID_UPSTREAMS');
  }

  let bestScore = Infinity;
  const candidates = [];

  for (const { upstream, effectiveWeight } of validUpstreams) {
    const activeSessions = getSessionCountForUpstream(sm, routeKey, upstream.id);
    const pendingAssignments = getPendingAssignmentCount(sm, routeKey, upstream.id);
    const score = calculateLeastLoadedScore(activeSessions + pendingAssignments, effectiveWeight);

    if (score < bestScore - SCORE_EPSILON) {
      bestScore = score;
      candidates.length = 0;
      candidates.push({ upstream, effectiveWeight });
    } else if (Math.abs(score - bestScore) <= SCORE_EPSILON) {
      candidates.push({ upstream, effectiveWeight });
    }
  }

  const selectedCandidate =
    candidates.length === 1 ? candidates[0] : selectRoundRobinCandidate(sm, routeKey, candidates);

  incrementPendingAssignment(sm, routeKey, selectedCandidate.upstream.id);
  return selectedCandidate.upstream;
}

function selectRoundRobinCandidate(sm, routeKey, candidates) {
  const counter = sm.roundRobinCounters.get(routeKey) ?? 0;
  const selectedCandidate = candidates[counter % candidates.length];
  sm.roundRobinCounters.set(routeKey, counter + 1);
  return selectedCandidate;
}

export { selectLeastLoadedUpstream };

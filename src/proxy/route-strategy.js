/**
 * Route strategy module - handles upstream selection strategies
 * @module proxy/route-strategy
 */

import { stateManager } from './state-manager.js';
import { RouterError } from './errors.js';
import { calculateEffectiveWeight, getConfiguredWeight } from './weight-calculator.js';
import { getUpstreamRequestCountInWindow as _getUpstreamRequestCountInWindow } from './stats-collector.js';

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
 * score = (requestCount + 1) / effectiveWeight（越低越好）
 * 使用滑动窗口请求计数，避免长期运行后权重被稀释
 * @param {StateManager} [state] - State manager instance
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @param {object} [dynamicWeightConfig] - Optional dynamic weight config
 * @param {object} [timeSlotWeightConfig] - Optional time slot weight config
 * @returns {Upstream}
 */
function selectLeastLoadedUpstream(
  state,
  upstreams,
  routeKey,
  dynamicWeightConfig = null,
  timeSlotWeightConfig = null
) {
  const sm = getState(state);

  // Filter out upstreams with effective weight <= 0
  const validUpstreams = [];
  for (const upstream of upstreams) {
    // Use configured weight: time slot weight takes priority, fallback to upstream.weight
    const configuredWeight = getConfiguredWeight(upstream);
    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight: configuredWeight,
      dynamicWeightConfig,
      timeSlotWeightConfig,
      upstreams,
      latencyWindowMs: 3600000,
    });
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
    const requestCount = _getUpstreamRequestCountInWindow(sm, routeKey, upstream.id);

    const score = (requestCount + 1) / effectiveWeight;

    if (score < bestScore) {
      bestScore = score;
      candidates.length = 0;
      candidates.push(upstream);
    } else if (score === bestScore) {
      candidates.push(upstream);
    }
  }

  // Tie-breaking: use weighted random selection among candidates
  if (candidates.length === 1) {
    return candidates[0];
  }

  const totalWeight = candidates.reduce((sum, u) => sum + (u.weight ?? 100), 0);
  let random = Math.random() * totalWeight;

  for (const candidate of candidates) {
    random -= candidate.weight ?? 100;
    if (random <= 0) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
}

export { selectLeastLoadedUpstream };

/**
 * Route strategy module - handles upstream selection strategies
 * @module proxy/route-strategy
 */

import { StateManager, stateManager } from './state-manager.js';
import { RouterError } from './errors.js';
import { getOrCreateCountMap as _getOrCreateCountMap } from './session-manager.js';
import { calculateEffectiveWeight } from './weight-calculator.js';
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
    const staticWeight = upstream.weight ?? 100;
    const effectiveWeight = calculateEffectiveWeight({
      sm,
      routeKey,
      upstream,
      staticWeight,
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

/**
 * Select upstream using round-robin strategy
 * @param {StateManager} [state] - State manager instance
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @param {string} routeKey - Route key for counter tracking
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRoundRobin(state, upstreams, routeKey) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  const sm = getState(state);
  const roundRobinCounters = sm.getRoundRobinCounters();
  let counter = roundRobinCounters.get(routeKey) ?? 0;
  const selectedIndex = counter % upstreams.length;
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  roundRobinCounters.set(routeKey, counter);

  return upstreams[selectedIndex];
}

/**
 * Select upstream using random strategy
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRandom(upstreams) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  const randomIndex = Math.floor(Math.random() * upstreams.length);
  return upstreams[randomIndex];
}

/**
 * Select upstream using weighted strategy
 * @param {Upstream[]} upstreams - Array of available upstreams with optional weights
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamWeighted(upstreams) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight ?? 100), 0);
  let random = Math.random() * totalWeight;

  for (const upstream of upstreams) {
    random -= upstream.weight ?? 100;
    if (random <= 0) {
      return upstream;
    }
  }

  return upstreams[upstreams.length - 1];
}

/**
 * Backwards compatibility for older code that expects module-level exports
 * @deprecated Use StateManager instance instead
 */
export const roundRobinCounters = stateManager.getRoundRobinCounters();
export const timeSlotCalculator = stateManager.getTimeSlotCalculator();

export { selectLeastLoadedUpstream };

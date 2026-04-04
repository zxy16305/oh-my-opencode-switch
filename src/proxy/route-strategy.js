/**
 * Route strategy module - handles upstream selection strategies
 * @module proxy/route-strategy
 */

import { StateManager, stateManager } from './state-manager.js';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { RouterError } from './errors.js';
import {
  getErrorRate as _getErrorRate,
  getLatencyAvg as _getLatencyAvg,
} from './stats-collector.js';
import { getDynamicWeight as _getDynamicWeight } from './weight-manager.js';
import { getOrCreateCountMap as _getOrCreateCountMap } from './session-manager.js';

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
 * score = sessionCount / effectiveWeight（越低越好）
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
  const countMap = _getOrCreateCountMap(sm, routeKey);

  let bestScore = Infinity;
  let bestUpstream = upstreams[0];

  for (const upstream of upstreams) {
    const sessionCount = countMap.get(upstream.id) ?? 0;
    let staticWeight = upstream.weight ?? 1;

    if (timeSlotWeightConfig && timeSlotWeightConfig.enabled) {
      let timeSlotCalculator = sm.getTimeSlotCalculator();
      if (!timeSlotCalculator) {
        timeSlotCalculator = createTimeSlotWeightCalculator();
        sm.setTimeSlotCalculator(timeSlotCalculator);
      }
      const timeSlotWeightMultiplier = timeSlotCalculator.getTimeSlotWeight(
        upstream.provider,
        null,
        {
          totalErrorThreshold: timeSlotWeightConfig.totalErrorThreshold,
          dangerSlotThreshold: timeSlotWeightConfig.dangerSlotThreshold,
          dangerMultiplier: timeSlotWeightConfig.dangerMultiplier,
          normalMultiplier: timeSlotWeightConfig.normalMultiplier,
        }
      );
      staticWeight = staticWeight * timeSlotWeightMultiplier;
    }

    let effectiveWeight = staticWeight;

    if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
      const dynWeight = _getDynamicWeight(
        sm,
        routeKey,
        upstream.id,
        dynamicWeightConfig.initialWeight
      );
      effectiveWeight = Math.min(staticWeight, dynWeight);

      const errorConfig = dynamicWeightConfig.errorWeightReduction;
      if (errorConfig && errorConfig.enabled) {
        const errorCount = _getErrorRate(sm, routeKey, upstream.id, errorConfig.errorWindowMs);
        if (errorCount > 0) {
          const errorWeight = Math.max(
            errorConfig.minWeight,
            dynamicWeightConfig.initialWeight - errorCount * errorConfig.reductionAmount
          );
          effectiveWeight = Math.min(effectiveWeight, errorWeight);
        }
      }

      const latencyWindowMs = 3600000;
      const avgLatency = _getLatencyAvg(sm, routeKey, upstream.id, latencyWindowMs);
      if (avgLatency > 0) {
        let fastestLatency = Infinity;
        for (const u of upstreams) {
          const uAvgLatency = _getLatencyAvg(sm, routeKey, u.id, latencyWindowMs);
          if (uAvgLatency > 0 && uAvgLatency < fastestLatency) {
            fastestLatency = uAvgLatency;
          }
        }

        if (
          fastestLatency !== Infinity &&
          avgLatency > fastestLatency * dynamicWeightConfig.latencyThreshold
        ) {
          const latencyPenalty = Math.max(1, Math.floor((avgLatency / fastestLatency - 1) * 10));
          effectiveWeight = Math.max(1, effectiveWeight - latencyPenalty);
        }
      }
    }

    const score = sessionCount / effectiveWeight;

    if (score < bestScore) {
      bestScore = score;
      bestUpstream = upstream;
    }
  }

  return bestUpstream;
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

  const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
  let random = Math.random() * totalWeight;

  for (const upstream of upstreams) {
    random -= upstream.weight ?? 1;
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

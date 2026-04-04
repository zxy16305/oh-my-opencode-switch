/**
 * Route strategy module - handles upstream selection strategies
 * @module proxy/route-strategy
 */

import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { RouterError } from './errors.js';
import { getErrorRate, getLatencyAvg } from './stats-collector.js';
import { getDynamicWeight } from './weight-manager.js';
import { getOrCreateCountMap } from './session-manager.js';

/**
 * Global time slot weight calculator instance
 * Used for time-based weight adjustments based on historical error patterns
 * @type {import('../utils/time-slot-stats.js').TimeSlotWeightCalculator | null}
 */
let timeSlotCalculator = null;

/**
 * Round-robin state tracker for each route
 * @type {Map<string, number>}
 */
const roundRobinCounters = new Map();

/**
 * 选择负载最低的 upstream（考虑动态权重）
 * effectiveWeight = min(staticWeight, latencyWeight, errorWeight)
 * score = sessionCount / effectiveWeight（越低越好）
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @param {object} [dynamicWeightConfig] - Optional dynamic weight config
 * @param {object} [timeSlotWeightConfig] - Optional time slot weight config
 * @returns {Upstream}
 */
function selectLeastLoadedUpstream(
  upstreams,
  routeKey,
  dynamicWeightConfig = null,
  timeSlotWeightConfig = null
) {
  const countMap = getOrCreateCountMap(routeKey);

  let bestScore = Infinity;
  let bestUpstream = upstreams[0];

  for (const upstream of upstreams) {
    const sessionCount = countMap.get(upstream.id) ?? 0;
    let staticWeight = upstream.weight ?? 1;

    // Apply time slot weight if enabled (before dynamic weight)
    if (timeSlotWeightConfig && timeSlotWeightConfig.enabled) {
      if (!timeSlotCalculator) {
        timeSlotCalculator = createTimeSlotWeightCalculator();
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

    // Apply dynamic weight if enabled
    if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
      const dynWeight = getDynamicWeight(routeKey, upstream.id, dynamicWeightConfig.initialWeight);
      effectiveWeight = Math.min(staticWeight, dynWeight);

      // Apply error-based weight penalty if error reduction is enabled
      const errorConfig = dynamicWeightConfig.errorWeightReduction;
      if (errorConfig && errorConfig.enabled) {
        const errorCount = getErrorRate(routeKey, upstream.id, errorConfig.errorWindowMs);
        if (errorCount > 0) {
          const errorWeight = Math.max(
            errorConfig.minWeight,
            dynamicWeightConfig.initialWeight - errorCount * errorConfig.reductionAmount
          );
          effectiveWeight = Math.min(effectiveWeight, errorWeight);
        }
      }

      // Apply latency-based weight penalty
      const latencyWindowMs = 600000; // 10 minutes
      const avgLatency = getLatencyAvg(routeKey, upstream.id, latencyWindowMs);
      if (avgLatency > 0) {
        // Find the fastest upstream's average latency
        let fastestLatency = Infinity;
        for (const u of upstreams) {
          const uAvgLatency = getLatencyAvg(routeKey, u.id, latencyWindowMs);
          if (uAvgLatency > 0 && uAvgLatency < fastestLatency) {
            fastestLatency = uAvgLatency;
          }
        }

        // Apply penalty if this upstream is significantly slower than fastest
        if (
          fastestLatency !== Infinity &&
          avgLatency > fastestLatency * dynamicWeightConfig.latencyThreshold
        ) {
          const latencyPenalty = Math.max(
            1,
            Math.floor((avgLatency / fastestLatency - 1) * 10) // Reduce weight more for slower upstreams
          );
          effectiveWeight = Math.max(1, effectiveWeight - latencyPenalty);
        }
      }
    }

    // Score: lower is better (fewer sessions per weight unit)
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
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @param {string} routeKey - Route key for counter tracking
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRoundRobin(upstreams, routeKey) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

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

// Export state for external access
export { roundRobinCounters, timeSlotCalculator };

// Export internal function for use by router.js
export { selectLeastLoadedUpstream };

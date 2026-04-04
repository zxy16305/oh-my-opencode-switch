/**
 * Weight calculator module - unified effective weight calculation
 * @module proxy/weight-calculator
 */

import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { getDynamicWeight as _getDynamicWeight } from './weight-manager.js';
import {
  getErrorRate as _getErrorRate,
  getLatencyAvg as _getLatencyAvg,
} from './stats-collector.js';

/**
 * Calculate effective weight for an upstream with all adjustments applied
 *
 * Applies in order:
 * 1. Time slot weight multiplier (if enabled)
 * 2. Dynamic weight (if enabled)
 * 3. Error-based weight penalty (if enabled)
 * 4. Latency-based weight penalty (if enabled)
 *
 * @param {Object} params - Calculation parameters
 * @param {StateManager} params.sm - State manager instance
 * @param {string} params.routeKey - Route identifier
 * @param {Object} params.upstream - Upstream configuration
 * @param {number} params.staticWeight - Base static weight
 * @param {Object} [params.dynamicWeightConfig] - Dynamic weight configuration
 * @param {Object} [params.timeSlotWeightConfig] - Time slot weight configuration
 * @param {Object[]} [params.upstreams] - All upstreams (for latency comparison)
 * @param {number} [params.latencyWindowMs=60000] - Latency window in milliseconds
 * @returns {number} Effective weight after all adjustments
 */
export function calculateEffectiveWeight(params) {
  const {
    sm,
    routeKey,
    upstream,
    staticWeight,
    dynamicWeightConfig = null,
    timeSlotWeightConfig = null,
    upstreams = [],
    latencyWindowMs = 60000,
  } = params;

  let effectiveWeight = staticWeight;

  // Apply time slot weight if enabled (before dynamic weight)
  if (timeSlotWeightConfig && timeSlotWeightConfig.enabled) {
    let timeSlotCalculator = sm.getTimeSlotCalculator();
    if (!timeSlotCalculator) {
      timeSlotCalculator = createTimeSlotWeightCalculator();
      sm.setTimeSlotCalculator(timeSlotCalculator);
    }
    const timeSlotWeightMultiplier = timeSlotCalculator.getTimeSlotWeight(upstream.provider, null, {
      totalErrorThreshold: timeSlotWeightConfig.totalErrorThreshold,
      dangerSlotThreshold: timeSlotWeightConfig.dangerSlotThreshold,
      dangerMultiplier: timeSlotWeightConfig.dangerMultiplier,
      normalMultiplier: timeSlotWeightConfig.normalMultiplier,
    });
    effectiveWeight = effectiveWeight * timeSlotWeightMultiplier;
  }

  // Apply dynamic weight if enabled
  if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
    const dynWeight = _getDynamicWeight(
      sm,
      routeKey,
      upstream.id,
      dynamicWeightConfig.initialWeight
    );
    effectiveWeight = Math.min(effectiveWeight, dynWeight);

    // Apply error-based weight penalty if error reduction is enabled
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

    // Apply latency-based weight penalty
    const avgLatency = _getLatencyAvg(sm, routeKey, upstream.id, latencyWindowMs);
    if (avgLatency > 0) {
      // Find the fastest upstream's average latency
      let fastestLatency = Infinity;
      for (const u of upstreams) {
        const uAvgLatency = _getLatencyAvg(sm, routeKey, u.id, latencyWindowMs);
        if (uAvgLatency > 0 && uAvgLatency < fastestLatency) {
          fastestLatency = uAvgLatency;
        }
      }

      // Apply penalty if this upstream is significantly slower than fastest
      if (
        fastestLatency !== Infinity &&
        avgLatency > fastestLatency * dynamicWeightConfig.latencyThreshold
      ) {
        const latencyPenalty = Math.max(1, Math.floor((avgLatency / fastestLatency - 1) * 10));
        effectiveWeight = Math.max(1, effectiveWeight - latencyPenalty);
      }
    }
  }

  // Ensure effective weight is at least 1
  return Math.max(1, effectiveWeight);
}

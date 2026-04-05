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
 *
 * Note: Latency-based weight penalty has been removed. Latency adjustments
 * should only happen via adjustWeightForLatency() (periodic), not in this
 * function which is called on every request.
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
    // Use configured weight (staticWeight) as initial value for dynamic weight
    // This ensures custom weights (e.g., 200) are respected while allowing dynamic adjustments
    const dynWeight = _getDynamicWeight(
      sm,
      routeKey,
      upstream.id,
      staticWeight // Use configured weight as initial value
    );
    effectiveWeight = Math.min(effectiveWeight, dynWeight);

    // Apply error-based weight penalty if error reduction is enabled
    const errorConfig = dynamicWeightConfig.errorWeightReduction;
    if (errorConfig && errorConfig.enabled) {
      const errorCount = _getErrorRate(sm, routeKey, upstream.id, errorConfig.errorWindowMs);
      if (errorCount > 0) {
        const errorWeight = Math.max(
          errorConfig.minWeight,
          staticWeight - errorCount * errorConfig.reductionAmount
        );
        effectiveWeight = Math.min(effectiveWeight, errorWeight);
      }
    }

    // Latency-based weight penalty has been removed from this function.
    // Latency adjustments should only happen via adjustWeightForLatency() (periodic),
    // not in calculateEffectiveWeight() which is called on every request.
    // Previously, this caused cumulative weight decrease leading to weight=1.
  }

  // Ensure effective weight is at least 1
  return Math.max(1, effectiveWeight);
}

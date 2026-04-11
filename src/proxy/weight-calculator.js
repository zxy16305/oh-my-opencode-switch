/**
 * Weight calculator module - unified effective weight calculation
 * @module proxy/weight-calculator
 */

import { getTimeSlotType } from '../utils/time-slot-detector.js';

let _weightManager = null;

/**
 * @param {import('./weight/WeightManager.js').WeightManager} wm
 */
export function setWeightManager(wm) {
  _weightManager = wm;
}

/**
 * Get configured weight for an upstream, considering time slot weights
 *
 * Returns the weight value that should be used for the current time slot,
 * following the priority: timeSlotWeights[slotType] > upstream.weight > 100
 *
 * @param {Object} upstream - Upstream configuration
 * @param {Object} [upstream.timeSlotWeights] - Time slot weight overrides
 * @param {number} [upstream.weight] - Default weight
 * @returns {number} Configured weight for current time slot
 */
export function getConfiguredWeight(upstream) {
  if (!upstream) {
    return 100;
  }
  const currentHour = new Date().getHours();
  const slotType = getTimeSlotType(currentHour);
  return upstream.timeSlotWeights?.[slotType] ?? upstream.weight ?? 100;
}

/**
 * Calculate effective weight for an upstream with all adjustments applied
 *
 * Applies in order:
 * 1. Dynamic weight (if enabled via WeightManager)
 *
 * Note: Time slot weight is now handled by WeightManager.getConfiguredWeight()
 * and should be applied before calling this function (via staticWeight parameter).
 * Error-based and latency-based weight penalties are now handled by WeightManager.
 *
 * @param {Object} params - Calculation parameters
 * @param {StateManager} params.sm - State manager instance
 * @param {string} params.routeKey - Route identifier
 * @param {Object} params.upstream - Upstream configuration
 * @param {number} params.staticWeight - Base static weight (already includes time slot weight)
 * @param {Object} [params.dynamicWeightConfig] - Dynamic weight configuration
 * @param {Object[]} [params.upstreams] - All upstreams (for latency comparison, deprecated)
 * @param {number} [params.latencyWindowMs=60000] - Latency window (deprecated)
 * @returns {number} Effective weight after all adjustments
 */
export function calculateEffectiveWeight(params) {
  const {
    sm: _sm,
    routeKey,
    upstream,
    staticWeight,
    dynamicWeightConfig = null,
    upstreams: _upstreams = [],
    latencyWindowMs: _latencyWindowMs = 60000,
  } = params;

  let effectiveWeight = staticWeight;

  // Apply dynamic weight if enabled
  if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
    const configuredWeight = getConfiguredWeight(upstream);

    if (_weightManager) {
      const wmWeight = _weightManager.getWeight(routeKey, upstream.id);
      // If WeightManager has no state for this upstream (returns default 100),
      // fall back to configuredWeight which includes time slot adjustments
      if (wmWeight === 100 && !_weightManager.getState(routeKey, upstream.id)) {
        effectiveWeight = configuredWeight;
      } else {
        effectiveWeight = wmWeight;
      }
    }
  }

  // Ensure effective weight is at least 1
  return Math.max(1, effectiveWeight);
}

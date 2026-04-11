/**
 * Weight calculator module - unified effective weight calculation
 * @module proxy/weight-calculator
 */

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
 * @param {import('./weight/WeightManager.js').WeightManager} params.weightManager - WeightManager instance
 * @returns {number} Effective weight after all adjustments
 */
export function calculateEffectiveWeight(params) {
  const {
    sm: _sm,
    routeKey,
    upstream,
    staticWeight,
    dynamicWeightConfig = null,
    weightManager,
  } = params;

  let effectiveWeight = staticWeight;

  // Apply dynamic weight if enabled
  if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
    const configuredWeight = weightManager.getConfiguredWeight(upstream);

    const wmWeight = weightManager.getWeight(routeKey, upstream.id);
    // If WeightManager has no state for this upstream (returns default 100),
    // fall back to configuredWeight which includes time slot adjustments
    if (wmWeight === 100 && !weightManager.getState(routeKey, upstream.id)) {
      effectiveWeight = configuredWeight;
    } else {
      effectiveWeight = wmWeight;
    }
  }

  // Ensure effective weight is at least 1
  return Math.max(1, effectiveWeight);
}

/**
 * Calculate least-loaded score for an upstream
 *
 * Lower score means the upstream is less loaded relative to its capacity.
 * Formula: (requestCount + 1) / effectiveWeight
 *
 * The +1 prevents zero-request-count upstreams from having a score of 0,
 * which would make them unfairly dominant.
 *
 * @param {number} requestCount - Number of requests in current window
 * @param {number} effectiveWeight - Effective weight after all adjustments
 * @returns {number} Least-loaded score (lower is better)
 */
export function calculateLeastLoadedScore(requestCount, effectiveWeight) {
  return (requestCount + 1) / effectiveWeight;
}

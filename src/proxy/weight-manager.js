/**
 * Weight management module - handles dynamic weight adjustments
 * @module proxy/weight-manager
 */

import { StateManager } from './state-manager.js';

/**
 * Default dynamic weight configuration
 */
const DEFAULT_DYNAMIC_WEIGHT_CONFIG = {
  enabled: true,
  initialWeight: 100,
  minWeight: 10,
  checkInterval: 10,
  latencyThreshold: 1.5,
  recoveryInterval: 300000,
  recoveryAmount: 1,
  errorWeightReduction: {
    enabled: true,
    errorCodes: [429, 500, 502, 503, 504],
    reductionAmount: 10,
    minWeight: 5,
    errorWindowMs: 3600000,
  },
};

/**
 * Get or initialize dynamic weight for an upstream
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} initialWeight
 * @returns {number} Current weight
 */
function getDynamicWeight(state, routeKey, upstreamId, initialWeight = 100) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  if (!weightState) {
    dynamicWeightState.set(key, {
      currentWeight: initialWeight,
      lastAdjustment: Date.now(),
      requestCount: 0,
    });
    return initialWeight;
  }
  return weightState.currentWeight;
}

/**
 * Set dynamic weight for an upstream
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} weight
 */
function setDynamicWeight(state, routeKey, upstreamId, weight) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  if (weightState) {
    weightState.currentWeight = weight;
    weightState.lastAdjustment = Date.now();
  } else {
    dynamicWeightState.set(key, {
      currentWeight: weight,
      lastAdjustment: Date.now(),
      requestCount: 0,
    });
  }
}

/**
 * Adjust weights based on latency comparison
 * Compares each upstream's avgDuration to the fastest upstream
 * Decreases weight by 1 if latency > fastest * latencyThreshold
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @param {Map<string, {avgDuration: number}>} latencyData - upstream latency data
 */
function adjustWeightForLatency(state, routeKey, upstreams, config, latencyData) {
  if (!upstreams || upstreams.length <= 1) return;
  if (!config) return;

  const { minWeight, latencyThreshold, initialWeight } = {
    ...DEFAULT_DYNAMIC_WEIGHT_CONFIG,
    ...config,
  };

  // Find the fastest upstream's avgDuration
  let fastestDuration = Infinity;
  for (const upstream of upstreams) {
    const data = latencyData.get(upstream.id);
    if (data && data.avgDuration && data.avgDuration < fastestDuration) {
      fastestDuration = data.avgDuration;
    }
  }

  // If no latency data, skip adjustment
  if (fastestDuration === Infinity) return;

  // Check each upstream and adjust weight if needed
  for (const upstream of upstreams) {
    const data = latencyData.get(upstream.id);
    if (!data || !data.avgDuration) continue;

    // Use configured weight (upstream.weight) as baseline for initialization
    // This ensures custom weights (e.g., 200) are respected during weight adjustments
    const configuredWeight = upstream.weight ?? 100;
    const currentWeight = getDynamicWeight(state, routeKey, upstream.id, configuredWeight);

    // Skip if already at min weight
    if (currentWeight <= minWeight) continue;

    // Decrease weight if latency exceeds threshold
    if (data.avgDuration > fastestDuration * latencyThreshold) {
      setDynamicWeight(state, routeKey, upstream.id, Math.max(minWeight, currentWeight - 1));
    }
  }
}

/**
 * Adjust weights based on error data
 * For each upstream with matching error codes in errorData, reduce weight by reductionAmount
 * Weight is never reduced below the configured minWeight
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @param {Map<string, number[]>} errorData - Map of upstreamId to array of error status codes
 */
function adjustWeightForError(state, routeKey, upstreams, config, errorData) {
  if (!upstreams || upstreams.length === 0) return;
  if (!errorData || errorData.size === 0) return;
  if (!config) return;

  // Check original config before merging
  if (!('errorWeightReduction' in config)) return;
  const mergedConfig = { ...DEFAULT_DYNAMIC_WEIGHT_CONFIG, ...config };
  const errorConfig = mergedConfig.errorWeightReduction;
  if (!errorConfig || !errorConfig.enabled) return;

  const { errorCodes = [], reductionAmount = 10, minWeight = 5 } = errorConfig;
  const initialWeight = mergedConfig.initialWeight;

  for (const upstream of upstreams) {
    const codes = errorData.get(upstream.id);
    if (!codes || codes.length === 0) continue;

    const hasMatchingError = codes.some((code) => errorCodes.includes(code));
    if (!hasMatchingError) continue;

    const configuredWeight = upstream.weight ?? 100;
    const currentWeight = getDynamicWeight(state, routeKey, upstream.id, configuredWeight);

    if (currentWeight <= minWeight) continue;

    setDynamicWeight(
      state,
      routeKey,
      upstream.id,
      Math.max(minWeight, currentWeight - reductionAmount)
    );
  }
}

/**
 * Start periodic weight recovery for a route
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @returns {NodeJS.Timeout} Timer ID for cleanup
 */
function startWeightRecovery(state, routeKey, upstreams, config) {
  if (!routeKey || !upstreams || upstreams.length === 0 || !config) {
    return null;
  }

  const mergedConfig = { ...DEFAULT_DYNAMIC_WEIGHT_CONFIG, ...config };

  if (
    !mergedConfig.enabled ||
    !mergedConfig.recoveryInterval ||
    mergedConfig.recoveryInterval <= 0
  ) {
    return null;
  }

  stopWeightRecovery(state, routeKey);

  const { recoveryInterval, recoveryAmount, initialWeight } = mergedConfig;

  const timer = setInterval(() => {
    for (const upstream of upstreams) {
      // Use configured weight (upstream.weight) as recovery target
      // This ensures custom weights (e.g., 200) are respected during recovery
      const configuredWeight = upstream.weight ?? 100;
      const currentWeight = getDynamicWeight(state, routeKey, upstream.id, configuredWeight);
      if (currentWeight < configuredWeight) {
        setDynamicWeight(
          state,
          routeKey,
          upstream.id,
          Math.min(configuredWeight, currentWeight + recoveryAmount)
        );
      }
    }
  }, recoveryInterval);

  // Store timer for cleanup
  state.addRecoveryTimer(routeKey, timer);

  // Unref to allow process exit
  if (timer.unref) {
    timer.unref();
  }

  return timer;
}

/**
 * Stop weight recovery timer for a route
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 */
function stopWeightRecovery(state, routeKey) {
  state.removeRecoveryTimer(routeKey);
}

// Export all functions and config
export {
  DEFAULT_DYNAMIC_WEIGHT_CONFIG,
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForLatency,
  adjustWeightForError,
  startWeightRecovery,
  stopWeightRecovery,
};

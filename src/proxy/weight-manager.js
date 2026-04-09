/**
 * Weight management module - handles dynamic weight adjustments
 * @module proxy/weight-manager
 */

import { getErrorRate, getUpstreamRequestCountInWindow, getErrorState } from './stats-collector.js';

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
      lastStaticWeight: initialWeight,
      lastAdjustment: Date.now(),
      requestCount: 0,
      consecutiveSuccessCount: 0,
      currentWeightLevel: 'normal',
    });
    return initialWeight;
  }
  // If static weight increased above last recorded static weight, bump dynamic weight up.
  // Static weight changes are intentional config edits that should take effect immediately,
  // overriding any dynamic adjustments that may have capped the weight at a lower value.
  // But if static weight stayed the same, respect error/latency reductions.
  if (initialWeight > weightState.lastStaticWeight) {
    weightState.currentWeight = initialWeight;
    weightState.lastStaticWeight = initialWeight;
    weightState.lastAdjustment = Date.now();
  } else {
    weightState.lastStaticWeight = initialWeight;
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
      consecutiveSuccessCount: 0,
      currentWeightLevel: 'normal',
    });
  }
}

function getConsecutiveSuccessCount(state, routeKey, upstreamId) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  return weightState?.consecutiveSuccessCount ?? 0;
}

function setConsecutiveSuccessCount(state, routeKey, upstreamId, count) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  if (weightState) {
    weightState.consecutiveSuccessCount = count;
  } else {
    dynamicWeightState.set(key, {
      currentWeight: 100,
      lastAdjustment: Date.now(),
      requestCount: 0,
      consecutiveSuccessCount: count,
      currentWeightLevel: 'normal',
    });
  }
}

function getCurrentWeightLevel(state, routeKey, upstreamId, configuredWeight = 100) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  if (!weightState) return 'normal';
  const ratio = weightState.currentWeight / configuredWeight;
  if (ratio <= 0.075) return 'min';
  if (ratio <= 0.35) return 'medium';
  if (ratio <= 0.75) return 'half';
  return 'normal';
}

function setCurrentWeightLevel(state, routeKey, upstreamId, level) {
  const key = `${routeKey}:${upstreamId}`;
  const dynamicWeightState = state.getDynamicWeightState();
  const weightState = dynamicWeightState.get(key);
  if (weightState) {
    weightState.currentWeightLevel = level;
  } else {
    dynamicWeightState.set(key, {
      currentWeight: 100,
      lastAdjustment: Date.now(),
      requestCount: 0,
      consecutiveSuccessCount: 0,
      currentWeightLevel: level,
    });
  }
}

/**
 * Increment consecutive success count and trigger recovery at threshold
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} configuredWeight - Original configured weight for recovery calculation
 */
function incrementSuccessCount(state, routeKey, upstreamId, configuredWeight = 100) {
  adjustWeightForSuccess(state, routeKey, upstreamId, configuredWeight);
}

/**
 * Reset consecutive success count to 0
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 */
function resetSuccessCount(state, routeKey, upstreamId) {
  setConsecutiveSuccessCount(state, routeKey, upstreamId, 0);
}

/**
 * Staircase weight recovery: increments count, promotes one level at threshold (5)
 * min(5%) → medium(20%) → half(50%) → normal(100%)
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} configuredWeight - Original configured weight
 */
function adjustWeightForSuccess(state, routeKey, upstreamId, configuredWeight) {
  const currentCount = getConsecutiveSuccessCount(state, routeKey, upstreamId);
  const newCount = currentCount + 1;
  setConsecutiveSuccessCount(state, routeKey, upstreamId, newCount);

  if (newCount < 5) return;

  const level = getCurrentWeightLevel(state, routeKey, upstreamId, configuredWeight);
  let newWeight, newLevel;
  if (level === 'min') {
    newWeight = configuredWeight * 0.2;
    newLevel = 'medium';
  } else if (level === 'medium') {
    newWeight = configuredWeight * 0.5;
    newLevel = 'half';
  } else if (level === 'half') {
    newWeight = configuredWeight;
    newLevel = 'normal';
  } else {
    setConsecutiveSuccessCount(state, routeKey, upstreamId, 0);
    return;
  }
  setDynamicWeight(state, routeKey, upstreamId, newWeight);
  setCurrentWeightLevel(state, routeKey, upstreamId, newLevel);
  setConsecutiveSuccessCount(state, routeKey, upstreamId, 0);
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

  const {
    minWeight,
    latencyThreshold,
    initialWeight: _initialWeight,
  } = {
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

  const mergedConfig = { ...DEFAULT_DYNAMIC_WEIGHT_CONFIG, ...config };
  const errorConfig = mergedConfig.errorWeightReduction;
  if (!errorConfig || !errorConfig.enabled) return;

  const { errorCodes = [], errorWindowMs = 3600000 } = errorConfig;
  const minWeight = 10; // Minimum weight floor

  for (const upstream of upstreams) {
    const codes = errorData.get(upstream.id);
    if (!codes || codes.length === 0) continue;

    const hasMatchingError = codes.some((code) => errorCodes.includes(code));
    if (!hasMatchingError) continue;

    const configuredWeight = upstream.weight ?? 100;

    // Calculate error rate percentage
    const errorCount = getErrorRate(state, routeKey, upstream.id, errorWindowMs);
    const totalRequests = getUpstreamRequestCountInWindow(
      state,
      routeKey,
      upstream.id,
      errorWindowMs
    );

    if (totalRequests === 0) continue; // No requests in window, skip adjustment

    const errorRatePercent = (errorCount / totalRequests) * 100;

    // Apply step penalty based on error rate thresholds
    let newWeight;
    let weightLevel;
    if (errorRatePercent >= 30) {
      newWeight = Math.max(minWeight, configuredWeight * 0.05);
      weightLevel = 'min';
    } else if (errorRatePercent >= 15) {
      newWeight = Math.max(minWeight, configuredWeight * 0.2);
      weightLevel = 'medium';
    } else if (errorRatePercent >= 5) {
      newWeight = Math.max(minWeight, configuredWeight * 0.5);
      weightLevel = 'half';
    } else {
      continue;
    }

    setDynamicWeight(state, routeKey, upstream.id, newWeight);
    setCurrentWeightLevel(state, routeKey, upstream.id, weightLevel);
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

  const { recoveryInterval, recoveryAmount, initialWeight: _initialWeight } = mergedConfig;

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

/**
 * Start periodic weight check for a route
 * Checks error rates and adjusts weights every checkInterval seconds
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @returns {NodeJS.Timeout | null} Timer ID for cleanup
 */
function startWeightCheck(state, routeKey, upstreams, config) {
  if (!state || !routeKey || !upstreams || upstreams.length === 0 || !config) {
    return null;
  }

  const mergedConfig = { ...DEFAULT_DYNAMIC_WEIGHT_CONFIG, ...config };

  if (!mergedConfig.enabled || !mergedConfig.checkInterval || mergedConfig.checkInterval <= 0) {
    return null;
  }

  stopWeightCheck(state, routeKey);

  const { checkInterval, errorWeightReduction } = mergedConfig;
  const errorWindowMs = errorWeightReduction?.errorWindowMs || 3600000;
  const errorCodes = errorWeightReduction?.errorCodes || [429, 500, 502, 503, 504];

  const timer = setInterval(() => {
    try {
      const errorState = getErrorState(state);
      const now = Date.now();

      const errorData = new Map();
      for (const upstream of upstreams) {
        const key = `${routeKey}:${upstream.id}`;
        const errorEntry = errorState.get(key);
        if (errorEntry && errorEntry.errors) {
          const windowStart = now - errorWindowMs;
          const codes = errorEntry.errors
            .filter((e) => e.timestamp >= windowStart && errorCodes.includes(e.statusCode))
            .map((e) => e.statusCode);
          if (codes.length > 0) {
            errorData.set(upstream.id, codes);
          }
        }
      }

      if (errorData.size > 0) {
        adjustWeightForError(state, routeKey, upstreams, config, errorData);
      }
    } catch (_error) {
      // eslint-disable-line no-empty
    }
  }, checkInterval * 1000);

  state.addCheckTimer(routeKey, timer);

  if (timer.unref) {
    timer.unref();
  }

  return timer;
}

/**
 * Stop weight check timer for a route
 * @param {StateManager} state - State manager instance
 * @param {string} routeKey
 */
function stopWeightCheck(state, routeKey) {
  state.removeCheckTimer(routeKey);
}

// Export all functions and config
export {
  DEFAULT_DYNAMIC_WEIGHT_CONFIG,
  getDynamicWeight,
  setDynamicWeight,
  getConsecutiveSuccessCount,
  setConsecutiveSuccessCount,
  getCurrentWeightLevel,
  setCurrentWeightLevel,
  incrementSuccessCount,
  resetSuccessCount,
  adjustWeightForSuccess,
  adjustWeightForLatency,
  adjustWeightForError,
  startWeightRecovery,
  stopWeightRecovery,
  startWeightCheck,
  stopWeightCheck,
};

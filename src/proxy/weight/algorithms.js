// src/proxy/weight/algorithms.js

import { ERROR_THRESHOLDS, RECOVERY_STEPS } from './constants.js';

/**
 * Calculate error rate within a time window
 * @param {Object} state - { errors: [{timestamp}], totalRequests }
 * @param {number} windowMs - Time window in milliseconds
 * @returns {number} Error rate (0-1)
 */
export function calculateErrorRate(state, windowMs) {
  const recentRequests = state.recentRequestTimestamps ?? [];

  if (recentRequests.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  const recentErrors = state.errors.filter((e) => e.timestamp >= windowStart);
  const requestsInWindow = recentRequests.filter((ts) => ts >= windowStart);

  if (requestsInWindow.length === 0) {
    return 0;
  }

  return recentErrors.length / requestsInWindow.length;
}

/**
 * Calculate weight adjustment based on error rate
 * @param {Object} state - { errors, totalRequests, configuredWeight }
 * @param {Object} config - { errorWindowMs, minWeight }
 * @returns {{ newWeight: number, level: string, multiplier: number } | null}
 */
export function calculateErrorAdjustment(state, config) {
  const { configuredWeight } = state;
  const { errorWindowMs, minWeight } = config;

  const errorRate = calculateErrorRate(state, errorWindowMs);

  // Find matching threshold (thresholds are ordered high to low)
  for (const threshold of ERROR_THRESHOLDS) {
    if (errorRate >= threshold.rate) {
      const calculatedWeight = configuredWeight * threshold.multiplier;
      const newWeight = Math.max(minWeight, calculatedWeight);

      return {
        newWeight,
        level: threshold.level,
        multiplier: threshold.multiplier,
      };
    }
  }

  // Error rate below all thresholds
  return null;
}

/**
 * Calculate recovery step based on consecutive successes
 * @param {Object} state - { level, consecutiveSuccess, configuredWeight }
 * @param {number} threshold - Minimum consecutive successes (default: 5)
 * @returns {{ newWeight: number, level: string } | null}
 */
export function calculateRecovery(state, threshold = 5) {
  const { level, consecutiveSuccess, configuredWeight } = state;

  // Already at normal level
  if (level === 'normal') {
    return null;
  }

  // Not enough consecutive successes
  if (consecutiveSuccess < threshold) {
    return null;
  }

  const step = RECOVERY_STEPS[level];
  if (!step) {
    return null;
  }

  const newWeight = Math.round(configuredWeight * step.multiplier);

  return {
    newWeight,
    level: step.nextLevel,
  };
}

/**
 * Update time slot weight proportionally when configured weight changes
 * @param {Object} state - { configuredWeight, currentWeight }
 * @param {number} newConfiguredWeight - New configured weight value
 * @returns {{ currentWeight: number } | null}
 */
export function updateTimeSlotWeight(state, newConfiguredWeight) {
  const { configuredWeight, currentWeight } = state;

  // No change needed
  if (newConfiguredWeight === configuredWeight) {
    return null;
  }

  // Calculate ratio and apply to new weight
  const ratio = currentWeight / configuredWeight;
  const newCurrentWeight = Math.round(newConfiguredWeight * ratio);

  // Update state
  state.configuredWeight = newConfiguredWeight;
  state.currentWeight = newCurrentWeight;

  return { currentWeight: newCurrentWeight };
}

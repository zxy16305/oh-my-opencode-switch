/**
 * Router module for proxy - handles virtual model name mapping and upstream selection
 * @module proxy/router
 */

import { z } from 'zod';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { RouterError } from './errors.js';
import { StateManager, stateManager } from './state-manager.js';

// Import internal versions of weight-manager functions (with _ prefix)
import {
  getDynamicWeight as _getDynamicWeight,
  setDynamicWeight as _setDynamicWeight,
  adjustWeightForLatency as _adjustWeightForLatency,
  adjustWeightForError as _adjustWeightForError,
  startWeightRecovery as _startWeightRecovery,
  stopWeightRecovery as _stopWeightRecovery,
} from './weight-manager.js';

// Import internal versions of session-manager functions (with _ prefix)
import {
  getSessionId as _getSessionId,
  startSessionCleanup as _startSessionCleanup,
  stopSessionCleanup as _stopSessionCleanup,
  incrementSessionCount as _incrementSessionCount,
  decrementSessionCount as _decrementSessionCount,
  hashSessionToBackend as _hashSessionToBackend,
} from './session-manager.js';

// Import internal versions of route-strategy functions (with _ prefix)
import {
  selectUpstreamRoundRobin as _selectUpstreamRoundRobin,
  selectUpstreamRandom as _selectUpstreamRandom,
  selectUpstreamWeighted as _selectUpstreamWeighted,
  selectLeastLoadedUpstream as _selectLeastLoadedUpstream,
} from './route-strategy.js';

// Import internal versions of stats-collector functions (with _ prefix)
import {
  recordUpstreamStats as _recordUpstreamStats,
  getUpstreamStats as _getUpstreamStats,
  getErrorRate as _getErrorRate,
  getLatencyAvg as _getLatencyAvg,
  getUpstreamRequestCountInWindow as _getUpstreamRequestCountInWindow,
  incrementUpstreamRequestCount as _incrementUpstreamRequestCount,
  resetStats as _resetStats,
  recordUpstreamError as _recordUpstreamError,
  getErrorState as _getErrorState,
  recordUpstreamLatency as _recordUpstreamLatency,
  getLatencyState as _getLatencyState,
  getUpstreamRequestCounts as _getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts as _getUpstreamSlidingWindowCounts,
} from './stats-collector.js';

// Import failover handler
import { failoverStickySession as _failoverStickySession } from './failover-handler.js';

/**
 * Upstream configuration schema
 */
export const upstreamSchema = z.object({
  id: z.string().min(1, 'Upstream ID is required'),
  provider: z.string().min(1, 'Provider name is required'),
  model: z.string().min(1, 'Model name is required'),
  baseURL: z.string().url('Base URL must be a valid URL'),
  apiKey: z.string().optional(),
  weight: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Route configuration schema
 */
export const routeSchema = z.object({
  strategy: z.enum(['round-robin', 'random', 'weighted', 'sticky']).default('round-robin'),
  upstreams: z.array(upstreamSchema).min(1, 'At least one upstream is required'),
  metadata: z.record(z.unknown()).optional(),
  stickyReassignThreshold: z.number().int().positive().optional().default(10),
  stickyReassignMinGap: z.number().int().min(0).optional().default(2),
  dynamicWeight: z
    .object({
      enabled: z.boolean().default(true),
      initialWeight: z.number().int().positive().default(100),
      minWeight: z.number().int().positive().default(10),
      checkInterval: z.number().int().positive().default(10),
      latencyThreshold: z.number().positive().default(1.5),
      recoveryInterval: z.number().int().positive().default(300000),
      recoveryAmount: z.number().int().positive().default(1),
      errorWeightReduction: z
        .object({
          enabled: z.boolean().default(true),
          errorCodes: z.array(z.number()).default([429, 500, 502, 503, 504]),
          reductionAmount: z.number().int().positive().default(10),
          minWeight: z.number().int().positive().default(5),
          errorWindowMs: z.number().int().positive().default(3600000),
        })
        .optional()
        .default({
          enabled: true,
          errorCodes: [429, 500, 502, 503, 504],
          reductionAmount: 10,
          minWeight: 5,
          errorWindowMs: 3600000,
        }),
    })
    .optional()
    .default({
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
    }),
  timeSlotWeight: z
    .object({
      enabled: z.boolean().default(true),
      totalErrorThreshold: z.number().positive().default(0.01),
      dangerSlotThreshold: z.number().positive().default(0.05),
      dangerMultiplier: z.number().positive().default(0.5),
      normalMultiplier: z.number().positive().default(2.0),
      lookbackDays: z.number().int().positive().default(7),
    })
    .optional()
    .default({
      enabled: true,
      totalErrorThreshold: 0.01,
      dangerSlotThreshold: 0.05,
      dangerMultiplier: 0.5,
      normalMultiplier: 2.0,
      lookbackDays: 7,
    }),
});

/**
 * Full routes configuration schema
 */
export const routesConfigSchema = z.record(z.string(), routeSchema);

/**
 * @typedef {z.infer<typeof upstreamSchema>} Upstream
 * @typedef {z.infer<typeof routeSchema>} Route
 * @typedef {z.infer<typeof routesConfigSchema>} RoutesConfig
 */

export { RouterError } from './errors.js';

/**
 * Global time slot weight calculator instance
 * Used for time-based weight adjustments based on historical error patterns
 * @type {import('../utils/time-slot-stats.js').TimeSlotWeightCalculator | null}
 */
let timeSlotCalculator = null;

/**
 * Get route configuration for a given model name
 * @param {string} model - Virtual model name to look up
 * @param {RoutesConfig} config - Routes configuration object
 * @returns {Route | null} Route configuration or null if not found
 */
export function getRouteForModel(model, config) {
  if (!model || typeof model !== 'string') {
    return null;
  }

  if (!config || typeof config !== 'object') {
    return null;
  }

  const route = config[model];
  if (route) {
    return route;
  }

  return null;
}

/**
 * Get session ID from request (wrapper with optional state param)
 * @param {import('node:http').IncomingMessage} request - HTTP request
 * @param {object} [body] - Parsed request body
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {string} Session ID
 */
export function getSessionId(request, body = null, state = null) {
  return _getSessionId(request, body);
}

/**
 * Hash session to backend (wrapper with optional state param)
 * @param {string} sessionId - Session ID
 * @param {number} backendCount - Number of backends
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Backend index
 */
export function hashSessionToBackend(sessionId, backendCount, state = null) {
  return _hashSessionToBackend(sessionId, backendCount);
}

/**
 * Wrapper for getDynamicWeight with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} [initialWeight=100] - Initial weight value
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Current weight
 */
export function getDynamicWeight(routeKey, upstreamId, initialWeight = 100, state = null) {
  const sm = state ?? stateManager;
  return _getDynamicWeight(sm, routeKey, upstreamId, initialWeight);
}

/**
 * Wrapper for setDynamicWeight with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} weight - Weight value to set
 * @param {StateManager} [state] - Optional state manager instance
 */
export function setDynamicWeight(routeKey, upstreamId, weight, state = null) {
  const sm = state ?? stateManager;
  _setDynamicWeight(sm, routeKey, upstreamId, weight);
}

/**
 * Wrapper for adjustWeightForLatency with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {Upstream[]} upstreams - Array of upstreams
 * @param {object} config - Dynamic weight config
 * @param {Map<string, {avgDuration: number}>} latencyData - Latency data map
 * @param {StateManager} [state] - Optional state manager instance
 */
export function adjustWeightForLatency(routeKey, upstreams, config, latencyData, state = null) {
  const sm = state ?? stateManager;
  _adjustWeightForLatency(sm, routeKey, upstreams, config, latencyData);
}

/**
 * Wrapper for adjustWeightForError with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {Upstream[]} upstreams - Array of upstreams
 * @param {object} config - Dynamic weight config
 * @param {Map<string, number[]>} errorData - Error data map
 * @param {StateManager} [state] - Optional state manager instance
 */
export function adjustWeightForError(routeKey, upstreams, config, errorData, state = null) {
  const sm = state ?? stateManager;
  _adjustWeightForError(sm, routeKey, upstreams, config, errorData);
}

/**
 * Wrapper for startWeightRecovery with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {Upstream[]} upstreams - Array of upstreams
 * @param {object} config - Dynamic weight config
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {NodeJS.Timeout | null} Timer instance
 */
export function startWeightRecovery(routeKey, upstreams, config, state = null) {
  const sm = state ?? stateManager;
  return _startWeightRecovery(sm, routeKey, upstreams, config);
}

/**
 * Wrapper for stopWeightRecovery with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {StateManager} [state] - Optional state manager instance
 */
export function stopWeightRecovery(routeKey, state = null) {
  const sm = state ?? stateManager;
  _stopWeightRecovery(sm, routeKey);
}

/**
 * Wrapper for recordUpstreamError with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} statusCode - HTTP status code
 * @param {StateManager} [state] - Optional state manager instance
 */
export function recordUpstreamError(routeKey, upstreamId, statusCode, state = null) {
  const sm = state ?? stateManager;
  _recordUpstreamError(sm, routeKey, upstreamId, statusCode);
}

/**
 * Wrapper for getErrorRate with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number|object} windowMsOrConfig - Time window or config
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Error rate
 */
export function getErrorRate(routeKey, upstreamId, windowMsOrConfig, state = null) {
  const sm = state ?? stateManager;
  return _getErrorRate(sm, routeKey, upstreamId, windowMsOrConfig);
}

/**
 * Wrapper for getErrorState with optional state parameter at end
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>}
 */
export function getErrorState(state = null) {
  const sm = state ?? stateManager;
  return _getErrorState(sm);
}

/**
 * Wrapper for recordUpstreamLatency with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} ttfb - Time to first byte
 * @param {number} duration - Request duration
 * @param {StateManager} [state] - Optional state manager instance
 */
export function recordUpstreamLatency(routeKey, upstreamId, ttfb, duration, state = null) {
  const sm = state ?? stateManager;
  _recordUpstreamLatency(sm, routeKey, upstreamId, ttfb, duration);
}

/**
 * Wrapper for getLatencyAvg with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} windowMs - Time window in ms
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Average latency
 */
export function getLatencyAvg(routeKey, upstreamId, windowMs = 3600000, state = null) {
  const sm = state ?? stateManager;
  return _getLatencyAvg(sm, routeKey, upstreamId, windowMs);
}

/**
 * Wrapper for getLatencyState with optional state parameter at end
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>}
 */
export function getLatencyState(state = null) {
  const sm = state ?? stateManager;
  return _getLatencyState(sm);
}

/**
 * Wrapper for getUpstreamRequestCountInWindow with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} windowMs - Time window in ms
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Request count
 */
export function getUpstreamRequestCountInWindow(
  routeKey,
  upstreamId,
  windowMs = 3600000,
  state = null
) {
  const sm = state ?? stateManager;
  return _getUpstreamRequestCountInWindow(sm, routeKey, upstreamId, windowMs);
}

/**
 * Wrapper for incrementUpstreamRequestCount with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {StateManager} [state] - Optional state manager instance
 */
export function incrementUpstreamRequestCount(routeKey, upstreamId, state = null) {
  const sm = state ?? stateManager;
  _incrementUpstreamRequestCount(sm, routeKey, upstreamId);
}

/**
 * Wrapper for getUpstreamRequestCounts with optional state parameter at end
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamRequestCounts(state = null) {
  const sm = state ?? stateManager;
  return _getUpstreamRequestCounts(sm);
}

/**
 * Wrapper for getUpstreamSlidingWindowCounts with optional state parameter at end
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, Array<{timestamp: number}>}
 */
export function getUpstreamSlidingWindowCounts(state = null) {
  const sm = state ?? stateManager;
  return _getUpstreamSlidingWindowCounts(sm);
}

/**
 * Wrapper for recordUpstreamStats with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {number} [ttfb] - Time to first byte
 * @param {number} [duration] - Request duration
 * @param {boolean} [isError=false] - Whether this was an error
 * @param {StateManager} [state] - Optional state manager instance
 */
export function recordUpstreamStats(
  routeKey,
  upstreamId,
  ttfb,
  duration,
  isError = false,
  state = null
) {
  const sm = state ?? stateManager;
  _recordUpstreamStats(sm, routeKey, upstreamId, ttfb, duration, isError);
}

/**
 * Wrapper for getUpstreamStats with optional state parameter at end
 * @param {string} routeKey - Route identifier
 * @param {string} upstreamId - Upstream identifier
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {{ errorCount: number, avgTtfb: number, ttfbP95: number, ttfbP99: number, avgDuration: number, durationP95: number, durationP99: number, sampleCount: number }}
 */
export function getUpstreamStats(routeKey, upstreamId, state = null) {
  const sm = state ?? stateManager;
  return _getUpstreamStats(sm, routeKey, upstreamId);
}

/**
 * Select upstream using round-robin strategy (wrapper with optional state param)
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @param {string} routeKey - Route key for counter tracking
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRoundRobin(upstreams, routeKey, state = null) {
  const sm = state ?? stateManager;
  return _selectUpstreamRoundRobin(sm, upstreams, routeKey);
}

/**
 * Select upstream using random strategy
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRandom(upstreams, state = null) {
  return _selectUpstreamRandom(upstreams);
}

/**
 * Select upstream using weighted strategy
 * @param {Upstream[]} upstreams - Array of available upstreams with optional weights
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamWeighted(upstreams, state = null) {
  return _selectUpstreamWeighted(upstreams);
}

/**
 * Get dynamic weight state (wrapper with optional state param)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, { currentWeight: number, lastAdjustment: number, requestCount: number }>}
 */
export function getDynamicWeightState(state = null) {
  const sm = state ?? stateManager;
  return sm.getDynamicWeightState();
}

/**
 * Get recovery timers (wrapper with optional state param)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, NodeJS.Timeout>}
 */
export function getRecoveryTimers(state = null) {
  const sm = state ?? stateManager;
  return sm.getRecoveryTimers();
}

/**
 * Select upstream using sticky session strategy with consistent hashing.
 * If session already has a mapped upstream, reuse it. Otherwise, hash to pick one.
 * Falls back to next available upstream if the mapped one is unavailable.
 * @param {Upstream[]} upstreams - Available upstreams
 * @param {string} routeKey - Route key for mapping scope
 * @param {string} sessionId - Session ID for affinity
 * @param {string} [model] - Model name for session key (combined with sessionId)
 * @param {number} [threshold=10] - Request count threshold for load-aware reassignment (0 to disable)
 * @param {number} [minGap=2] - Minimum load difference to trigger reassignment
 * @param {object} [dynamicWeightConfig] - Dynamic weight configuration
 * @param {object} [timeSlotWeightConfig] - Time slot weight configuration
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamSticky(
  upstreams,
  routeKey,
  sessionId,
  model,
  _threshold = 10,
  _minGap = 2,
  dynamicWeightConfig = null,
  timeSlotWeightConfig = null,
  state = null
) {
  const sm = state ?? stateManager;

  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  _startSessionCleanup(sm);

  const sessionKey = model ? `${sessionId}:${model}` : sessionId;
  const upstreamIdMap = new Map(upstreams.map((u) => [u.id, u]));
  const sessionUpstreamMap = sm.getSessionUpstreamMap();
  const existing = sessionUpstreamMap.get(sessionKey);

  if (existing && existing.routeKey === routeKey) {
    const mapped = upstreamIdMap.get(existing.upstreamId);
    if (mapped) {
      existing.timestamp = Date.now();
      existing.requestCount = (existing.requestCount ?? 0) + 1;

      // Increment global request count FIRST (before checking)
      _incrementUpstreamRequestCount(sm, routeKey, existing.upstreamId);

      // Every 10 requests, check sliding window request counts for soft rotation
      if (existing.requestCount % 10 === 0) {
        // Calculate current upstream's score using sliding window count and effectiveWeight
        const currentRequestCount = _getUpstreamRequestCountInWindow(
          sm,
          routeKey,
          existing.upstreamId
        );
        let currentStaticWeight = mapped.weight ?? 1;

        // Apply time slot weight for current upstream if enabled
        if (timeSlotWeightConfig && timeSlotWeightConfig.enabled) {
          if (!timeSlotCalculator) {
            timeSlotCalculator = createTimeSlotWeightCalculator();
          }
          const timeSlotWeightMultiplier = timeSlotCalculator.getTimeSlotWeight(
            mapped.provider,
            null,
            {
              totalErrorThreshold: timeSlotWeightConfig.totalErrorThreshold,
              dangerSlotThreshold: timeSlotWeightConfig.dangerSlotThreshold,
              dangerMultiplier: timeSlotWeightConfig.dangerMultiplier,
              normalMultiplier: timeSlotWeightConfig.normalMultiplier,
            }
          );
          currentStaticWeight = currentStaticWeight * timeSlotWeightMultiplier;
        }

        let currentEffectiveWeight = currentStaticWeight;

        // Apply dynamic weight for current upstream if enabled
        if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
          const dynWeight = _getDynamicWeight(
            sm,
            routeKey,
            existing.upstreamId,
            dynamicWeightConfig.initialWeight
          );
          currentEffectiveWeight = Math.min(currentStaticWeight, dynWeight);

          // Apply error-based weight penalty if error reduction is enabled
          const errorConfig = dynamicWeightConfig.errorWeightReduction;
          if (errorConfig && errorConfig.enabled) {
            const errorCount = _getErrorRate(
              sm,
              routeKey,
              existing.upstreamId,
              errorConfig.errorWindowMs
            );
            if (errorCount > 0) {
              const errorWeight = Math.max(
                errorConfig.minWeight,
                dynamicWeightConfig.initialWeight - errorCount * errorConfig.reductionAmount
              );
              currentEffectiveWeight = Math.min(currentEffectiveWeight, errorWeight);
            }
          }

          // Apply latency-based weight penalty
          const latencyWindowMs = 60000; // 1 minute
          const avgLatency = _getLatencyAvg(sm, routeKey, existing.upstreamId, latencyWindowMs);
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
              const latencyPenalty = Math.max(
                1,
                Math.floor((avgLatency / fastestLatency - 1) * 10)
              );
              currentEffectiveWeight = Math.max(1, currentEffectiveWeight - latencyPenalty);
            }
          }
        }

        const currentScore = currentRequestCount / currentEffectiveWeight;

        // Find candidate with lowest score (excluding current upstream)
        let minScore = Infinity;
        let minScoreUpstream = null;

        for (const upstream of upstreams) {
          if (upstream.id === existing.upstreamId) continue;

          const requestCount = _getUpstreamRequestCountInWindow(sm, routeKey, upstream.id);
          let staticWeight = upstream.weight ?? 1;

          // Apply time slot weight for candidate upstream if enabled
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
            const dynWeight = _getDynamicWeight(
              sm,
              routeKey,
              upstream.id,
              dynamicWeightConfig.initialWeight
            );
            effectiveWeight = Math.min(staticWeight, dynWeight);

            // Apply error-based weight penalty if error reduction is enabled
            const errorConfig = dynamicWeightConfig.errorWeightReduction;
            if (errorConfig && errorConfig.enabled) {
              const errorCount = _getErrorRate(
                sm,
                routeKey,
                upstream.id,
                errorConfig.errorWindowMs
              );
              if (errorCount > 0) {
                const errorWeight = Math.max(
                  errorConfig.minWeight,
                  dynamicWeightConfig.initialWeight - errorCount * errorConfig.reductionAmount
                );
                effectiveWeight = Math.min(effectiveWeight, errorWeight);
              }
            }

            // Apply latency-based weight penalty
            const latencyWindowMs = 60000; // 1 minute
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
                const latencyPenalty = Math.max(
                  1,
                  Math.floor((avgLatency / fastestLatency - 1) * 10)
                );
                effectiveWeight = Math.max(1, effectiveWeight - latencyPenalty);
              }
            }
          }

          const score = requestCount / effectiveWeight;

          if (score < minScore) {
            minScore = score;
            minScoreUpstream = upstream;
          }
        }

        // Switch if candidate has lower score than current
        if (minScoreUpstream && minScore < currentScore) {
          _decrementSessionCount(sm, routeKey, existing.upstreamId);
          _incrementSessionCount(sm, routeKey, minScoreUpstream.id);
          existing.upstreamId = minScoreUpstream.id;
          existing.requestCount = 1; // Reset count after switch
        }
        // Otherwise keep accumulating requestCount
      }

      return upstreamIdMap.get(existing.upstreamId) ?? mapped;
    }
  }

  const selected = _selectLeastLoadedUpstream(
    sm,
    upstreams,
    routeKey,
    dynamicWeightConfig,
    timeSlotWeightConfig
  );
  _incrementSessionCount(sm, routeKey, selected.id);
  _incrementUpstreamRequestCount(sm, routeKey, selected.id);

  sessionUpstreamMap.set(sessionKey, {
    upstreamId: selected.id,
    routeKey,
    timestamp: Date.now(),
    requestCount: 1,
  });

  return selected;
}

/**
 * Route a request to an upstream based on model and configuration
 * @param {string} model - Virtual model name from the request
 * @param {RoutesConfig} config - Routes configuration object
 * @param {import('node:http').IncomingMessage} [request] - HTTP request (needed for sticky strategy)
 * @param {object} [body] - Parsed request body (for session ID extraction)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {{ upstream: Upstream, route: Route, routeKey: string, sessionId?: string }} Selected upstream and route info
 * @throws {RouterError} If model is not found in routes
 */
export function routeRequest(model, config, request, body = null, state = null) {
  const sm = state ?? stateManager;
  const route = getRouteForModel(model, config);

  if (!route) {
    const availableModels = Object.keys(config || {});

    throw new RouterError(`Unknown model: ${model}`, 'UNKNOWN_MODEL', {
      requestedModel: model,
      availableModels,
    });
  }

  const validationResult = routeSchema.safeParse(route);
  if (!validationResult.success) {
    throw new RouterError(
      `Invalid route configuration for model: ${model}`,
      'INVALID_ROUTE_CONFIG',
      {
        errors: validationResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      }
    );
  }

  const validatedRoute = validationResult.data;
  const {
    upstreams,
    strategy,
    stickyReassignThreshold,
    stickyReassignMinGap,
    dynamicWeight,
    timeSlotWeight,
  } = validatedRoute;
  let selectedUpstream;
  let sessionId;

  switch (strategy) {
    case 'sticky':
      sessionId = request ? getSessionId(request, body, sm) : `auto_${Date.now()}`;
      selectedUpstream = selectUpstreamSticky(
        upstreams,
        model,
        sessionId,
        model,
        stickyReassignThreshold,
        stickyReassignMinGap,
        dynamicWeight,
        timeSlotWeight,
        sm
      );
      break;
    case 'round-robin':
      selectedUpstream = selectUpstreamRoundRobin(upstreams, model, sm);
      break;
    case 'random':
      selectedUpstream = selectUpstreamRandom(upstreams, sm);
      break;
    case 'weighted':
      selectedUpstream = selectUpstreamWeighted(upstreams, sm);
      break;
    default:
      selectedUpstream = selectUpstreamRoundRobin(upstreams, model, sm);
  }

  const result = {
    upstream: selectedUpstream,
    route,
    routeKey: model,
  };

  if (sessionId) {
    result.sessionId = sessionId;
  }

  // Only increment for non-sticky strategies (sticky already increments in selectUpstreamSticky)
  if (strategy !== 'sticky') {
    _incrementUpstreamRequestCount(sm, model, selectedUpstream.id);
  }

  return result;
}

/**
 * Get list of available virtual model names from config
 * @param {RoutesConfig} config - Routes configuration object
 * @returns {string[]} Array of available model names
 */
export function getAvailableModels(config) {
  if (!config || typeof config !== 'object') {
    return [];
  }
  return Object.keys(config);
}

/**
 * Validate routes configuration
 * @param {unknown} config - Configuration to validate
 * @returns {{ success: boolean, data?: RoutesConfig, error?: string }}
 */
export function validateRoutesConfig(config) {
  try {
    const data = routesConfigSchema.parse(config);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Reset round-robin counters and session mappings (useful for testing)
 * @param {StateManager} [state] - Optional state manager instance
 */
export function resetRoundRobinCounters(state = null) {
  const sm = state ?? stateManager;
  sm.getRoundRobinCounters().clear();
  sm.getSessionUpstreamMap().clear();
  sm.getUpstreamSessionCounts().clear();
  sm.getDynamicWeightState().clear();
  _resetStats(sm);
  for (const timer of sm.getRecoveryTimers().values()) {
    clearInterval(timer);
  }
  sm.getRecoveryTimers().clear();
  _stopSessionCleanup(sm);
}

/**
 * Get current session → upstream mapping size (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number}
 */
export function getSessionMapSize(state = null) {
  const sm = state ?? stateManager;
  return sm.getSessionUpstreamMap().size;
}

/**
 * Get current session → upstream mapping (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, { upstreamId: string, routeKey: string, timestamp: number, requestCount: number }>}
 */
export function getSessionUpstreamMap(state = null) {
  const sm = state ?? stateManager;
  return sm.getSessionUpstreamMap();
}

/**
 * Get current upstream session counts (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamSessionCounts(state = null) {
  const sm = state ?? stateManager;
  return sm.getUpstreamSessionCounts();
}

/**
 * Failover sticky session wrapper (pass through to failover-handler with state)
 * @param {string} sessionId
 * @param {string} failedUpstreamId
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @param {string} [model]
 * @param {Function} [isAvailable]
 * @param {StateManager} [state]
 * @returns {Upstream | null}
 */
export function failoverStickySession(
  sessionId,
  failedUpstreamId,
  upstreams,
  routeKey,
  model,
  isAvailable,
  state = null
) {
  const sm = state ?? stateManager;
  return _failoverStickySession(
    sessionId,
    failedUpstreamId,
    upstreams,
    routeKey,
    model,
    isAvailable,
    sm
  );
}

export { timeSlotCalculator };

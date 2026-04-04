/**
 * Router module for proxy - handles virtual model name mapping and upstream selection
 * @module proxy/router
 */

import { z } from 'zod';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { RouterError } from './errors.js';
import { getDynamicWeight, dynamicWeightState, recoveryTimers } from './weight-manager.js';
import {
  getSessionId,
  sessionUpstreamMap,
  upstreamSessionCounts,
  startSessionCleanup,
  stopSessionCleanup,
  incrementSessionCount,
  decrementSessionCount,
} from './session-manager.js';
import {
  selectUpstreamRoundRobin,
  selectUpstreamRandom,
  selectUpstreamWeighted,
  selectLeastLoadedUpstream,
  roundRobinCounters,
} from './route-strategy.js';
import {
  recordUpstreamStats,
  getUpstreamStats,
  getErrorRate,
  getLatencyAvg,
  getUpstreamRequestCountInWindow,
  incrementUpstreamRequestCount,
  resetStats,
} from './stats-collector.js';

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

export { getSessionId, hashSessionToBackend } from './session-manager.js';
export {
  selectUpstreamRoundRobin,
  selectUpstreamRandom,
  selectUpstreamWeighted,
} from './route-strategy.js';
export { timeSlotCalculator };

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
  timeSlotWeightConfig = null
) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  startSessionCleanup();

  const sessionKey = model ? `${sessionId}:${model}` : sessionId;
  const upstreamIdMap = new Map(upstreams.map((u) => [u.id, u]));
  const existing = sessionUpstreamMap.get(sessionKey);

  if (existing && existing.routeKey === routeKey) {
    const mapped = upstreamIdMap.get(existing.upstreamId);
    if (mapped) {
      existing.timestamp = Date.now();
      existing.requestCount = (existing.requestCount ?? 0) + 1;

      // Increment global request count FIRST (before checking)
      incrementUpstreamRequestCount(routeKey, existing.upstreamId);

      // Every 10 requests, check sliding window request counts for soft rotation
      if (existing.requestCount % 10 === 0) {
        // Calculate current upstream's score using sliding window count and effectiveWeight
        const currentRequestCount = getUpstreamRequestCountInWindow(routeKey, existing.upstreamId);
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
          const dynWeight = getDynamicWeight(
            routeKey,
            existing.upstreamId,
            dynamicWeightConfig.initialWeight
          );
          currentEffectiveWeight = Math.min(currentStaticWeight, dynWeight);

          // Apply error-based weight penalty if error reduction is enabled
          const errorConfig = dynamicWeightConfig.errorWeightReduction;
          if (errorConfig && errorConfig.enabled) {
            const errorCount = getErrorRate(
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
          const avgLatency = getLatencyAvg(routeKey, existing.upstreamId, latencyWindowMs);
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

          const requestCount = getUpstreamRequestCountInWindow(routeKey, upstream.id);
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
            const dynWeight = getDynamicWeight(
              routeKey,
              upstream.id,
              dynamicWeightConfig.initialWeight
            );
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
            const latencyWindowMs = 60000; // 1 minute
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
          decrementSessionCount(routeKey, existing.upstreamId);
          incrementSessionCount(routeKey, minScoreUpstream.id);
          existing.upstreamId = minScoreUpstream.id;
          existing.requestCount = 1; // Reset count after switch
        }
        // Otherwise keep accumulating requestCount
      }

      return upstreamIdMap.get(existing.upstreamId) ?? mapped;
    }
  }

  const selected = selectLeastLoadedUpstream(
    upstreams,
    routeKey,
    dynamicWeightConfig,
    timeSlotWeightConfig
  );
  incrementSessionCount(routeKey, selected.id);
  incrementUpstreamRequestCount(routeKey, selected.id);

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
 * @returns {{ upstream: Upstream, route: Route, routeKey: string, sessionId?: string }} Selected upstream and route info
 * @throws {RouterError} If model is not found in routes
 */
export function routeRequest(model, config, request, body = null) {
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
      sessionId = request ? getSessionId(request, body) : `auto_${Date.now()}`;
      selectedUpstream = selectUpstreamSticky(
        upstreams,
        model,
        sessionId,
        model,
        stickyReassignThreshold,
        stickyReassignMinGap,
        dynamicWeight,
        timeSlotWeight
      );
      break;
    case 'round-robin':
      selectedUpstream = selectUpstreamRoundRobin(upstreams, model);
      break;
    case 'random':
      selectedUpstream = selectUpstreamRandom(upstreams);
      break;
    case 'weighted':
      selectedUpstream = selectUpstreamWeighted(upstreams);
      break;
    default:
      selectedUpstream = selectUpstreamRoundRobin(upstreams, model);
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
    incrementUpstreamRequestCount(model, selectedUpstream.id);
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
 */
export function resetRoundRobinCounters() {
  roundRobinCounters.clear();
  sessionUpstreamMap.clear();
  upstreamSessionCounts.clear();
  dynamicWeightState.clear();
  resetStats();
  recoveryTimers.forEach((timer) => clearInterval(timer));
  recoveryTimers.clear();
  stopSessionCleanup();
}

/**
 * Get current session → upstream mapping size (useful for testing/monitoring)
 * @returns {number}
 */
export function getSessionMapSize() {
  return sessionUpstreamMap.size;
}

/**
 * Get current session → upstream mapping (useful for testing/monitoring)
 * @returns {Map<string, { upstreamId: string, routeKey: string, timestamp: number, requestCount: number }>}
 */
export function getSessionUpstreamMap() {
  return sessionUpstreamMap;
}

/**
 * Get current upstream session counts (useful for testing/monitoring)
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamSessionCounts() {
  return upstreamSessionCounts;
}

/**
 * Get current dynamic weight state (useful for testing/monitoring)
 * @returns {Map<string, { currentWeight: number, lastAdjustment: number, requestCount: number }>}
 */
export function getDynamicWeightState() {
  return dynamicWeightState;
}

/**
 * Get current recovery timers (useful for testing/monitoring)
 * @returns {Map<string, NodeJS.Timeout>}
 */
export function getRecoveryTimers() {
  return recoveryTimers;
}

export {
  getDynamicWeight,
  setDynamicWeight,
  adjustWeightForLatency,
  adjustWeightForError,
  startWeightRecovery,
  stopWeightRecovery,
} from './weight-manager.js';

export { getUpstreamStats, recordUpstreamStats };

export {
  recordUpstreamError,
  getErrorRate,
  getErrorState,
  recordUpstreamLatency,
  getLatencyAvg,
  getUpstreamRequestCountInWindow,
  getLatencyState,
  incrementUpstreamRequestCount,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
} from './stats-collector.js';

export { failoverStickySession } from './failover-handler.js';

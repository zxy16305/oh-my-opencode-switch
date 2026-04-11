/**
 * Router module for proxy - handles virtual model name mapping and upstream selection
 * @module proxy/router
 */

import { z } from 'zod';
import logger from '../utils/logger.js';
import { RouterError } from './errors.js';
import { stateManager } from './state-manager.js';
import { routeSchema, routesConfigSchema } from './schemas.js';

// Session-manager: state-taking functions used internally, pure functions re-exported
import {
  getSessionId,
  startSessionCleanup,
  stopSessionCleanup,
  incrementSessionCount,
  decrementSessionCount,
} from './session-manager.js';

// Route-strategy: used internally only (no wrapper needed)
import { selectLeastLoadedUpstream } from './route-strategy.js';
import { calculateEffectiveWeight, calculateLeastLoadedScore } from './weight-calculator.js';
import { WeightManager } from './weight/index.js';

// Stats-collector: namespace import to avoid name collision with exported wrappers
import * as stats from './stats-collector.js';

// Failover-handler: namespace import to avoid name collision with exported wrapper
import * as failover from './failover-handler.js';

const weightManager = new WeightManager();

export { RouterError } from './errors.js';
export { getSessionId, hashSessionToBackend } from './session-manager.js';

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

// --- Stats wrappers (state moved from first to last param for external consumers) ---

export function recordUpstreamError(routeKey, upstreamId, statusCode, state = null) {
  const sm = state ?? stateManager;
  stats.recordUpstreamError(sm, routeKey, upstreamId, statusCode);
}

export function recordUpstreamLatency(routeKey, upstreamId, ttfb, duration, state = null) {
  const sm = state ?? stateManager;
  stats.recordUpstreamLatency(sm, routeKey, upstreamId, ttfb, duration);
}

export function getUpstreamRequestCountInWindow(
  routeKey,
  upstreamId,
  windowMs = 3600000,
  state = null
) {
  const sm = state ?? stateManager;
  return stats.getUpstreamRequestCountInWindow(sm, routeKey, upstreamId, windowMs);
}

export function incrementUpstreamRequestCount(routeKey, upstreamId, state = null) {
  const sm = state ?? stateManager;
  stats.incrementUpstreamRequestCount(sm, routeKey, upstreamId);
}

export function getUpstreamRequestCounts(state = null) {
  const sm = state ?? stateManager;
  return stats.getUpstreamRequestCounts(sm);
}

export function getUpstreamSlidingWindowCounts(state = null) {
  const sm = state ?? stateManager;
  return stats.getUpstreamSlidingWindowCounts(sm);
}

export function recordUpstreamStats(
  routeKey,
  upstreamId,
  ttfb,
  duration,
  isError = false,
  state = null
) {
  const sm = state ?? stateManager;
  stats.recordUpstreamStats(sm, routeKey, upstreamId, ttfb, duration, isError);
}

export function getUpstreamStats(routeKey, upstreamId, state = null) {
  const sm = state ?? stateManager;
  return stats.getUpstreamStats(sm, routeKey, upstreamId);
}

// --- Core routing logic ---

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
  _timeSlotWeightConfig = null,
  state = null
) {
  const sm = state ?? stateManager;

  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    const selected = upstreams[0];
    startSessionCleanup(sm);
    incrementSessionCount(sm, routeKey, selected.id);
    stats.incrementUpstreamRequestCount(sm, routeKey, selected.id);

    const sessionKey = model ? `${sessionId}:${model}` : sessionId;
    const sessionUpstreamMap = sm.sessionMap;
    sessionUpstreamMap.set(sessionKey, {
      upstreamId: selected.id,
      routeKey,
      timestamp: Date.now(),
      requestCount: 1,
    });

    return selected;
  }

  startSessionCleanup(sm);

  const sessionKey = model ? `${sessionId}:${model}` : sessionId;
  const upstreamIdMap = new Map(upstreams.map((u) => [u.id, u]));
  const sessionUpstreamMap = sm.sessionMap;
  const existing = sessionUpstreamMap.get(sessionKey);

  if (existing && existing.routeKey === routeKey) {
    const mapped = upstreamIdMap.get(existing.upstreamId);
    if (mapped) {
      existing.timestamp = Date.now();
      existing.requestCount = (existing.requestCount ?? 0) + 1;

      stats.incrementUpstreamRequestCount(sm, routeKey, existing.upstreamId);

      // Every 10 requests, check sliding window request counts for soft rotation
      if (existing.requestCount % 10 === 0) {
        const requestCounts = new Map();
        for (const upstream of upstreams) {
          requestCounts.set(
            upstream.id,
            stats.getUpstreamRequestCountInWindow(sm, routeKey, upstream.id)
          );
        }

        const effectiveWeights = new Map();
        for (const upstream of upstreams) {
          const ew = calculateEffectiveWeight({
            sm,
            routeKey,
            upstream,
            staticWeight: weightManager.getConfiguredWeight(upstream),
            dynamicWeightConfig,
            weightManager,
          });
          effectiveWeights.set(upstream.id, ew);
        }

        const currentRequestCount = requestCounts.get(existing.upstreamId);
        const currentEffectiveWeight = effectiveWeights.get(existing.upstreamId);
        const currentScore = calculateLeastLoadedScore(currentRequestCount, currentEffectiveWeight);

        let minScore = Infinity;
        let minScoreUpstream = null;

        for (const upstream of upstreams) {
          if (upstream.id === existing.upstreamId) continue;

          const requestCount = requestCounts.get(upstream.id);
          const effectiveWeight = effectiveWeights.get(upstream.id);
          const score = calculateLeastLoadedScore(requestCount, effectiveWeight);

          if (score < minScore) {
            minScore = score;
            minScoreUpstream = upstream;
          }
        }

        if (minScoreUpstream && minScore < currentScore) {
          decrementSessionCount(sm, routeKey, existing.upstreamId);
          incrementSessionCount(sm, routeKey, minScoreUpstream.id);
          existing.upstreamId = minScoreUpstream.id;
          existing.requestCount = 1;
        }
      }

      return upstreamIdMap.get(existing.upstreamId) ?? mapped;
    }
  }

  const selected = selectLeastLoadedUpstream(
    sm,
    upstreams,
    routeKey,
    dynamicWeightConfig,
    weightManager
  );
  incrementSessionCount(sm, routeKey, selected.id);
  stats.incrementUpstreamRequestCount(sm, routeKey, selected.id);

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

  const {
    upstreams,
    stickyReassignThreshold,
    stickyReassignMinGap,
    dynamicWeight,
    timeSlotWeight,
  } = route;

  if (route.strategy && route.strategy !== 'sticky') {
    logger.warn(
      `Route '${model}' has strategy='${route.strategy}' but only 'sticky' is supported. Ignoring.`
    );
  }

  const sessionId = request ? getSessionId(request, body) : `auto_${Date.now()}`;
  const selectedUpstream = selectUpstreamSticky(
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

  const result = {
    upstream: selectedUpstream,
    route,
    routeKey: model,
  };

  if (sessionId) {
    result.sessionId = sessionId;
  }

  return result;
}

export { calculateEffectiveWeight } from './weight-calculator.js';
export { weightManager };

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
 * Validate a single route configuration
 * @param {unknown} route - Route configuration to validate
 * @returns {{ valid: boolean, data?: Route, error?: string }}
 */
export function validateRoute(route) {
  try {
    const data = routeSchema.parse(route);
    return { valid: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
    }
    return { valid: false, error: error.message };
  }
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
export function resetAllState(state = null) {
  const sm = state ?? stateManager;
  sm.roundRobinCounters.clear();
  sm.sessionMap.clear();
  sm.upstreamSessionCounts.clear();
  stats.resetStats(sm);
  stopSessionCleanup(sm);
}

/**
 * Get current session ↦ upstream mapping size (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number}
 */
export function getSessionMapSize(state = null) {
  const sm = state ?? stateManager;
  return sm.sessionMap.size;
}

/**
 * Get current session ↦ upstream mapping (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, { upstreamId: string, routeKey: string, timestamp: number, requestCount: number }>}
 */
export function getSessionUpstreamMap(state = null) {
  const sm = state ?? stateManager;
  return sm.sessionMap;
}

/**
 * Get current upstream session counts (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamSessionCounts(state = null) {
  const sm = state ?? stateManager;
  return sm.upstreamSessionCounts;
}

export function failoverStickySession(
  sessionId,
  failedUpstreamId,
  upstreams,
  routeKey,
  model,
  isAvailable,
  state = null,
  _weightManager = null
) {
  const sm = state ?? stateManager;
  const wm = _weightManager ?? weightManager;
  return failover.failoverStickySession(
    sessionId,
    failedUpstreamId,
    upstreams,
    routeKey,
    model,
    isAvailable,
    sm,
    wm
  );
}

/**
 * Router module for proxy - handles virtual model name mapping and upstream selection
 * @module proxy/router
 */

import { z } from 'zod';
import { RouterError } from './errors.js';
import { stateManager } from './state-manager.js';
import { routeSchema, routesConfigSchema } from './schemas.js';

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
import { selectLeastLoadedUpstream as _selectLeastLoadedUpstream } from './route-strategy.js';
import { calculateEffectiveWeight, setWeightManager } from './weight-calculator.js';
import { WeightManager } from './weight/index.js';

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

const weightManager = new WeightManager();
setWeightManager(weightManager);

export { RouterError } from './errors.js';

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
export function getSessionId(request, body = null, _state = null) {
  return _getSessionId(request, body);
}

/**
 * Hash session to backend (wrapper with optional state param)
 * @param {string} sessionId - Session ID
 * @param {number} backendCount - Number of backends
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number} Backend index
 */
export function hashSessionToBackend(sessionId, backendCount, _state = null) {
  return _hashSessionToBackend(sessionId, backendCount);
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
    const selected = upstreams[0];
    _startSessionCleanup(sm);
    _incrementSessionCount(sm, routeKey, selected.id);
    _incrementUpstreamRequestCount(sm, routeKey, selected.id);

    const sessionKey = model ? `${sessionId}:${model}` : sessionId;
    const sessionUpstreamMap = sm.getSessionUpstreamMap();
    sessionUpstreamMap.set(sessionKey, {
      upstreamId: selected.id,
      routeKey,
      timestamp: Date.now(),
      requestCount: 1,
    });

    return selected;
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
        // Batch-read all sliding window counts ONCE to avoid repeated state map lookups
        const requestCounts = new Map();
        for (const upstream of upstreams) {
          requestCounts.set(
            upstream.id,
            _getUpstreamRequestCountInWindow(sm, routeKey, upstream.id)
          );
        }

        // Cache effectiveWeight calculations — compute once per upstream per recalculation cycle
        const effectiveWeights = new Map();
        for (const upstream of upstreams) {
          const ew = calculateEffectiveWeight({
            sm,
            routeKey,
            upstream,
            staticWeight: weightManager.getConfiguredWeight(upstream),
            dynamicWeightConfig,
            timeSlotWeightConfig,
            upstreams,
          });
          effectiveWeights.set(upstream.id, ew);
        }

        // Calculate current upstream's score using cached values
        const currentRequestCount = requestCounts.get(existing.upstreamId);
        const currentEffectiveWeight = effectiveWeights.get(existing.upstreamId);
        const currentScore = (currentRequestCount + 1) / currentEffectiveWeight;

        // Find candidate with lowest score (excluding current upstream)
        let minScore = Infinity;
        let minScoreUpstream = null;

        for (const upstream of upstreams) {
          if (upstream.id === existing.upstreamId) continue;

          const requestCount = requestCounts.get(upstream.id);
          const effectiveWeight = effectiveWeights.get(upstream.id);
          const score = (requestCount + 1) / effectiveWeight;

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

  const {
    upstreams,
    stickyReassignThreshold,
    stickyReassignMinGap,
    dynamicWeight,
    timeSlotWeight,
  } = route;
  const strategy = 'sticky';
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
    default:
      throw new RouterError(
        `Unknown strategy '${strategy}'. Use 'sticky' strategy.`,
        'UNKNOWN_STRATEGY',
        { requestedStrategy: strategy, supportedStrategies: ['sticky'] }
      );
  }

  const result = {
    upstream: selectedUpstream,
    route,
    routeKey: model,
  };

  if (sessionId) {
    result.sessionId = sessionId;
  }

  // Sticky strategy already increments in selectUpstreamSticky

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
  sm.getRoundRobinCounters().clear();
  sm.getSessionUpstreamMap().clear();
  sm.getUpstreamSessionCounts().clear();
  _resetStats(sm);
  _stopSessionCleanup(sm);
}

/**
 * Get current session �?upstream mapping size (useful for testing/monitoring)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {number}
 */
export function getSessionMapSize(state = null) {
  const sm = state ?? stateManager;
  return sm.getSessionUpstreamMap().size;
}

/**
 * Get current session �?upstream mapping (useful for testing/monitoring)
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

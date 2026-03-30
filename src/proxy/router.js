/**
 * Router module for proxy - handles virtual model name mapping and upstream selection
 * @module proxy/router
 */

import { z } from 'zod';

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

/**
 * Router error for invalid model or routing failures
 */
export class RouterError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} [details] - Additional details
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Round-robin state tracker for each route
 * @type {Map<string, number>}
 */
const roundRobinCounters = new Map();

/**
 * Route → Upstream → SessionCount 映射
 * Key: routeKey, Value: Map<upstreamId, sessionCount>
 * @type {Map<string, Map<string, number>>}
 */
const upstreamSessionCounts = new Map();

/**
 * Session → upstream mapping for sticky sessions
 * Key: `${sessionId}:${model}` or `sessionId` (legacy, when model not provided)
 * Value: { upstreamId: string, routeKey: string, timestamp: number, requestCount: number }
 * @type {Map<string, { upstreamId: string, routeKey: string, timestamp: number, requestCount: number }>}
 */
const sessionUpstreamMap = new Map();

/**
 * Dynamic weight state per upstream per route
 * Key: `${routeKey}:${upstreamId}`
 * Value: { currentWeight: number, lastAdjustment: number, requestCount: number }
 * @type {Map<string, { currentWeight: number, lastAdjustment: number, requestCount: number }>}
 */
const dynamicWeightState = new Map();

/**
 * Upstream request counts
 * Key: routeKey (virtual model name)
 * Value: Map<upstreamId, requestCount>
 * @type {Map<string, Map<string, number>>}
 */
const upstreamRequestCounts = new Map();

/**
 * Recovery timers per route
 * Key: routeKey
 * Value: NodeJS.Timeout
 * @type {Map<string, NodeJS.Timeout>}
 */
const recoveryTimers = new Map();

/**
 * 获取或创建 routeKey 的计数映射
 * @param {string} routeKey
 * @returns {Map<string, number>}
 */
function getOrCreateCountMap(routeKey) {
  if (!upstreamSessionCounts.has(routeKey)) {
    upstreamSessionCounts.set(routeKey, new Map());
  }
  return upstreamSessionCounts.get(routeKey);
}

/**
 * 选择负载最低的 upstream（考虑动态权重）
 * effectiveWeight = min(staticWeight, dynamicWeight)
 * score = sessionCount / effectiveWeight（越低越好）
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @param {object} [dynamicWeightConfig] - Optional dynamic weight config
 * @returns {Upstream}
 */
function selectLeastLoadedUpstream(upstreams, routeKey, dynamicWeightConfig = null) {
  const countMap = getOrCreateCountMap(routeKey);

  let bestScore = Infinity;
  let bestUpstream = upstreams[0];

  for (const upstream of upstreams) {
    const sessionCount = countMap.get(upstream.id) ?? 0;
    const staticWeight = upstream.weight ?? 1;

    let effectiveWeight = staticWeight;

    // Apply dynamic weight if enabled
    if (dynamicWeightConfig && dynamicWeightConfig.enabled) {
      const dynWeight = getDynamicWeight(routeKey, upstream.id, dynamicWeightConfig.initialWeight);
      effectiveWeight = Math.min(staticWeight, dynWeight);
    }

    // Score: lower is better (fewer sessions per weight unit)
    const score = sessionCount / effectiveWeight;

    if (score < bestScore) {
      bestScore = score;
      bestUpstream = upstream;
    }
  }

  return bestUpstream;
}

/**
 * 增加 session 计数
 * @param {string} routeKey
 * @param {string} upstreamId
 */
function incrementSessionCount(routeKey, upstreamId) {
  const countMap = getOrCreateCountMap(routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);
}

/**
 * 减少 session 计数
 * @param {string} routeKey
 * @param {string} upstreamId
 */
function decrementSessionCount(routeKey, upstreamId) {
  const countMap = getOrCreateCountMap(routeKey);
  const current = countMap.get(upstreamId) ?? 0;
  if (current > 0) {
    countMap.set(upstreamId, current - 1);
  }
}

/**
 * 获取或创建 routeKey 的上游请求计数映射
 * @param {string} routeKey
 * @returns {Map<string, number>}
 */
function getOrCreateRequestCountMap(routeKey) {
  if (!upstreamRequestCounts.has(routeKey)) {
    upstreamRequestCounts.set(routeKey, new Map());
  }
  return upstreamRequestCounts.get(routeKey);
}

/**
 * 增加上游请求计数
 * @param {string} routeKey
 * @param {string} upstreamId
 */
function incrementUpstreamRequestCount(routeKey, upstreamId) {
  const countMap = getOrCreateRequestCountMap(routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);
}

/**
 * Get or initialize dynamic weight for an upstream
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} initialWeight
 * @returns {number} Current weight
 */
function getDynamicWeight(routeKey, upstreamId, initialWeight = 100) {
  const key = `${routeKey}:${upstreamId}`;
  const state = dynamicWeightState.get(key);
  if (!state) {
    dynamicWeightState.set(key, {
      currentWeight: initialWeight,
      lastAdjustment: Date.now(),
      requestCount: 0,
    });
    return initialWeight;
  }
  return state.currentWeight;
}

/**
 * Set dynamic weight for an upstream
 * @param {string} routeKey
 * @param {string} upstreamId
 * @param {number} weight
 */
function setDynamicWeight(routeKey, upstreamId, weight) {
  const key = `${routeKey}:${upstreamId}`;
  const state = dynamicWeightState.get(key);
  if (state) {
    state.currentWeight = weight;
    state.lastAdjustment = Date.now();
  } else {
    dynamicWeightState.set(key, {
      currentWeight: weight,
      lastAdjustment: Date.now(),
      requestCount: 0,
    });
  }
}

/**
 * Reset all dynamic weights for a route
 * @param {string} routeKey
 * @param {number} initialWeight
 */
function resetDynamicWeights(routeKey, initialWeight = 100) {
  for (const [key, state] of dynamicWeightState) {
    if (key.startsWith(`${routeKey}:`)) {
      state.currentWeight = initialWeight;
      state.lastAdjustment = Date.now();
    }
  }
}

/**
 * Increment request count for dynamic weight check
 * @param {string} routeKey
 * @param {string} upstreamId
 * @returns {number} Updated request count
 */
function incrementDynamicWeightRequestCount(routeKey, upstreamId) {
  const key = `${routeKey}:${upstreamId}`;
  const state = dynamicWeightState.get(key);
  if (state) {
    state.requestCount++;
    return state.requestCount;
  }
  return 0;
}

/**
 * Adjust weights based on latency comparison
 * Compares each upstream's avgDuration to the fastest upstream
 * Decreases weight by 1 if latency > fastest * latencyThreshold
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @param {Map<string, {avgDuration: number}>} latencyData - upstream latency data
 */
function adjustWeightForLatency(routeKey, upstreams, config, latencyData) {
  if (!upstreams || upstreams.length <= 1) return;

  const { minWeight, latencyThreshold, initialWeight } = config;

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

    const currentWeight = getDynamicWeight(routeKey, upstream.id, initialWeight);

    // Skip if already at min weight
    if (currentWeight <= minWeight) continue;

    // Decrease weight if latency exceeds threshold
    if (data.avgDuration > fastestDuration * latencyThreshold) {
      setDynamicWeight(routeKey, upstream.id, Math.max(minWeight, currentWeight - 1));
    }
  }
}

/**
 * Start periodic weight recovery for a route
 * @param {string} routeKey
 * @param {Upstream[]} upstreams
 * @param {object} config - dynamicWeight config
 * @returns {NodeJS.Timeout} Timer ID for cleanup
 */
function startWeightRecovery(routeKey, upstreams, config) {
  if (!routeKey || !upstreams || upstreams.length === 0 || !config) {
    return null;
  }

  if (!config.enabled || !config.recoveryInterval || config.recoveryInterval <= 0) {
    return null;
  }

  stopWeightRecovery(routeKey);

  const { recoveryInterval, recoveryAmount, initialWeight } = config;

  const timer = setInterval(() => {
    for (const upstream of upstreams) {
      const currentWeight = getDynamicWeight(routeKey, upstream.id, initialWeight);
      if (currentWeight < initialWeight) {
        setDynamicWeight(
          routeKey,
          upstream.id,
          Math.min(initialWeight, currentWeight + recoveryAmount)
        );
      }
    }
  }, recoveryInterval);

  // Store timer for cleanup
  recoveryTimers.set(routeKey, timer);

  // Unref to allow process exit
  if (timer.unref) {
    timer.unref();
  }

  return timer;
}

/**
 * Stop weight recovery timer for a route
 * @param {string} routeKey
 */
function stopWeightRecovery(routeKey) {
  const timer = recoveryTimers.get(routeKey);
  if (timer) {
    clearInterval(timer);
    recoveryTimers.delete(routeKey);
  }
}

/** Default TTL for session mappings (30 minutes) */
const SESSION_MAP_TTL_MS = 30 * 60 * 1000;

/** Interval for cleaning expired session mappings */
let cleanupInterval = null;

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
 * Select upstream using round-robin strategy
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @param {string} routeKey - Route key for counter tracking
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRoundRobin(upstreams, routeKey) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  let counter = roundRobinCounters.get(routeKey) ?? 0;
  const selectedIndex = counter % upstreams.length;
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  roundRobinCounters.set(routeKey, counter);

  return upstreams[selectedIndex];
}

/**
 * Select upstream using random strategy
 * @param {Upstream[]} upstreams - Array of available upstreams
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamRandom(upstreams) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  const randomIndex = Math.floor(Math.random() * upstreams.length);
  return upstreams[randomIndex];
}

/**
 * Select upstream using weighted strategy
 * @param {Upstream[]} upstreams - Array of available upstreams with optional weights
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamWeighted(upstreams) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  const totalWeight = upstreams.reduce((sum, u) => sum + (u.weight ?? 1), 0);
  let random = Math.random() * totalWeight;

  for (const upstream of upstreams) {
    random -= upstream.weight ?? 1;
    if (random <= 0) {
      return upstream;
    }
  }

  return upstreams[upstreams.length - 1];
}

/**
 * Extract session ID from request body and headers for sticky routing.
 * Priority: body.sessionId → body.conversationId → x-opencode-session → x-session-affinity → client IP hash
 * @param {import('node:http').IncomingMessage} request - HTTP request
 * @param {object} [body] - Parsed request body (optional)
 * @returns {string} Session ID
 */
export function getSessionId(request, body = null) {
  if (body && typeof body === 'object') {
    const sessionIdFields = [
      'sessionId',
      'session_id',
      'conversationId',
      'conversation_id',
      'threadId',
      'thread_id',
    ];
    for (const field of sessionIdFields) {
      if (body[field] && typeof body[field] === 'string') {
        return body[field];
      }
    }
  }

  const headers = request.headers ?? {};

  const opencodeSession = headers['x-opencode-session'];
  if (opencodeSession && typeof opencodeSession === 'string') {
    return opencodeSession;
  }

  const sessionAffinity = headers['x-session-affinity'];
  if (sessionAffinity && typeof sessionAffinity === 'string') {
    return sessionAffinity;
  }

  const clientIp =
    headers['x-forwarded-for']?.split(',')[0]?.trim() ?? request.socket?.remoteAddress ?? 'unknown';
  return `ip_${simpleHash(clientIp)}`;
}

/**
 * Simple deterministic hash for string input
 * @param {string} str
 * @returns {string}
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Consistent hash: map a session ID to a backend index
 * @param {string} sessionId
 * @param {number} backendCount
 * @returns {number} Backend index in range [0, backendCount)
 */
export function hashSessionToBackend(sessionId, backendCount) {
  if (backendCount <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash << 5) - hash + sessionId.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % backendCount;
}

/**
 * Start periodic cleanup of expired session mappings
 * @param {number} [intervalMs=60000] - Cleanup interval
 */
function startSessionCleanup(intervalMs = 60_000) {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of sessionUpstreamMap) {
      if (now - entry.timestamp > SESSION_MAP_TTL_MS) {
        decrementSessionCount(entry.routeKey, entry.upstreamId);
        sessionUpstreamMap.delete(sessionId);
      }
    }
  }, intervalMs);
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }
}

/**
 * Stop session cleanup timer
 */
function stopSessionCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
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
 * @param {Map<string, {avgDuration: number}>} [latencyData] - Upstream latency data
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamSticky(
  upstreams,
  routeKey,
  sessionId,
  model,
  threshold = 10,
  minGap = 2,
  dynamicWeightConfig = null,
  latencyData = null
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

      // Every 10 requests, check global request counts for soft rotation
      if (existing.requestCount % 10 === 0) {
        const requestCounts = getUpstreamRequestCounts();
        const routeRequestCounts = requestCounts.get(routeKey);

        // Get current upstream's global request count
        const currentRequestCount = routeRequestCounts?.get(existing.upstreamId) ?? 0;

        // Find candidate with fewest requests (excluding current upstream)
        let minRequestCount = Infinity;
        let minRequestUpstream = null;

        for (const upstream of upstreams) {
          if (upstream.id === existing.upstreamId) continue;
          const count = routeRequestCounts?.get(upstream.id) ?? 0;
          if (count < minRequestCount) {
            minRequestCount = count;
            minRequestUpstream = upstream;
          }
        }

        // Switch if candidate has fewer requests than current
        if (minRequestUpstream && minRequestCount < currentRequestCount) {
          decrementSessionCount(routeKey, existing.upstreamId);
          incrementSessionCount(routeKey, minRequestUpstream.id);
          existing.upstreamId = minRequestUpstream.id;
          existing.requestCount = 1; // Reset count after switch
        }
        // Otherwise keep accumulating requestCount
      }

      // Dynamic weight adjustment based on latency
      if (
        dynamicWeightConfig &&
        dynamicWeightConfig.enabled &&
        latencyData &&
        dynamicWeightConfig.checkInterval > 0 &&
        existing.requestCount % dynamicWeightConfig.checkInterval === 0
      ) {
        adjustWeightForLatency(routeKey, upstreams, dynamicWeightConfig, latencyData);
      }

      return upstreamIdMap.get(existing.upstreamId) ?? mapped;
    }
  }

  const selected = selectLeastLoadedUpstream(upstreams, routeKey, dynamicWeightConfig);
  incrementSessionCount(routeKey, selected.id);

  sessionUpstreamMap.set(sessionKey, {
    upstreamId: selected.id,
    routeKey,
    timestamp: Date.now(),
    requestCount: 1,
  });

  return selected;
}

/**
 * Mark an upstream as failed for sticky routing and remap the session.
 * Call this when a proxied request to the sticky upstream fails.
 * @param {string} sessionId
 * @param {string} failedUpstreamId
 * @param {Upstream[]} upstreams - All available upstreams for the route
 * @param {string} routeKey
 * @param {string} [model] - Model name for session key (optional, for consistency with selectUpstreamSticky)
 * @returns {Upstream | null} Next available upstream, or null if none
 */
export function failoverStickySession(sessionId, failedUpstreamId, upstreams, routeKey, model) {
  if (!upstreams || upstreams.length === 0) return null;

  const available = upstreams.filter((u) => u.id !== failedUpstreamId);
  if (available.length === 0) return null;

  decrementSessionCount(routeKey, failedUpstreamId);

  const next = selectLeastLoadedUpstream(available, routeKey, null);
  incrementSessionCount(routeKey, next.id);

  const sessionKey = model ? `${sessionId}:${model}` : sessionId;
  sessionUpstreamMap.set(sessionKey, {
    upstreamId: next.id,
    routeKey,
    timestamp: Date.now(),
    requestCount: 1,
  });

  return next;
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
  const { upstreams, strategy, stickyReassignThreshold, stickyReassignMinGap, dynamicWeight } =
    validatedRoute;
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
        null
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

  incrementUpstreamRequestCount(model, selectedUpstream.id);

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
  upstreamRequestCounts.clear();
  dynamicWeightState.clear();
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
 * Get current upstream request counts (useful for testing/monitoring)
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamRequestCounts() {
  return upstreamRequestCounts;
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
  startWeightRecovery,
  stopWeightRecovery,
};

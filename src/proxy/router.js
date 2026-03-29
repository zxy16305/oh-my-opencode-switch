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
 * Key: sessionId, Value: { upstreamId: string, routeKey: string, timestamp: number }
 * @type {Map<string, { upstreamId: string, routeKey: string, timestamp: number }>}
 */
const sessionUpstreamMap = new Map();

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
 * 选择负载最低的 upstream
 * @param {Upstream[]} upstreams
 * @param {string} routeKey
 * @returns {Upstream}
 */
function selectLeastLoadedUpstream(upstreams, routeKey) {
  const countMap = getOrCreateCountMap(routeKey);

  let minCount = Infinity;
  for (const upstream of upstreams) {
    const count = countMap.get(upstream.id) ?? 0;
    if (count < minCount) {
      minCount = count;
    }
  }

  for (const upstream of upstreams) {
    if ((countMap.get(upstream.id) ?? 0) === minCount) {
      return upstream;
    }
  }

  return upstreams[0];
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
 * @returns {Upstream} Selected upstream
 */
export function selectUpstreamSticky(upstreams, routeKey, sessionId) {
  if (!upstreams || upstreams.length === 0) {
    throw new RouterError('No upstreams available', 'NO_UPSTREAMS');
  }

  if (upstreams.length === 1) {
    return upstreams[0];
  }

  startSessionCleanup();

  const upstreamIdMap = new Map(upstreams.map((u) => [u.id, u]));
  const existing = sessionUpstreamMap.get(sessionId);

  if (existing && existing.routeKey === routeKey) {
    const mapped = upstreamIdMap.get(existing.upstreamId);
    if (mapped) {
      existing.timestamp = Date.now();
      return mapped;
    }
  }

  const selected = selectLeastLoadedUpstream(upstreams, routeKey);
  incrementSessionCount(routeKey, selected.id);

  sessionUpstreamMap.set(sessionId, {
    upstreamId: selected.id,
    routeKey,
    timestamp: Date.now(),
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
 * @returns {Upstream | null} Next available upstream, or null if none
 */
export function failoverStickySession(sessionId, failedUpstreamId, upstreams, routeKey) {
  if (!upstreams || upstreams.length === 0) return null;

  const available = upstreams.filter((u) => u.id !== failedUpstreamId);
  if (available.length === 0) return null;

  decrementSessionCount(routeKey, failedUpstreamId);

  const next = selectLeastLoadedUpstream(available, routeKey);
  incrementSessionCount(routeKey, next.id);

  sessionUpstreamMap.set(sessionId, {
    upstreamId: next.id,
    routeKey,
    timestamp: Date.now(),
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

  const { upstreams, strategy } = route;
  let selectedUpstream;
  let sessionId;

  switch (strategy) {
    case 'sticky':
      sessionId = request ? getSessionId(request, body) : `auto_${Date.now()}`;
      selectedUpstream = selectUpstreamSticky(upstreams, model, sessionId);
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
 * Get current upstream session counts (useful for testing/monitoring)
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamSessionCounts() {
  return upstreamSessionCounts;
}

/**
 * Session management module - handles sticky session routing
 * @module proxy/session-manager
 */

/** Default TTL for session mappings (30 minutes) */
const SESSION_MAP_TTL_MS = 30 * 60 * 1000;

/** Interval for cleaning expired session mappings */
let cleanupInterval = null;

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

// Export all functions and state
export {
  SESSION_MAP_TTL_MS,
  cleanupInterval,
  upstreamSessionCounts,
  sessionUpstreamMap,
  getOrCreateCountMap,
  incrementSessionCount,
  decrementSessionCount,
  simpleHash,
  startSessionCleanup,
  stopSessionCleanup,
};

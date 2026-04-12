/**
 * Session management module - handles sticky session routing
 * @module proxy/session-manager
 */

import { stateManager } from './state-manager.js';

/** Default TTL for session mappings (30 minutes) */
export const SESSION_MAP_TTL_MS = 30 * 60 * 1000;

/**
 * Get the StateManager instance to use (provided or singleton)
 * @param {StateManager} [state] - Optional state manager instance
 * @returns {StateManager}
 */
function getState(state) {
  return state ?? stateManager;
}

/**
 * 获取或创建 routeKey 的计数映射
 * @param {StateManager} [state] - State manager instance
 * @param {string} routeKey
 * @returns {Map<string, number>}
 */
export function getOrCreateCountMap(state, routeKey) {
  const sm = getState(state);
  const upstreamSessionCounts = sm.upstreamSessionCounts;
  if (!upstreamSessionCounts.has(routeKey)) {
    upstreamSessionCounts.set(routeKey, new Map());
  }
  return upstreamSessionCounts.get(routeKey);
}

/**
 * 增加 session 计数
 * @param {StateManager} [state] - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 */
export function incrementSessionCount(state, routeKey, upstreamId) {
  const sm = getState(state);
  const countMap = getOrCreateCountMap(sm, routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);
}

/**
 * 减少 session 计数
 * @param {StateManager} [state] - State manager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 */
export function decrementSessionCount(state, routeKey, upstreamId) {
  const sm = getState(state);
  const countMap = getOrCreateCountMap(sm, routeKey);
  const current = countMap.get(upstreamId) ?? 0;
  if (current <= 1) {
    countMap.delete(upstreamId);
    if (countMap.size === 0) {
      sm.upstreamSessionCounts.delete(routeKey);
    }
  } else {
    countMap.set(upstreamId, current - 1);
  }
}

/**
 * Count unique sessions by route and upstream, iterating sessionMap.
 * Returns Map<routeKey, Map<upstreamId, count>> — same shape as upstreamSessionCounts.
 * @param {StateManager} [state] - State manager instance
 * @returns {Map<string, Map<string, number>>}
 */
export function getSessionCountsByRoute(state = null) {
  const sm = getState(state);
  const result = new Map();
  for (const [, entry] of sm.sessionMap) {
    if (!result.has(entry.routeKey)) result.set(entry.routeKey, new Map());
    const routeMap = result.get(entry.routeKey);
    routeMap.set(entry.upstreamId, (routeMap.get(entry.upstreamId) ?? 0) + 1);
  }
  return result;
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
export function simpleHash(str) {
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
 * @param {StateManager} [state] - State manager instance
 * @param {number} [intervalMs=60000] - Cleanup interval
 */
export function startSessionCleanup(state, intervalMs = 60_000) {
  const sm = getState(state);
  if (sm.cleanupInterval) return;

  const interval = setInterval(() => {
    const now = Date.now();
    const sessionUpstreamMap = sm.sessionMap;
    for (const [sessionId, entry] of sessionUpstreamMap) {
      if (now - entry.timestamp > SESSION_MAP_TTL_MS) {
        decrementSessionCount(sm, entry.routeKey, entry.upstreamId);
        sessionUpstreamMap.delete(sessionId);
      }
    }
  }, intervalMs);

  if (interval.unref) {
    interval.unref();
  }

  sm.cleanupInterval = interval;
}

/**
 * Stop session cleanup timer
 * @param {StateManager} [state] - State manager instance
 */
export function stopSessionCleanup(state) {
  const sm = getState(state);
  const interval = sm.cleanupInterval;
  if (interval) {
    clearInterval(interval);
    sm.cleanupInterval = null;
  }
}

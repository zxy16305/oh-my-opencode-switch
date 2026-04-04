/**
 * Failover handler module - handles sticky session failover logic
 * @module proxy/failover-handler
 */

import { logger } from '../utils/logger.js';
import { stateManager } from './state-manager.js';
import { incrementSessionCount, decrementSessionCount } from './session-manager.js';
import { selectLeastLoadedUpstream } from './route-strategy.js';

/**
 * Mark an upstream as failed for sticky routing and remap the session.
 * Call this when a proxied request to the sticky upstream fails.
 * @param {string} sessionId
 * @param {string} failedUpstreamId
 * @param {Upstream[]} upstreams - All available upstreams for the route
 * @param {string} routeKey
 * @param {string} [model] - Model name for session key (optional, for consistency with selectUpstreamSticky)
 * @param {Function} [isAvailable] - Optional callback to check if an upstream is available (returns boolean)
 * @param {import('./state-manager.js').StateManager} [state] - Optional state manager instance
 * @returns {Upstream | null} Next available upstream, or null if none
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

  if (!upstreams || upstreams.length === 0) return null;

  const failedProvider = upstreams.find((u) => u.id === failedUpstreamId);
  if (!failedProvider) return null;

  let available;

  if (isAvailable && typeof isAvailable === 'function') {
    try {
      available = upstreams.filter((u) => u.id !== failedUpstreamId && isAvailable(u.id));
    } catch (error) {
      logger.warn(`isAvailable callback threw error: ${error.message}, skipping filter`);
      available = upstreams.filter((u) => u.id !== failedUpstreamId);
    }
  } else {
    available = upstreams.filter((u) => u.id !== failedUpstreamId);
  }

  if (available.length === 0) {
    logger.warn(`All upstreams filtered out, falling back to failed provider: ${failedUpstreamId}`);
    const sessionKey = model ? `${sessionId}:${model}` : sessionId;
    sm.getSessionUpstreamMap().set(sessionKey, {
      upstreamId: failedProvider.id,
      routeKey,
      timestamp: Date.now(),
      requestCount: 1,
    });
    return failedProvider;
  }

  decrementSessionCount(sm, routeKey, failedUpstreamId);

  const next = selectLeastLoadedUpstream(sm, available, routeKey, null);
  incrementSessionCount(sm, routeKey, next.id);

  const sessionKey = model ? `${sessionId}:${model}` : sessionId;
  sm.getSessionUpstreamMap().set(sessionKey, {
    upstreamId: next.id,
    routeKey,
    timestamp: Date.now(),
    requestCount: 1,
  });

  return next;
}

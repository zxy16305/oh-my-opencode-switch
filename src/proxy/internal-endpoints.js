import {
  getDynamicWeightState,
  getUpstreamSessionCounts,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
  getSessionUpstreamMap,
  getUpstreamStats,
} from './router.js';
import { logger } from '../utils/logger.js';
import { logBuffer } from '../utils/log-buffer.js';
import { onLogAdded } from '../utils/access-log.js';
import { SSE_HEADERS } from './server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

// SSE clients for real-time log streaming
let sseLogCallbackRegistered = false;

/**
 * Setup SSE log callback to push logs to all SSE clients
 * @param {Set} sseClients - Set of SSE client responses
 */
export function setupSSELogCallback(sseClients) {
  if (sseLogCallbackRegistered) {
    return;
  }

  // Register log callback to push to all SSE clients
  onLogAdded((logEntry) => {
    for (const clientRes of sseClients) {
      try {
        clientRes.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        // Explicitly flush to ensure data is sent immediately
        clientRes.flush?.();
      } catch {
        // Remove client if write fails
        sseClients.delete(clientRes);
      }
    }
  });

  sseLogCallbackRegistered = true;
}

/**
 * Handle debug endpoint - return runtime state
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} routes - Resolved routes config
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 */
export function handleDebug(req, res, routes, circuitBreaker) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  const weightState = getDynamicWeightState();
  const sessionCounts = getUpstreamSessionCounts();
  const circuitStates = circuitBreaker?.getStates?.() || new Map();

  const response = {
    timestamp: new Date().toISOString(),
    routes: {},
    circuitBreakers: {},
  };

  for (const [routeName, route] of Object.entries(routes)) {
    response.routes[routeName] = {
      strategy: route.strategy,
      upstreams: (route.upstreams || []).map((upstream) => {
        const key = `${routeName}:${upstream.id}`;
        const weightEntry = weightState.get(key);
        const routeSessions = sessionCounts.get(routeName);
        const sessionCount = routeSessions?.get(upstream.id) ?? 0;

        return {
          id: upstream.id,
          provider: upstream.provider,
          model: upstream.model,
          currentWeight: weightEntry?.currentWeight ?? 100,
          sessionCount,
        };
      }),
    };
  }

  for (const [providerId, state] of circuitStates) {
    response.circuitBreakers[providerId] = {
      state: state.state,
      failures: state.failures,
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response, null, 2));
}

/**
 * Handle stats endpoint - return request statistics
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} routes - Resolved routes config
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 */
export function handleStats(req, res, routes, circuitBreaker) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  const requestCounts = getUpstreamRequestCounts();
  const slidingWindowCounts = getUpstreamSlidingWindowCounts();
  const sessionCounts = getUpstreamSessionCounts();
  const weightState = getDynamicWeightState();
  const sessionMap = getSessionUpstreamMap();

  const sessions = {};
  for (const [sessionKey, entry] of sessionMap) {
    sessions[sessionKey] = {
      upstreamId: entry.upstreamId,
      requestCount: entry.requestCount ?? 0,
      lastAccess: new Date(entry.timestamp).toISOString(),
    };
  }

  const response = {
    timestamp: new Date().toISOString(),
    routes: {},
    sessions,
  };

  for (const [routeName, route] of Object.entries(routes)) {
    response.routes[routeName] = {
      strategy: route.strategy,
      upstreams: (route.upstreams || []).map((upstream) => {
        const key = `${routeName}:${upstream.id}`;
        const routeRequestCounts = requestCounts.get(routeName);
        const routeSlidingCounts = slidingWindowCounts.get(key);
        const routeSessions = sessionCounts.get(routeName);
        const weightEntry = weightState.get(key);
        const stats = getUpstreamStats(routeName, upstream.id);

        const now = Date.now();
        const windowMs = 10 * 60 * 1000;
        const recentRequestCount = routeSlidingCounts
          ? routeSlidingCounts.filter((entry) => now - entry.timestamp <= windowMs).length
          : 0;

        return {
          id: upstream.id,
          provider: upstream.provider,
          model: upstream.model,
          requestCount: routeRequestCounts?.get(upstream.id) ?? 0,
          recentRequestCount,
          sessionCount: routeSessions?.get(upstream.id) ?? 0,
          errorCount: stats.errorCount,
          avgTtfb: stats.avgTtfb,
          ttfbP95: stats.ttfbP95,
          ttfbP99: stats.ttfbP99,
          avgDuration: stats.avgDuration,
          durationP95: stats.durationP95,
          durationP99: stats.durationP99,
          sampleCount: stats.sampleCount,
          currentWeight: weightEntry?.currentWeight ?? upstream.weight ?? 100,
          configuredWeight: upstream.weight ?? 100,
        };
      }),
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response, null, 2));
}

/**
 * Handle dashboard endpoint - return visualization HTML
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleDashboard(req, res) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const templatePath = path.join(__dirname, 'dashboard-template.html');
    const html = await fs.readFile(templatePath, 'utf-8');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    logger.error(`Failed to load dashboard template: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to load dashboard' }));
  }
}

/**
 * Handle SSE logs stream endpoint - return real-time log stream
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Set} sseClients - Set of SSE client responses
 */
export function handleLogsStream(req, res, sseClients) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    ...SSE_HEADERS,
  });

  // Add client to the set
  sseClients.add(res);

  // Push buffered logs to new client
  const bufferedLogs = logBuffer.getAll();
  for (const logEntry of bufferedLogs) {
    res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
  }
  // Flush buffered logs
  res.flush?.();

  // Handle client disconnect
  req.on('close', () => {
    sseClients.delete(res);
  });
}

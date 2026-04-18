import {
  getSessionCountsByRoute,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
  getSessionUpstreamMap,
  getUpstreamStats,
  weightManager,
} from './router.js';
import { logger } from '../utils/logger.js';
import { logBuffer } from '../utils/log-buffer.js';
import { onLogAdded } from '../utils/access-log.js';
import { SSE_HEADERS } from './server.js';
import { parseTimeRange } from '../utils/stats.js';
import { readAccesslog } from '../analytics/reader/accesslog-reader.js';
import { getAllSessions, getAllMessages } from '../analytics/reader/database-reader.js';
import { aggregateSummary } from '../analytics/analyzer/summary-stats.js';
import { aggregateByModel } from '../analytics/analyzer/model-stats.js';
import { aggregateByAgent } from '../analytics/analyzer/agent-stats.js';
import { aggregateByCategory } from '../analytics/analyzer/category-stats.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

/**
 * Setup SSE log callback to push logs to all SSE clients
 * @param {Set} sseClients - Set of SSE client responses
 */
export function setupSSELogCallback(sseClients) {
  return onLogAdded((logEntry) => {
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

  const weightState = weightManager.getAllStates();
  const sessionCounts = getSessionCountsByRoute();
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

        const wmState = weightManager?.getState(routeName, upstream.id);
        return {
          id: upstream.id,
          provider: upstream.provider,
          model: upstream.model,
          currentWeight: wmState?.currentWeight ?? weightEntry?.currentWeight ?? 100,
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
export function handleStats(req, res, routes, _circuitBreaker) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  const requestCounts = getUpstreamRequestCounts();
  const slidingWindowCounts = getUpstreamSlidingWindowCounts();
  const sessionCounts = getSessionCountsByRoute();
  const weightState = weightManager.getAllStates();
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
        const windowMs = 60 * 60 * 1000;
        const recentRequestCount = routeSlidingCounts
          ? routeSlidingCounts.filter((entry) => now - entry.timestamp <= windowMs).length
          : 0;

        const wmState = weightManager?.getState(routeName, upstream.id);
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
          currentWeight:
            wmState?.currentWeight ??
            weightEntry?.currentWeight ??
            weightManager.getConfiguredWeight(upstream),
          configuredWeight:
            wmState?.configuredWeight ?? weightManager.getConfiguredWeight(upstream),
        };
      }),
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response, null, 2));
}

/**
 * Handle weight diagnostics endpoint - return detailed weight state for all routes/upstreams
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} routes - Resolved routes config
 * @param {CircuitBreaker} _circuitBreaker - Circuit breaker instance (unused)
 * @param {Set} _sseClients - SSE clients (unused)
 */
export function handleWeightDiagnostics(req, res, routes, _circuitBreaker, _sseClients) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour window

  const response = {
    timestamp: new Date().toISOString(),
    routes: {},
  };

  for (const [routeName, route] of Object.entries(routes)) {
    response.routes[routeName] = {
      strategy: route.strategy,
      upstreams: (route.upstreams || []).map((upstream) => {
        const state = weightManager?.getState(routeName, upstream.id);
        const adjustmentHistory = weightManager?.getAdjustmentHistory(routeName, upstream.id) || [];

        const errorsInWindow = state?.errors
          ? state.errors.filter((e) => now - e.timestamp <= windowMs).length
          : 0;

        return {
          id: upstream.id,
          provider: upstream.provider,
          model: upstream.model,
          currentWeight:
            state?.currentWeight ?? weightManager?.getConfiguredWeight(upstream) ?? 100,
          configuredWeight:
            state?.configuredWeight ?? weightManager?.getConfiguredWeight(upstream) ?? 100,
          level: state?.level ?? 'normal',
          consecutiveSuccess: state?.consecutiveSuccess ?? 0,
          totalRequests: state?.totalRequests ?? 0,
          avgLatency: state?.avgLatency ?? 0,
          errors: errorsInWindow,
          adjustmentHistory,
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

/**
 * Handle analytics endpoint - return aggregated analytics data
 * Query params: last (time range like 24h, 7d), category, model
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleAnalytics(req, res) {
  // Security: only allow localhost
  const clientIp = req.socket.remoteAddress || '';
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const lastParam = url.searchParams.get('last') || '24h';

    let startTime;
    let endTime;
    try {
      const range = parseTimeRange(lastParam);
      startTime = range.startTime;
      endTime = range.endTime;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid time range: ${lastParam}` }));
      return;
    }

    const categoryFilter = url.searchParams.get('category') || null;
    const modelFilter = url.searchParams.get('model') || null;

    let accesslogEntries;
    let sessions;
    let messages;
    const errors = {};

    try {
      accesslogEntries = await readAccesslog({ startTime, endTime });
    } catch (e) {
      errors.accesslog = e.message;
    }

    try {
      sessions = await getAllSessions({ startTime, endTime });
    } catch (e) {
      errors.sessions = e.message;
    }

    try {
      messages = await getAllMessages({ startTime, endTime });
    } catch (e) {
      errors.messages = e.message;
    }

    if (Object.keys(errors).length === 3) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'All data sources failed', sources: errors },
        })
      );
      return;
    }

    const effectiveAccesslog = accesslogEntries || [];
    const effectiveSessions = sessions || [];
    const effectiveMessages = messages || [];

    let filteredEntries = effectiveAccesslog;
    if (categoryFilter) {
      filteredEntries = filteredEntries.filter((e) => e.category === categoryFilter);
    }
    if (modelFilter) {
      filteredEntries = filteredEntries.filter(
        (e) => e.model === modelFilter || e.virtualModel === modelFilter
      );
    }

    const summary = aggregateSummary(filteredEntries, effectiveSessions, effectiveMessages);
    const topModels = aggregateByModel(filteredEntries);
    const topAgents = aggregateByAgent(effectiveMessages);
    const categoryStats = aggregateByCategory(filteredEntries, effectiveSessions);

    const response = {
      timestamp: new Date().toISOString(),
      timeRange: {
        last: lastParam,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      summary,
      topModels,
      topAgents,
      categoryStats,
    };

    if (Object.keys(errors).length > 0) {
      response.errors = errors;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  } catch (error) {
    logger.error(`Analytics endpoint error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: error.message } }));
  }
}

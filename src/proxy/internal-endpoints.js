import {
  getSessionCountsByRoute,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
  getSessionUpstreamMap,
  getUpstreamStats,
  getUpstreamTokenRateStats,
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
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { getOpencodeConfigPath } from '../utils/proxy-paths.js';
import { readJson, writeJson, exists, copyFile } from '../utils/files.js';
import { ConfigManager } from '../core/ConfigManager.js';
import { getModelLimit } from '../utils/provider-discovery.js';
import {
  getTemplatePath,
  getVariablesPath,
  getProfilesMetadataPath,
} from '../utils/paths.js';
import { ProfileRenderer } from '../core/ProfileRenderer.js';

const DEFAULT_PROXY_PORT = 3000;
const PROVIDER_ID = 'opencode-proxy';
const PROVIDER_ID_RESPONSES = 'opencode-proxy-responses';
const PLACEHOLDER_API_KEY = 'oos-proxy-placeholder-key';

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
    const tokenRateStats = getUpstreamTokenRateStats(routeName);

    response.routes[routeName] = {
      strategy: route.strategy,
      tokenStats: {
        inputTokensPerMinute: tokenRateStats.inputTokensPerMinute,
        outputTokensPerMinute: tokenRateStats.outputTokensPerMinute,
        totalInputTokens: tokenRateStats.totalInputTokens,
        totalOutputTokens: tokenRateStats.totalOutputTokens,
      },
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

/**
 * Check if request is from localhost (including x-forwarded-for header)
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean} True if request is from localhost
 */
function isLocalhostRequest(req) {
  const clientIp = req.socket.remoteAddress || '';
  const forwardedFor = req.headers['x-forwarded-for'];
  let ipIsLocalhost =
    clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
  if (forwardedFor) {
    const forwardedIp = forwardedFor.split(',')[0].trim();
    const forwardedIsLocalhost =
      forwardedIp === '127.0.0.1' || forwardedIp === '::1' || forwardedIp === '::ffff:127.0.0.1';
    ipIsLocalhost = ipIsLocalhost && forwardedIsLocalhost;
  }
  return ipIsLocalhost;
}

/**
 * Handle proxy register endpoint - register proxy providers in opencode.json
 * POST /_internal/proxy-register
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} options - Options
 * @param {number} [options.port] - Proxy server port
 */
export async function handleProxyRegister(req, res, options = {}) {
  if (!isLocalhostRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  try {
    const configManager = new ProxyConfigManager();
    const proxyConfig = await configManager.readConfig();

    if (!proxyConfig?.routes || Object.keys(proxyConfig.routes).length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No routes found in proxy-config.json. Run "oos proxy init" first.' }));
      return;
    }

    const port = parseInt(options.port, 10) || proxyConfig.port || DEFAULT_PROXY_PORT;
    const opencodePath = getOpencodeConfigPath();

    if (!(await exists(opencodePath))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'opencode.json not found. Make sure OpenCode is initialized.' }));
      return;
    }

    let opencodeConfig;
    try {
      opencodeConfig = await readJson(opencodePath);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to read opencode.json: ${error.message}` }));
      return;
    }

    const backupPath = `${opencodePath}.bak`;
    try {
      await copyFile(opencodePath, backupPath);
      logger.info(`Backup created at ${backupPath}`);
    } catch (error) {
      logger.warn(`Could not create backup: ${error.message}`);
    }

    const routes = proxyConfig.routes;
    const chatRoutes = {};
    const responsesRoutes = {};

    for (const [virtualModel, route] of Object.entries(routes)) {
      const protocol = route.protocol || 'chat';
      if (protocol === 'responses') {
        responsesRoutes[virtualModel] = route;
      } else {
        chatRoutes[virtualModel] = route;
      }
    }

    const buildProviderConfig = (npm, baseURL, name, extraOptions = {}) => ({
      npm,
      name,
      options: { baseURL, apiKey: PLACEHOLDER_API_KEY, ...extraOptions },
      models: {},
    });

    const chatProvider = buildProviderConfig(
      '@ai-sdk/openai-compatible',
      `http://localhost:${port}/v1`,
      'OOS Proxy (Chat)',
      { setCacheKey: true }
    );
    const responsesProvider = buildProviderConfig(
      '@ai-sdk/openai',
      `http://localhost:${port}/v1`,
      'OOS Proxy (Responses)',
      { setCacheKey: true }
    );

    const chatModels = [];
    const responsesModels = [];
    const skippedModels = [];

    const processRoutes = async (providerCfg, routesToProcess, modelList) => {
      for (const [virtualModel, route] of Object.entries(routesToProcess)) {
        if (!route.upstreams || route.upstreams.length === 0) {
          logger.warn(`Route "${virtualModel}" has no upstreams, skipping.`);
          skippedModels.push(virtualModel);
          continue;
        }

        const limits = [];
        let modalities = null;
        const modelName = virtualModel;

        for (const upstream of route.upstreams) {
          const providerName = upstream.provider;
          const originalModelName = upstream.model;

          if (!providerName || !originalModelName) {
            logger.warn(`Upstream in route "${virtualModel}" missing provider or model, skipping upstream.`);
            continue;
          }

          let limit = null;
          let modelMetadata = null;

          const providerConfigEntry = opencodeConfig.provider?.[providerName];
          if (!providerConfigEntry) {
            try {
              const apiLimit = await getModelLimit(providerName, originalModelName);
              if (apiLimit) limit = apiLimit;
            } catch (error) {
              logger.debug(`Failed to get limit from models.dev for ${providerName}/${originalModelName}: ${error.message}`);
            }
          } else {
            const originalModel = providerConfigEntry.models?.[originalModelName];
            if (!originalModel) {
              logger.warn(`Model "${originalModelName}" not found in provider "${providerName}" for route "${virtualModel}".`);
              continue;
            }
            modelMetadata = originalModel;
            limit = originalModel.limit || null;
          }

          if (!limit) limit = { context: Infinity, output: Infinity };
          limits.push({ context: limit.context ?? Infinity, output: limit.output ?? Infinity });

          if (!modalities && modelMetadata) {
            modalities = modelMetadata.modalities || null;
          }
        }

        if (limits.length === 0) {
          logger.warn(`No valid upstreams found for route "${virtualModel}", skipping.`);
          skippedModels.push(virtualModel);
          continue;
        }

        const minLimit = limits.length === 1
          ? limits[0]
          : { context: Math.min(...limits.map((l) => l.context)), output: Math.min(...limits.map((l) => l.output)) };

        const modelConfig = { name: `${modelName} (Proxy)` };

        if (minLimit.context !== Infinity || minLimit.output !== Infinity) {
          const limitConfig = {};
          if (minLimit.context !== Infinity) limitConfig.context = minLimit.context;
          if (minLimit.output !== Infinity) limitConfig.output = minLimit.output;
          if (Object.keys(limitConfig).length > 0) modelConfig.limit = limitConfig;
        }

        if (modalities) modelConfig.modalities = modalities;

        providerCfg.models[virtualModel] = modelConfig;
        modelList.push(virtualModel);
      }
    };

    await processRoutes(chatProvider, chatRoutes, chatModels);
    await processRoutes(responsesProvider, responsesRoutes, responsesModels);

    const totalRegistered = chatModels.length + responsesModels.length;
    if (totalRegistered === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No valid routes to register. Check your proxy-config.json and opencode.json.' }));
      return;
    }

    opencodeConfig.provider = opencodeConfig.provider || {};

    if (chatModels.length > 0) opencodeConfig.provider[PROVIDER_ID] = chatProvider;
    if (responsesModels.length > 0) opencodeConfig.provider[PROVIDER_ID_RESPONSES] = responsesProvider;

    try {
      await writeJson(opencodePath, opencodeConfig);
      logger.success('Proxy provider registered in opencode.json');
      if (skippedModels.length > 0) {
        logger.warn(`Skipped ${skippedModels.length} model(s) due to missing config.`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `已注册 ${totalRegistered} 个代理模型`,
        chatModels,
        responsesModels,
        skippedModels: skippedModels.length > 0 ? skippedModels : undefined,
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to write opencode.json: ${error.message}` }));
    }
  } catch (error) {
    logger.error(`Proxy register endpoint error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Handle profile rerender endpoint - re-render current active profile template
 * POST /_internal/profile-rerender
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleProfileRerender(req, res) {
  if (!isLocalhostRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
    return;
  }

  try {
    const metadataPath = getProfilesMetadataPath();

    if (!(await exists(metadataPath))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No profiles configured. Create a profile first.' }));
      return;
    }

    let metadata;
    try {
      metadata = await readJson(metadataPath);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to read profiles metadata: ${error.message}` }));
      return;
    }

    const activeProfileName = metadata.activeProfile;
    if (!activeProfileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active profile. Switch to a profile first.' }));
      return;
    }

    const templatePath = getTemplatePath(activeProfileName);
    const variablesPath = getVariablesPath(activeProfileName);

    if (!(await exists(templatePath))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Template file not found for profile: ${activeProfileName}` }));
      return;
    }

    let templateObj;
    let variables = {};

    try {
      templateObj = await readJson(templatePath);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to read template: ${error.message}` }));
      return;
    }

    if (await exists(variablesPath)) {
      try {
        variables = await readJson(variablesPath);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to read variables: ${error.message}` }));
        return;
      }
    }

    const renderer = new ProfileRenderer();
    let renderedConfig;
    try {
      renderedConfig = await renderer.renderTemplate(templateObj, variables);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to render template: ${error.message}` }));
      return;
    }

    try {
      const configManager = new ConfigManager();
      await configManager.writeConfig(renderedConfig);
      logger.success(`Profile "${activeProfileName}" re-rendered and saved to opencode.json`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `已重新生成配置: ${activeProfileName}`,
        profile: activeProfileName,
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Failed to write opencode.json: ${error.message}` }));
    }
  } catch (error) {
    logger.error(`Profile rerender endpoint error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

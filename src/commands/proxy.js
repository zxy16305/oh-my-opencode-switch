import { createServer, shutdownServer, isPortAvailable } from '../proxy/server.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import {
  routeRequest,
  failoverStickySession,
  getDynamicWeightState,
  getUpstreamSessionCounts,
  getUpstreamRequestCounts,
} from '../proxy/router.js';
import { forwardRequest } from '../proxy/server.js';
import { CircuitBreaker } from '../proxy/circuitbreaker.js';
import { logger } from '../utils/logger.js';
import { getProxyConfigPath } from '../utils/proxy-paths.js';
import { exists } from '../utils/files.js';
import { getDefaultProxyConfig } from '../utils/proxy-default-config.js';
import { logAccess, readLogs, getLogPath, clearLogs } from '../utils/access-log.js';
import { authenticate, createAuthErrorResponse, extractApiKey } from '../utils/proxy-auth.js';
import { parseTimeRange, generateStats } from '../utils/stats.js';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_PORT = 3000;
const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
  allowedFails: 3,
  cooldownTimeMs: 60000,
};

let activeServer = null;
let activePort = null;
let circuitBreaker = null;

/**
 * Start the proxy server
 * @param {object} options - CLI options
 * @param {number} [options.port] - Port to listen on
 * @param {string} [options.config] - Path to config file
 */
export async function startAction(options = {}) {
  const configPath = options.config || getProxyConfigPath();

  // Check if server is already running
  if (activeServer && activeServer.listening) {
    logger.warn(`Proxy server is already running on port ${activePort}`);
    return;
  }

  // Load config first to get port from config file
  const configManager = new ProxyConfigManager();
  let config = await configManager.readConfig();

  if (!config) {
    if (!(await exists(configPath))) {
      logger.warn(`No proxy configuration found at ${configPath}`);
      logger.info('Run "oos proxy init" or create a proxy-config.json manually.');
    }
    config = { routes: {} };
  }

  // Port priority: CLI option > config.port > DEFAULT_PORT
  const port = parseInt(options.port, 10) || config.port || DEFAULT_PORT;

  // Check port availability
  const available = await isPortAvailable(port);
  if (!available) {
    logger.error(`Port ${port} is already in use. Please choose a different port.`);
    process.exit(1);
  }

  // Resolve routes from opencode config (fill baseURL/apiKey if not specified)
  const routes = await configManager.resolveRoutes(config.routes || {});

  // Validate resolved routes have required fields
  for (const [routeName, route] of Object.entries(routes)) {
    for (const upstream of route.upstreams || []) {
      if (!upstream.baseURL) {
        logger.error(
          `Upstream "${upstream.id || upstream.provider}" in route "${routeName}" missing baseURL. ` +
            `Add it to proxy-config.json or configure provider in opencode.json`
        );
        process.exit(1);
      }
    }
  }

  circuitBreaker = new CircuitBreaker(config.reliability || DEFAULT_CIRCUIT_BREAKER_OPTIONS);

  // Get auth config for request authentication
  const auth = config.auth;

  /**
   * Handle debug endpoint - return runtime state
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {object} routes - Resolved routes config
   */
  function handleDebug(req, res, routes) {
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
   */
  function handleStats(req, res, routes) {
    // Security: only allow localhost
    const clientIp = req.socket.remoteAddress || '';
    if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
      return;
    }

    const requestCounts = getUpstreamRequestCounts();
    const sessionCounts = getUpstreamSessionCounts();
    const weightState = getDynamicWeightState();

    const response = {
      timestamp: new Date().toISOString(),
      routes: {},
    };

    for (const [routeName, route] of Object.entries(routes)) {
      response.routes[routeName] = {
        strategy: route.strategy,
        upstreams: (route.upstreams || []).map((upstream) => {
          const key = `${routeName}:${upstream.id}`;
          const routeRequestCounts = requestCounts.get(routeName);
          const routeSessions = sessionCounts.get(routeName);
          const weightEntry = weightState.get(key);

          return {
            id: upstream.id,
            provider: upstream.provider,
            model: upstream.model,
            requestCount: routeRequestCounts?.get(upstream.id) ?? 0,
            sessionCount: routeSessions?.get(upstream.id) ?? 0,
            currentWeight: weightEntry?.currentWeight ?? 100,
          };
        }),
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  // Create request handler
  const requestHandler = async (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        // Debug endpoint - no auth required, localhost only
        if (req.url === '/_internal/debug' && req.method === 'GET') {
          handleDebug(req, res, routes);
          return;
        }

        // Stats endpoint - no auth required, localhost only
        if (req.url === '/_internal/stats' && req.method === 'GET') {
          handleStats(req, res, routes);
          return;
        }

        // Authentication check
        const apiKey = extractApiKey(req);
        const authResult = authenticate(apiKey, auth);
        if (!authResult.valid) {
          const { statusCode, body } = createAuthErrorResponse(authResult.error);
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }

        // Parse request body to get model
        let requestBody;
        try {
          requestBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
          return;
        }

        const model = requestBody.model;
        if (!model) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Missing model field' } }));
          return;
        }

        const route = routes[model];
        let { upstream, sessionId, routeKey } = routeRequest(model, routes, req, requestBody);

        if (!circuitBreaker.isAvailable(upstream.id)) {
          if (sessionId && route.upstreams.length > 1) {
            const nextUpstream = failoverStickySession(
              sessionId,
              upstream.id,
              route.upstreams,
              routeKey,
              model
            );
            if (nextUpstream && circuitBreaker.isAvailable(nextUpstream.id)) {
              upstream = nextUpstream;
              logger.warn(
                `Circuit breaker OPEN for ${upstream.id}, failed over to ${nextUpstream.id}`
              );
            } else {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: { message: 'All providers unavailable (circuit breaker open)' },
                })
              );
              return;
            }
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: { message: `Provider ${upstream.id} unavailable (circuit breaker open)` },
              })
            );
            return;
          }
        }

        const targetUrl = `${upstream.baseURL}/chat/completions`;

        const extraHeaders = {};
        if (upstream.apiKey) {
          extraHeaders['authorization'] = `Bearer ${upstream.apiKey}`;
        }

        const forwardBody = JSON.stringify({ ...requestBody, model: upstream.model });
        const startTime = Date.now();
        let ttfb = null;
        let proxyResStatusCode = null;

        forwardRequest(req, res, targetUrl, {
          body: forwardBody,
          headers: extraHeaders,
          onProxyRes: (proxyRes) => {
            ttfb = Date.now() - startTime;
            proxyResStatusCode = proxyRes.statusCode;
            proxyRes.headers['x-used-provider'] = upstream.id;
            if (sessionId) {
              proxyRes.headers['x-session-id'] = sessionId;
            }
            if (proxyRes.statusCode >= 400) {
              circuitBreaker.recordFailure(upstream.id);
            } else {
              circuitBreaker.recordSuccess(upstream.id);
            }
          },
          onStreamEnd: () => {
            const duration = Date.now() - startTime;
            logAccess({
              sessionId: sessionId || null,
              provider: upstream.provider,
              model: upstream.model,
              virtualModel: model,
              status: proxyResStatusCode,
              ttfb,
              duration,
              body: requestBody,
            }).catch(() => {});
          },
          onError: (err) => {
            circuitBreaker.recordFailure(upstream.id);
            logger.error(`Upstream error for ${upstream.id}: ${err.message}`);
            logAccess({
              sessionId: sessionId || null,
              provider: upstream.provider,
              model: upstream.model,
              virtualModel: model,
              status: 502,
              error: err.message,
              body: requestBody,
            }).catch(() => {});
          },
        });
      } catch (error) {
        if (error.code === 'UNKNOWN_MODEL') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                message: error.message,
                availableModels: error.details.availableModels,
              },
            })
          );
        } else {
          logger.error(`Request error: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: error.message } }));
        }
      }
    });
  };

  try {
    const { server } = await createServer({ port, requestHandler });
    activeServer = server;
    activePort = port;

    logger.success(`Proxy server started on port ${port}`);
    logger.info(`Config: ${configPath}`);

    if (Object.keys(routes).length > 0) {
      logger.info(`Routes: ${Object.keys(routes).join(', ')}`);
    } else {
      logger.warn('No routes configured');
    }

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down proxy server...');
      await shutdownServer(server);
      activeServer = null;
      activePort = null;
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error(`Failed to start proxy server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Stop the proxy server
 */
export async function stopAction() {
  if (!activeServer || !activeServer.listening) {
    logger.warn('No proxy server is currently running');
    return;
  }

  try {
    await shutdownServer(activeServer);
    logger.success(`Proxy server stopped (was on port ${activePort})`);
    activeServer = null;
    activePort = null;
  } catch (error) {
    logger.error(`Failed to stop proxy server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Show proxy server status
 */
export async function statusAction() {
  const configManager = new ProxyConfigManager();
  const config = await configManager.readConfig();
  const configPath = getProxyConfigPath();

  console.log('');
  console.log('Proxy Server Status');
  console.log('===================');

  if (activeServer && activeServer.listening) {
    console.log(`  Status:    Running`);
    console.log(`  Port:      ${activePort}`);
    console.log(`  PID:       ${process.pid}`);
  } else {
    console.log(`  Status:    Not running`);
  }

  console.log(`  Config:    ${configPath}`);

  if (config && config.routes) {
    const models = Object.keys(config.routes);
    console.log(`  Routes:    ${models.length} configured`);
    if (models.length > 0) {
      for (const model of models) {
        const route = config.routes[model];
        const upstreamCount = route.upstreams?.length || 0;
        console.log(`    - ${model}: ${upstreamCount} upstream(s)`);
      }
    }
  } else {
    console.log(`  Routes:    Not configured`);
  }

  console.log('');
}

export async function logsAction(options = {}) {
  const lines = parseInt(options.lines, 10) || 50;
  const logPath = getLogPath();

  console.log(`\nProxy Access Logs (${logPath})\n`);

  if (options.clear) {
    await clearLogs();
    logger.success('Logs cleared.');
    return;
  }

  const logs = await readLogs(lines);
  if (logs.length === 0) {
    console.log('No logs found.');
    return;
  }

  for (const line of logs) {
    console.log(line);
  }

  console.log(`\nShowing last ${logs.length} entries.`);
}

export async function statsAction(options = {}) {
  const { last, json } = options;

  if (!last) {
    logger.error('--last option is required (e.g., 1h, 24h, 7d, 30d)');
    process.exit(1);
  }

  try {
    const { startTime, endTime } = parseTimeRange(last);
    const stats = await generateStats({ startTime, endTime });

    if (stats.length === 0) {
      logger.warn(`No statistics found for time range: ${last}`);
      return;
    }

    if (json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      const tableData = stats.map((s) => ({
        Provider: s.provider,
        Model: s.model,
        Requests: s.requests,
        Success: s.success,
        Failure: s.failure,
        'Success Rate': s.successRate,
        'Avg TTFB': s.avgTtfb,
        'TTFB P95': s.ttfbP95,
        'TTFB P99': s.ttfbP99,
        'Avg Duration': s.avgDuration,
        'Duration P95': s.p95,
        'Duration P99': s.p99,
      }));
      console.table(tableData);
    }
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initAction(options = {}) {
  const configPath = getProxyConfigPath();
  const force = options.force || false;

  if (await exists(configPath)) {
    if (!force) {
      logger.warn(`Proxy config already exists at ${configPath}`);
      logger.info('Use --force to overwrite, or edit the file directly.');
      return;
    }
    logger.info(`Overwriting existing config at ${configPath}`);
  }

  const configManager = new ProxyConfigManager();
  const defaultConfig = getDefaultProxyConfig();

  await configManager.writeConfig(defaultConfig);

  logger.success(`Created proxy config at ${configPath}`);
  logger.info('Edit the file to add your API keys and routes.');
}

/**
 * Register proxy commands with Commander program
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerProxyCommands(program) {
  const proxy = program.command('proxy').description('Manage proxy server');

  proxy
    .command('start')
    .description('Start the proxy server')
    .option('-p, --port <port>', 'Port to listen on (overrides config file)')
    .option('-c, --config <path>', 'Path to config file')
    .action(startAction);

  proxy.command('stop').description('Stop the proxy server').action(stopAction);

  proxy.command('status').description('Show proxy server status').action(statusAction);

  proxy
    .command('logs')
    .description('Show proxy access logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-c, --clear', 'Clear the log file')
    .action(logsAction);

  proxy
    .command('stats')
    .description('Show proxy access statistics')
    .requiredOption('-l, --last <duration>', 'Time range (e.g., 1h, 24h, 7d, 30d)')
    .option('--json', 'Output as JSON')
    .action(statsAction);

  proxy
    .command('init')
    .description('Initialize proxy configuration file')
    .option('-f, --force', 'Overwrite existing config file')
    .action(initAction);
}

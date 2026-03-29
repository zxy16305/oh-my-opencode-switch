import { createServer, shutdownServer, isPortAvailable } from '../proxy/server.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { routeRequest, failoverStickySession } from '../proxy/router.js';
import { forwardRequest } from '../proxy/server.js';
import { CircuitBreaker } from '../proxy/circuitbreaker.js';
import { logger } from '../utils/logger.js';
import { getProxyConfigPath } from '../utils/proxy-paths.js';
import { exists } from '../utils/files.js';
import { getDefaultProxyConfig } from '../utils/proxy-default-config.js';
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

  // Create request handler
  const requestHandler = async (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
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
        let { upstream, sessionId, routeKey } = routeRequest(model, routes, req);

        if (!circuitBreaker.isAvailable(upstream.id)) {
          if (sessionId && route.upstreams.length > 1) {
            const nextUpstream = failoverStickySession(
              sessionId,
              upstream.id,
              route.upstreams,
              routeKey
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

        forwardRequest(req, res, targetUrl, {
          body: forwardBody,
          headers: extraHeaders,
          onProxyRes: (proxyRes) => {
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
          onError: (err) => {
            circuitBreaker.recordFailure(upstream.id);
            logger.error(`Upstream error for ${upstream.id}: ${err.message}`);
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
    .command('init')
    .description('Initialize proxy configuration file')
    .option('-f, --force', 'Overwrite existing config file')
    .action(initAction);
}

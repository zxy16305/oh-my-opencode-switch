import { createServer, shutdownServer, isPortAvailable } from './server.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import {
  routeRequest,
  failoverStickySession,
  getDynamicWeightState,
  getUpstreamSessionCounts,
  getUpstreamRequestCounts,
  getUpstreamSlidingWindowCounts,
  getSessionUpstreamMap,
  getUpstreamStats,
  recordUpstreamError,
  recordUpstreamLatency,
  recordUpstreamStats,
  adjustWeightForError,
  adjustWeightForLatency,
  startWeightRecovery,
  stopWeightRecovery,
} from './router.js';
import { forwardRequest } from './server.js';
import { CircuitBreaker } from './circuitbreaker.js';
import { logger } from '../utils/logger.js';
import { getProxyConfigPath } from '../utils/proxy-paths.js';
import { exists } from '../utils/files.js';
import { getDefaultProxyConfig } from '../utils/proxy-default-config.js';
import { logAccess, readLogs, getLogPath, clearLogs, onLogAdded } from '../utils/access-log.js';
import { logBuffer } from '../utils/log-buffer.js';
import { authenticate, createAuthErrorResponse, extractApiKey } from '../utils/proxy-auth.js';
import { parseTimeRange, generateStats } from '../utils/stats.js';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import {
  handleDebug,
  handleStats,
  handleDashboard,
  handleLogsStream,
  setupSSELogCallback,
} from './internal-endpoints.js';

const DEFAULT_PORT = 3000;
const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
  allowedFails: 3,
  cooldownTimeMs: 60000,
};

/**
 * ProxyServerManager - Manages proxy server lifecycle and state
 */
export class ProxyServerManager {
  constructor() {
    this.activeServer = null;
    this.activePort = null;
    this.circuitBreaker = null;
    this.periodicWeightAdjustTimer = null;
    this.timeSlotSaveTimer = null;
    this.routeRecoveryTimers = new Map();
    this.sseClients = new Set();
    this.timeSlotCalculator = createTimeSlotWeightCalculator();
  }

  /**
   * Start the proxy server
   * @param {object} options - CLI options
   * @param {number} [options.port] - Port to listen on
   * @param {string} [options.config] - Path to config file
   */
  async start(options = {}) {
    const configPath = options.config || getProxyConfigPath();

    // Check if server is already running
    if (this.activeServer && this.activeServer.listening) {
      logger.warn(`Proxy server is already running on port ${this.activePort}`);
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
          const provider = upstream.provider || 'unknown';
          const suggestions = [];
          const keywords = provider.toLowerCase().split(/[-_\s]+/);

          if (keywords.includes('kimi') || keywords.includes('moonshot')) {
            suggestions.push('npm install -g @ai-sdk/moonshotai');
          }
          if (keywords.includes('deepseek')) {
            suggestions.push('npm install -g @ai-sdk/deepseek');
          }
          if (keywords.includes('zhipu') || keywords.includes('glm')) {
            suggestions.push('npm install -g @ai-sdk/gateway');
          }

          suggestions.push(`Add "baseURL" to upstream "${upstream.id}" in proxy-config.json`);
          suggestions.push(`Or configure provider "${provider}" in opencode.json with baseURL`);

          logger.error(
            `Upstream "${upstream.id || upstream.provider}" in route "${routeName}" missing baseURL.\n` +
              `Provider "${provider}" not found or not configured.\n\n` +
              `Suggestions:\n` +
              suggestions.map((s) => `  • ${s}`).join('\n')
          );
          process.exit(1);
        }
      }
    }

    this.circuitBreaker = new CircuitBreaker(config.reliability || DEFAULT_CIRCUIT_BREAKER_OPTIONS);

    // Get auth config for request authentication
    const auth = config.auth;

    // Setup SSE log callback
    setupSSELogCallback(this.sseClients);

    // Create request handler
    const requestHandler = async (req, res) => {
      // Handle SSE endpoint immediately (before waiting for request body)
      if (req.url === '/_internal/logs/stream' && req.method === 'GET') {
        handleLogsStream(req, res, this.sseClients);
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          // Debug endpoint - no auth required, localhost only
          if (req.url === '/_internal/debug' && req.method === 'GET') {
            handleDebug(req, res, routes, this.circuitBreaker);
            return;
          }

          // Dashboard endpoint - no auth required, localhost only
          if (req.url === '/_internal/dashboard' && req.method === 'GET') {
            handleDashboard(req, res);
            return;
          }

          // Stats endpoint - no auth required, localhost only
          if (req.url === '/_internal/stats' && req.method === 'GET') {
            handleStats(req, res, routes, this.circuitBreaker);
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

          if (!this.circuitBreaker.isAvailable(upstream.id)) {
            if (sessionId && route.upstreams.length > 1) {
              const nextUpstream = failoverStickySession(
                sessionId,
                upstream.id,
                route.upstreams,
                routeKey,
                model,
                (id) => this.circuitBreaker.isAvailable(id)
              );
              if (nextUpstream && this.circuitBreaker.isAvailable(nextUpstream.id)) {
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
                this.circuitBreaker.recordFailure(upstream.id);
                recordUpstreamError(model, upstream.id, proxyRes.statusCode);
                const errorData = new Map([[upstream.id, [proxyRes.statusCode]]]);
                adjustWeightForError(model, route.upstreams, route.dynamicWeight, errorData);
                if (config.timeSlotWeight?.enabled) {
                  this.timeSlotCalculator.recordFailure(upstream.provider);
                }
              } else {
                this.circuitBreaker.recordSuccess(upstream.id);
                recordUpstreamLatency(model, upstream.id, Date.now() - startTime);
                const latencyData = new Map([
                  [upstream.id, { avgDuration: Date.now() - startTime }],
                ]);
                adjustWeightForLatency(model, route.upstreams, route.dynamicWeight, latencyData);
                if (config.timeSlotWeight?.enabled) {
                  this.timeSlotCalculator.recordSuccess(upstream.provider);
                }
              }
            },
            onStreamEnd: () => {
              const duration = Date.now() - startTime;

              // Record to memory stats (for dashboard)
              recordUpstreamStats(model, upstream.id, ttfb, duration, proxyResStatusCode >= 400);

              // Write to log file (for CLI stats)
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
              this.circuitBreaker.recordFailure(upstream.id);
              recordUpstreamError(model, upstream.id, 502);
              const errorData = new Map([[upstream.id, [502]]]);
              adjustWeightForError(model, route.upstreams, route.dynamicWeight, errorData);
              logger.error(`Upstream error for ${upstream.id}: ${err.message}`);
              if (config.timeSlotWeight?.enabled) {
                this.timeSlotCalculator.recordFailure(upstream.provider);
              }
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
      this.activeServer = server;
      this.activePort = port;

      logger.success(`Proxy server started on port ${port}`);
      logger.info(`Config: ${configPath}`);

      if (Object.keys(routes).length > 0) {
        logger.info(`Routes: ${Object.keys(routes).join(', ')}`);
      } else {
        logger.warn('No routes configured');
      }

      for (const [routeKey, route] of Object.entries(routes)) {
        const recoveryTimer = startWeightRecovery(routeKey, route.upstreams, route.dynamicWeight);
        if (recoveryTimer) {
          this.routeRecoveryTimers.set(routeKey, recoveryTimer);
        }
      }

      if (config.timeSlotWeight?.enabled) {
        await this.timeSlotCalculator.load();
        const HOUR_MS = 60 * 60 * 1000;
        this.timeSlotSaveTimer = setInterval(async () => {
          await this.timeSlotCalculator.save().catch((err) => {
            logger.error(`Failed to persist time slot data: ${err.message}`);
          });
        }, HOUR_MS);
      }

      // Handle graceful shutdown
      this.setupGracefulShutdown(config);
    } catch (error) {
      logger.error(`Failed to start proxy server: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Setup graceful shutdown handlers
   * @param {object} config - Proxy configuration
   */
  setupGracefulShutdown(config) {
    const shutdown = async () => {
      logger.info('Shutting down proxy server...');

      if (this.periodicWeightAdjustTimer) {
        clearInterval(this.periodicWeightAdjustTimer);
        this.periodicWeightAdjustTimer = null;
      }

      if (this.timeSlotSaveTimer) {
        clearInterval(this.timeSlotSaveTimer);
        this.timeSlotSaveTimer = null;
        await this.timeSlotCalculator.save().catch((err) => {
          logger.error(`Failed to persist time slot data on shutdown: ${err.message}`);
        });
      }

      for (const [routeKey] of this.routeRecoveryTimers) {
        stopWeightRecovery(routeKey);
      }
      this.routeRecoveryTimers.clear();

      await shutdownServer(this.activeServer);
      this.activeServer = null;
      this.activePort = null;
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Stop the proxy server
   */
  async stop() {
    if (!this.activeServer || !this.activeServer.listening) {
      logger.warn('No proxy server is currently running');
      return;
    }

    try {
      if (this.periodicWeightAdjustTimer) {
        clearInterval(this.periodicWeightAdjustTimer);
        this.periodicWeightAdjustTimer = null;
      }

      if (this.timeSlotSaveTimer) {
        clearInterval(this.timeSlotSaveTimer);
        this.timeSlotSaveTimer = null;
        await this.timeSlotCalculator.save().catch((err) => {
          logger.error(`Failed to persist time slot data on stop: ${err.message}`);
        });
      }

      for (const [routeKey] of this.routeRecoveryTimers) {
        stopWeightRecovery(routeKey);
      }
      this.routeRecoveryTimers.clear();

      await shutdownServer(this.activeServer);
      logger.success(`Proxy server stopped (was on port ${this.activePort})`);
      this.activeServer = null;
      this.activePort = null;
    } catch (error) {
      logger.error(`Failed to stop proxy server: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Get current server status
   * @returns {object} Status information
   */
  getStatus() {
    return {
      running: this.activeServer !== null && this.activeServer.listening,
      port: this.activePort,
      pid: this.activeServer ? process.pid : undefined,
    };
  }
}

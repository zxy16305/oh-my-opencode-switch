import fs from 'fs/promises';
import { createServer, shutdownServer, isPortAvailable, forwardRequest } from './server.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import {
  routeRequest,
  validateRoute,
  failoverStickySession,
  recordUpstreamError,
  recordUpstreamLatency,
  recordUpstreamStats,
  recordUpstreamTokenStats,
  weightManager,
} from './router.js';
import { CircuitBreaker } from './circuitbreaker.js';
import { logger } from '../utils/logger.js';
import { getProxyConfigPath, getDebugBodiesDir } from '../utils/proxy-paths.js';
import { exists, ensureDir } from '../utils/files.js';
import { logAccess } from '../utils/access-log.js';
import { diffProxyConfigs } from '../utils/config-diff.js';
import { authenticate, createAuthErrorResponse, extractApiKey } from '../utils/proxy-auth.js';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { calculateErrorAdjustment } from './weight/index.js';
import { TokenCaptivee } from '../utils/token-capttee.js';
import { resolveEndpoint } from './endpoint-resolver.js';
import { transformRequestBody } from './request-transformer.js';
import { ResponseTransformer } from './response-transformer.js';
import { detectProtocol } from './protocol-detector.js';
import { formatTokenCompact } from '../utils/access-log.js';
import {
  handleDebug,
  handleStats,
  handleDashboard,
  handleLogsStream,
  handleAnalytics,
  handleWeightDiagnostics,
  setupSSELogCallback,
  handleProxyRegister,
  handleProfileRerender,
} from './internal-endpoints.js';

const DEFAULT_PORT = 3000;
const DEFAULT_INSTANCE_NAME = 'default';
const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
  allowedFails: 2,
  cooldownTimeMs: 60000,
};
const MAX_RETRIES = 1;
const TIME_SLOT_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const ERROR_RATE_CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds

function createInstanceState(config = {}) {
  return {
    server: null,
    port: null,
    circuitBreaker: null,
    periodicWeightAdjustTimer: null,
    timeSlotSaveTimer: null,
    sseClients: new Set(),
    cleanupSSELogCallback: null,
    timeSlotCalculator: createTimeSlotWeightCalculator({ config: config.timeSlotWeight || {} }),
    timeSlotCheckTimer: null,
    errorRateCheckTimer: null,
  };
}

export class ProxyServerManager {
  constructor() {
    this.instances = new Map();
  }

  _getOrCreateInstance(name, config) {
    if (!this.instances.has(name)) {
      this.instances.set(name, createInstanceState(config));
    }
    return this.instances.get(name);
  }

  _getInstance(name) {
    return this.instances.get(name);
  }

  async start(options = {}) {
    const instanceName = options.name || DEFAULT_INSTANCE_NAME;
    const configPath = options.config || getProxyConfigPath();

    const existingInst = this._getInstance(instanceName);
    if (existingInst && existingInst.server && existingInst.server.listening) {
      logger.warn(`[${instanceName}] Proxy server is already running on port ${existingInst.port}`);
      return;
    }

    const configManager = new ProxyConfigManager();
    let config = await configManager.readConfig();

    if (!config) {
      if (!(await exists(configPath))) {
        logger.warn(`No proxy configuration found at ${configPath}`);
        logger.info('Run "oos proxy init" or create a proxy-config.json manually.');
      }
      config = { routes: {} };
    }

    // Create instance with config (timeSlotCalculator needs config)
    const inst = this._getOrCreateInstance(instanceName, config);

    const parsedOptionPort = options.port === undefined ? undefined : parseInt(options.port, 10);
    const port =
      parsedOptionPort !== undefined && !Number.isNaN(parsedOptionPort)
        ? parsedOptionPort
        : (config.port ?? DEFAULT_PORT);

    const available = await isPortAvailable(port);
    if (!available) {
      logger.error(`Port ${port} is already in use. Please choose a different port.`);
      process.exit(1);
    }

    const routes = await configManager.resolveRoutes(config.routes || {});

    for (const [routeName, route] of Object.entries(routes)) {
      const validation = validateRoute(route);
      if (!validation.valid) {
        logger.error(`Invalid route "${routeName}": ${validation.error}`);
        process.exit(1);
      }
    }

    for (const [routeName, route] of Object.entries(routes)) {
      const validUpstreams = [];
      for (const upstream of route.upstreams || []) {
        if (!upstream.baseURL) {
          const provider = upstream.provider || 'unknown';
          logger.warn(
            `Skipping upstream "${upstream.id || provider}" in route "${routeName}": ` +
              `provider "${provider}" has no baseURL ` +
              `(not in opencode.json and models.dev unreachable).`
          );
          continue;
        }
        validUpstreams.push(upstream);
      }
      if (validUpstreams.length === 0 && (route.upstreams || []).length > 0) {
        logger.warn(
          `Route "${routeName}" has no valid upstreams after baseURL resolution, removing route.`
        );
        delete routes[routeName];
      } else if (validUpstreams.length < (route.upstreams || []).length) {
        route.upstreams = validUpstreams;
      }
    }

    if (Object.keys(routes).length === 0) {
      logger.error('No routes have valid upstreams. Cannot start proxy.');
      process.exit(1);
    }

    inst._currentRoutes = routes;
    weightManager.initRoutes(routes);

    inst.circuitBreaker = new CircuitBreaker(config.reliability || DEFAULT_CIRCUIT_BREAKER_OPTIONS);

    const auth = config.auth;

    inst.cleanupSSELogCallback?.();
    inst.cleanupSSELogCallback = setupSSELogCallback(inst.sseClients);

    const circuitBreaker = inst.circuitBreaker;
    const sseClients = inst.sseClients;
    const timeSlotCalculator = inst.timeSlotCalculator;

    const requestHandler = async (req, res) => {
      if (req.url === '/_internal/logs/stream' && req.method === 'GET') {
        handleLogsStream(req, res, sseClients);
        return;
      }

      const chunks = [];
      req.on('data', (chunk) => {
        chunks.push(chunk);
      });

      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString();

        try {
          if (req.url === '/_internal/reload' && req.method === 'POST') {
            const clientIp = req.socket.remoteAddress || '';
            const forwardedFor = req.headers['x-forwarded-for'];

            let ipIsLocalhost =
              clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';

            if (forwardedFor) {
              const forwardedIp = forwardedFor.split(',')[0].trim();
              const forwardedIsLocalhost =
                forwardedIp === '127.0.0.1' ||
                forwardedIp === '::1' ||
                forwardedIp === '::ffff:127.0.0.1';
              ipIsLocalhost = ipIsLocalhost && forwardedIsLocalhost;
            }

            if (!ipIsLocalhost) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Forbidden: localhost only' }));
              return;
            }

            const result = await this.reloadConfig(instanceName);
            if (result.success) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Config reloaded successfully',
                  diff: result.diff,
                })
              );
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  success: false,
                  error: result.error,
                })
              );
            }
            return;
          }

          if (req.url === '/_internal/proxy-register' && req.method === 'POST') {
            await handleProxyRegister(req, res);
            return;
          }
          if (req.url === '/_internal/profile-rerender' && req.method === 'POST') {
            await handleProfileRerender(req, res);
            return;
          }

          if (req.url === '/_internal/debug' && req.method === 'GET') {
            handleDebug(req, res, routes, circuitBreaker);
            return;
          }

          if (req.url === '/_internal/dashboard' && req.method === 'GET') {
            handleDashboard(req, res);
            return;
          }

          if (req.url === '/_internal/stats' && req.method === 'GET') {
            handleStats(req, res, routes, circuitBreaker);
            return;
          }

          if (req.url === '/_internal/weight-diagnostics' && req.method === 'GET') {
            handleWeightDiagnostics(req, res, routes, circuitBreaker);
            return;
          }

          if (req.url.startsWith('/_internal/analytics') && req.method === 'GET') {
            handleAnalytics(req, res);
            return;
          }

          const apiKey = extractApiKey(req);
          const authResult = authenticate(apiKey, auth);
          if (!authResult.valid) {
            const { statusCode, body } = createAuthErrorResponse(authResult.error);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
            return;
          }

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

          const { protocol, endpointPath } = detectProtocol(req);

          const route = routes[model];
          let { upstream, sessionId, routeKey } = routeRequest(model, routes, req, requestBody);

          // resolveEndpoint + transformRequestBody only for chat protocol
          // responses protocol: passthrough with model replacement only
          let endpointResult;
          if (protocol === 'chat') {
            endpointResult = resolveEndpoint(model, requestBody);
          } else {
            endpointResult = {
              endpointPath,
              needsTransform: false,
            };
          }
          const category = req.headers['x-opencode-category'] || null;
          const agent = req.headers['x-opencode-agent'] || null;

          if (!circuitBreaker.isAvailable(upstream.id)) {
            if (sessionId && route.upstreams.length > 1) {
              const nextUpstream = failoverStickySession(
                sessionId,
                upstream.id,
                route.upstreams,
                routeKey,
                model,
                (id) => circuitBreaker.isAvailable(id),
                null,
                weightManager
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

          // endpointPath is a relative path (e.g., /chat/completions, /responses)
          // upstream.baseURL already includes the version prefix (e.g., /v1, /v4)
          const targetUrl = `${upstream.baseURL}${endpointPath}`;

          const extraHeaders = {};
          if (upstream.apiKey) {
            extraHeaders['authorization'] = `Bearer ${upstream.apiKey}`;
          }

          let forwardBody;
          if (protocol === 'responses') {
            forwardBody = JSON.stringify({ ...requestBody, model: upstream.model });
          } else {
            try {
              forwardBody = endpointResult.needsTransform
                ? transformRequestBody(requestBody, upstream.model)
                : JSON.stringify({ ...requestBody, model: upstream.model });
            } catch (transformError) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: { message: transformError.message || 'Request transformation failed' },
                })
              );
              return;
            }
          }

          const capttee = new TokenCaptivee();

          if (options.debugbody) {
            (async () => {
              try {
                const debugDir = getDebugBodiesDir();
                await ensureDir(debugDir);
                const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 18);
                const safeSessionId = (sessionId || 'unknown').replace(/[/\\:*?"<>|]/g, '_');
                const dirName = `${timestamp}-${safeSessionId}`;
                const msgDir = `${debugDir}/${dirName}`;
                await ensureDir(msgDir);

                const meta = {
                  model,
                  target: upstream.provider,
                  upstreamModel: upstream.model,
                  endpoint: endpointPath,
                  timestamp: new Date().toISOString(),
                };

                // Store paths for later response write
                capttee._debugPaths = { msgDir, meta };

                fs.writeFile(`${msgDir}/original.json`, body).catch(() => {});
                fs.writeFile(`${msgDir}/forwarded.json`, forwardBody).catch(() => {});
                if (endpointResult.needsTransform) {
                  fs.writeFile(`${msgDir}/transformed.json`, forwardBody).catch(() => {});
                }
                logger.raw(`[debugbody] Saved -> ${msgDir}/`);
              } catch {
                // Silent failure
              }
            })();
          }

          const startTime = Date.now();
          let ttfb = null;
          let proxyResStatusCode = null;
          let proxyResHeaders = null;
          let retryCount = 0;

          forwardRequest(req, res, targetUrl, {
            body: forwardBody,
            headers: extraHeaders,
            responseTransform: endpointResult.needsTransform
              ? chainTransforms(new ResponseTransformer(), capttee)
              : capttee,
            onProxyRes: (proxyRes) => {
              ttfb = Date.now() - startTime;
              proxyResStatusCode = proxyRes.statusCode;
              proxyResHeaders = { ...proxyRes.headers };

              // Handle 429 Too Many Requests - auto retry to next upstream
              if (proxyRes.statusCode === 429) {
                if (
                  !res.headersSent &&
                  !res.socket?.destroyed &&
                  !req.socket?.destroyed &&
                  route.upstreams.length > 1 &&
                  retryCount < MAX_RETRIES
                ) {
                  res._retry429 = true;

                  const nextUpstream = failoverStickySession(
                    sessionId,
                    upstream.id,
                    route.upstreams,
                    routeKey,
                    model,
                    (id) => circuitBreaker.isAvailable(id),
                    null,
                    weightManager
                  );

                  if (nextUpstream && nextUpstream.baseURL) {
                    retryCount++;
                    logger.warn(
                      `Retrying request on ${nextUpstream.id} after ${upstream.id} returned 429 Too Many Requests`
                    );

                    const retryUrl = `${nextUpstream.baseURL}${endpointPath}`;
                    const retryHeaders = {};
                    if (nextUpstream.apiKey) {
                      retryHeaders['authorization'] = `Bearer ${nextUpstream.apiKey}`;
                    }

                    const retryCapttee = new TokenCaptivee();

                    if (options.debugbody) {
                      (async () => {
                        try {
                          const debugDir = getDebugBodiesDir();
                          await ensureDir(debugDir);
                          const timestamp = new Date()
                            .toISOString()
                            .replace(/[:-]/g, '')
                            .slice(0, 18);
                          const safeSessionId = (sessionId || 'unknown').replace(
                            /[/\\:*?"<>|]/g,
                            '_'
                          );
                          const dirName = `${timestamp}-retry-${safeSessionId}`;
                          const msgDir = `${debugDir}/${dirName}`;
                          await ensureDir(msgDir);

                          const meta = {
                            model,
                            target: nextUpstream.provider,
                            upstreamModel: nextUpstream.model,
                            timestamp: new Date().toISOString(),
                            isRetry: true,
                            retryFrom: upstream.id,
                          };

                          retryCapttee._debugPaths = { msgDir, meta };

                          fs.writeFile(`${msgDir}/original.json`, body).catch(() => {});
                          fs.writeFile(`${msgDir}/forwarded.json`, forwardBody).catch(() => {});
                          logger.raw(`[debugbody] Saved -> ${msgDir}/`);
                        } catch {
                          // Silent failure
                        }
                      })();
                    }

                    forwardRequest(req, res, retryUrl, {
                      body: forwardBody,
                      headers: retryHeaders,
                      responseTransform: retryCapttee,
                      onProxyRes: (retryProxyRes) => {
                        ttfb = Date.now() - startTime;
                        proxyResStatusCode = retryProxyRes.statusCode;
                        proxyResHeaders = { ...retryProxyRes.headers };
                        retryProxyRes.headers['x-used-provider'] = nextUpstream.id;
                        retryProxyRes.headers['x-retry-count'] = String(retryCount);
                        if (sessionId) {
                          retryProxyRes.headers['x-session-id'] = sessionId;
                        }
                        if (retryProxyRes.statusCode >= 400) {
                          circuitBreaker.recordFailure(nextUpstream.id);
                          recordUpstreamError(model, nextUpstream.id, retryProxyRes.statusCode);
                          weightManager.recordError(model, nextUpstream.id, retryProxyRes.statusCode);
                          if (config.timeSlotWeight?.enabled) {
                            timeSlotCalculator.recordFailure(nextUpstream.provider);
                          }
                        } else {
                          circuitBreaker.recordSuccess(nextUpstream.id);
                          recordUpstreamLatency(model, nextUpstream.id, Date.now() - startTime);
                          weightManager.recordSuccess(model, nextUpstream.id, Date.now() - startTime);
                          if (config.timeSlotWeight?.enabled) {
                            timeSlotCalculator.recordSuccess(nextUpstream.provider);
                          }
                        }
                      },
                      onStreamEnd: () => {
                        const duration = Date.now() - startTime;

                        recordUpstreamStats(
                          model,
                          nextUpstream.id,
                          ttfb,
                          duration,
                          proxyResStatusCode >= 400
                        );

                        let tokens;
                        let retryRawUsage;
                        try {
                          retryRawUsage = retryCapttee.getUsage();
                          tokens = retryRawUsage ? formatTokenCompact(retryRawUsage) : undefined;
                        } catch {
                          tokens = undefined;
                        }

                        if (retryRawUsage) {
                          recordUpstreamTokenStats(
                            model,
                            retryRawUsage.input_tokens ?? 0,
                            retryRawUsage.output_tokens ?? 0
                          );
                        }

                        logAccess({
                          sessionId: sessionId || null,
                          agent,
                          category,
                          provider: nextUpstream.provider,
                          model: nextUpstream.model,
                          virtualModel: model,
                          endpoint: endpointPath,
                          status: proxyResStatusCode,
                          ttfb,
                          duration,
                          tokens,
                          body: requestBody,
                        }).catch(() => {});

                        if (options.debugbody && retryCapttee._debugPaths) {
                          try {
                            const { msgDir, meta } = retryCapttee._debugPaths;
                            const response = retryCapttee.getFullResponse();
                            const isSSE = response.includes('data:');
                            const responseFile = isSSE
                              ? `${msgDir}/response.sse`
                              : `${msgDir}/response.json`;

                            const completeMeta = {
                              ...meta,
                              statusCode: proxyResStatusCode,
                              responseHeaders: proxyResHeaders || {},
                            };

                            fs.writeFile(responseFile, response).catch(() => {});
                            fs.writeFile(
                              `${msgDir}/meta.json`,
                              JSON.stringify(completeMeta, null, 2)
                            ).catch(() => {});
                          } catch {
                            // Silent failure
                          }
                        }
                      },
                      onError: (retryErr) => {
                        circuitBreaker.recordFailure(nextUpstream.id);
                        recordUpstreamError(model, nextUpstream.id, 502);
                        weightManager.recordError(model, nextUpstream.id, 502);
                        logger.error(`Retry failed for ${nextUpstream.id}: ${retryErr.message}`);
                        if (config.timeSlotWeight?.enabled) {
                          timeSlotCalculator.recordFailure(nextUpstream.provider);
                        }
                        if (!res.headersSent && !res.socket?.destroyed && !req.socket?.destroyed) {
                          res.writeHead(502, { 'Content-Type': 'application/json' });
                          res.end(
                            JSON.stringify({
                              error: { message: `Bad Gateway: ${retryErr.message}` },
                            })
                          );
                        }
                      },
                    });

                    return;
                  }
                }
              }

              proxyRes.headers['x-used-provider'] = upstream.id;
              proxyRes.headers['x-retry-count'] = retryCount > 0 ? String(retryCount) : '0';
              if (sessionId) {
                proxyRes.headers['x-session-id'] = sessionId;
              }
              if (proxyRes.statusCode >= 400) {
                circuitBreaker.recordFailure(upstream.id);
                recordUpstreamError(model, upstream.id, proxyRes.statusCode);
                weightManager.recordError(model, upstream.id, proxyRes.statusCode);
                if (config.timeSlotWeight?.enabled) {
                  timeSlotCalculator.recordFailure(upstream.provider);
                }
              } else {
                circuitBreaker.recordSuccess(upstream.id);
                recordUpstreamLatency(model, upstream.id, Date.now() - startTime);
                weightManager.recordSuccess(model, upstream.id, Date.now() - startTime);
                if (config.timeSlotWeight?.enabled) {
                  timeSlotCalculator.recordSuccess(upstream.provider);
                }
              }
            },
            onStreamEnd: () => {
              const duration = Date.now() - startTime;

              recordUpstreamStats(model, upstream.id, ttfb, duration, proxyResStatusCode >= 400);

              let tokens;
              let rawUsage;
              try {
                rawUsage = capttee.getUsage();
                tokens = rawUsage ? formatTokenCompact(rawUsage) : undefined;
              } catch {
                tokens = undefined; // Graceful degradation
              }

              if (rawUsage) {
                recordUpstreamTokenStats(
                  model,
                  rawUsage.input_tokens ?? 0,
                  rawUsage.output_tokens ?? 0
                );
              }

              logAccess({
                sessionId: sessionId || null,
                agent,
                category,
                provider: upstream.provider,
                model: upstream.model,
                virtualModel: model,
                endpoint: endpointPath,
                status: proxyResStatusCode,
                ttfb,
                duration,
                tokens,
                body: requestBody,
              }).catch(() => {
                /* intentionally silent: best-effort access logging */
              });

              if (options.debugbody && capttee._debugPaths) {
                try {
                  const { msgDir, meta } = capttee._debugPaths;
                  const response = capttee.getFullResponse();
                  const isSSE = response.includes('data:');
                  const responseFile = isSSE ? `${msgDir}/response.sse` : `${msgDir}/response.json`;

                  const completeMeta = {
                    ...meta,
                    statusCode: proxyResStatusCode,
                    responseHeaders: proxyResHeaders || {},
                  };

                  fs.writeFile(responseFile, response).catch(() => {});
                  fs.writeFile(`${msgDir}/meta.json`, JSON.stringify(completeMeta, null, 2)).catch(
                    () => {}
                  );
                } catch {
                  // Silent failure
                }
              }
            },
            onError: (err) => {
              circuitBreaker.recordFailure(upstream.id);
              recordUpstreamError(model, upstream.id, 502);
              weightManager.recordError(model, upstream.id, 502);
              logger.error(`Upstream error for ${upstream.id}: ${err.message}`);

              // Retry logic: check if retry is possible
              if (
                !res.headersSent &&
                !res.socket?.destroyed &&
                !req.socket?.destroyed &&
                route.upstreams.length > 1 &&
                retryCount < MAX_RETRIES
              ) {
                const nextUpstream = failoverStickySession(
                  sessionId,
                  upstream.id,
                  route.upstreams,
                  routeKey,
                  model,
                  (id) => circuitBreaker.isAvailable(id),
                  null,
                  weightManager
                );

                if (nextUpstream && nextUpstream.baseURL) {
                  retryCount++;
                  logger.warn(
                    `Retrying request on ${nextUpstream.id} ` +
                      `after ${upstream.id} error: ${err.message}`
                  );

                  const retryUrl = `${nextUpstream.baseURL}${endpointPath}`;
                  const retryHeaders = {};
                  if (nextUpstream.apiKey) {
                    retryHeaders['authorization'] = `Bearer ${nextUpstream.apiKey}`;
                  }

                  const retryCapttee = new TokenCaptivee();

                  if (options.debugbody) {
                    (async () => {
                      try {
                        const debugDir = getDebugBodiesDir();
                        await ensureDir(debugDir);
                        const timestamp = new Date()
                          .toISOString()
                          .replace(/[:-]/g, '')
                          .slice(0, 18);
                        const safeSessionId = (sessionId || 'unknown').replace(
                          /[/\\:*?"<>|]/g,
                          '_'
                        );
                        const dirName = `${timestamp}-retry-${safeSessionId}`;
                        const msgDir = `${debugDir}/${dirName}`;
                        await ensureDir(msgDir);

                        const meta = {
                          model,
                          target: nextUpstream.provider,
                          upstreamModel: nextUpstream.model,
                          timestamp: new Date().toISOString(),
                          isRetry: true,
                          retryFrom: upstream.id,
                        };

                        retryCapttee._debugPaths = { msgDir, meta };

                        fs.writeFile(`${msgDir}/original.json`, body).catch(() => {});
                        fs.writeFile(`${msgDir}/forwarded.json`, forwardBody).catch(() => {});
                        logger.raw(`[debugbody] Saved -> ${msgDir}/`);
                      } catch {
                        // Silent failure
                      }
                    })();
                  }

                  forwardRequest(req, res, retryUrl, {
                    body: forwardBody,
                    headers: retryHeaders,
                    responseTransform: retryCapttee,
                    onProxyRes: (proxyRes) => {
                      ttfb = Date.now() - startTime;
                      proxyResStatusCode = proxyRes.statusCode;
                      proxyResHeaders = { ...proxyRes.headers };
                      proxyRes.headers['x-used-provider'] = nextUpstream.id;
                      proxyRes.headers['x-retry-count'] = String(retryCount);
                      if (sessionId) {
                        proxyRes.headers['x-session-id'] = sessionId;
                      }
                      if (proxyRes.statusCode >= 400) {
                        circuitBreaker.recordFailure(nextUpstream.id);
                        recordUpstreamError(model, nextUpstream.id, proxyRes.statusCode);
                        weightManager.recordError(model, nextUpstream.id, proxyRes.statusCode);
                        if (config.timeSlotWeight?.enabled) {
                          timeSlotCalculator.recordFailure(nextUpstream.provider);
                        }
                      } else {
                        circuitBreaker.recordSuccess(nextUpstream.id);
                        recordUpstreamLatency(model, nextUpstream.id, Date.now() - startTime);
                        weightManager.recordSuccess(model, nextUpstream.id, Date.now() - startTime);
                        if (config.timeSlotWeight?.enabled) {
                          timeSlotCalculator.recordSuccess(nextUpstream.provider);
                        }
                      }
                    },
                    onStreamEnd: () => {
                      const duration = Date.now() - startTime;
                      recordUpstreamStats(
                        model,
                        nextUpstream.id,
                        ttfb,
                        duration,
                        proxyResStatusCode >= 400
                      );

                      let tokens;
                      let retryRawUsage;
                      try {
                        retryRawUsage = retryCapttee.getUsage();
                        tokens = retryRawUsage ? formatTokenCompact(retryRawUsage) : undefined;
                      } catch {
                        tokens = undefined;
                      }

                      if (retryRawUsage) {
                        recordUpstreamTokenStats(
                          model,
                          retryRawUsage.input_tokens ?? 0,
                          retryRawUsage.output_tokens ?? 0
                        );
                      }

                      logAccess({
                        sessionId: sessionId || null,
                        agent,
                        category,
                        provider: nextUpstream.provider,
                        model: nextUpstream.model,
                        virtualModel: model,
                        status: proxyResStatusCode,
                        ttfb,
                        duration,
                        tokens,
                        body: requestBody,
                      }).catch(() => {});

                      if (options.debugbody && retryCapttee._debugPaths) {
                        try {
                          const { msgDir, meta } = retryCapttee._debugPaths;
                          const response = retryCapttee.getFullResponse();
                          const isSSE = response.includes('data:');
                          const responseFile = isSSE
                            ? `${msgDir}/response.sse`
                            : `${msgDir}/response.json`;

                          const completeMeta = {
                            ...meta,
                            statusCode: proxyResStatusCode,
                            responseHeaders: proxyResHeaders || {},
                          };

                          fs.writeFile(responseFile, response).catch(() => {});
                          fs.writeFile(
                            `${msgDir}/meta.json`,
                            JSON.stringify(completeMeta, null, 2)
                          ).catch(() => {});
                        } catch {
                          // Silent failure
                        }
                      }
                    },
                    onError: (retryErr) => {
                      circuitBreaker.recordFailure(nextUpstream.id);
                      recordUpstreamError(model, nextUpstream.id, 502);
                      weightManager.recordError(model, nextUpstream.id, 502);
                      logger.error(`Retry failed for ${nextUpstream.id}: ${retryErr.message}`);
                      if (config.timeSlotWeight?.enabled) {
                        timeSlotCalculator.recordFailure(nextUpstream.provider);
                      }
                      if (!res.headersSent && !res.socket?.destroyed && !req.socket?.destroyed) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(
                          JSON.stringify({
                            error: { message: `Bad Gateway: ${retryErr.message}` },
                          })
                        );
                      }
                    },
                  });
                  return; // Don't send 502, retry will handle it
                }
              }

              // No retry available, send 502
              if (config.timeSlotWeight?.enabled) {
                timeSlotCalculator.recordFailure(upstream.provider);
              }
              logAccess({
                sessionId: sessionId || null,
                agent,
                category,
                provider: upstream.provider,
                model: upstream.model,
                virtualModel: model,
                status: 502,
                error: err.message,
                body: requestBody,
              }).catch(() => {
                /* intentionally silent: best-effort access logging on error path */
              });
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
      inst.server = server;
      inst.port = port;

      logger.success(`[${instanceName}] Proxy server started on port ${port}`);
      logger.info(`Config: ${configPath}`);

      if (Object.keys(routes).length > 0) {
        logger.info(`Routes: ${Object.keys(routes).join(', ')}`);
      } else {
        logger.warn('No routes configured');
      }

      if (config.timeSlotWeight?.enabled) {
        await inst.timeSlotCalculator.load();
        const HOUR_MS = 60 * 60 * 1000;
        inst.timeSlotSaveTimer = setInterval(async () => {
          await inst.timeSlotCalculator.save().catch((err) => {
            logger.error(`[${instanceName}] Failed to persist time slot data: ${err.message}`);
          });
        }, HOUR_MS);
      }

      const timeSlotCheckTimer = setInterval(() => {
        weightManager.checkTimeSlotChange(routes);
      }, TIME_SLOT_CHECK_INTERVAL_MS);
      timeSlotCheckTimer.unref();
      inst.timeSlotCheckTimer = timeSlotCheckTimer;

      const errorRateCheckTimer = setInterval(() => {
        for (const [routeKey, route] of Object.entries(routes)) {
          for (const upstream of route.upstreams) {
            const state = weightManager.getState(routeKey, upstream.id);
            if (state && state.errors.length > 0) {
              const adjustment = calculateErrorAdjustment(state, {
                errorWindowMs: weightManager.config.errorWindowMs,
                minWeight: weightManager.config.minWeight,
              });
              if (adjustment) {
                state.currentWeight = adjustment.newWeight;
                state.level = adjustment.level;
              }
            }
          }
        }
      }, ERROR_RATE_CHECK_INTERVAL_MS);
      errorRateCheckTimer.unref();
      inst.errorRateCheckTimer = errorRateCheckTimer;

      this.setupGracefulShutdown(config, instanceName);
    } catch (error) {
      logger.error(`[${instanceName}] Failed to start proxy server: ${error.message}`);
      process.exit(1);
    }
  }

  setupGracefulShutdown(config, instanceName) {
    const shutdown = async () => {
      logger.info(`[${instanceName}] Shutting down proxy server...`);
      await this._shutdownInstance(instanceName);
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  async _shutdownInstance(instanceName) {
    const inst = this._getInstance(instanceName);
    if (!inst) return;

    if (inst.periodicWeightAdjustTimer) {
      clearInterval(inst.periodicWeightAdjustTimer);
      inst.periodicWeightAdjustTimer = null;
    }

    if (inst.timeSlotCheckTimer) {
      clearInterval(inst.timeSlotCheckTimer);
      inst.timeSlotCheckTimer = null;
    }

    if (inst.errorRateCheckTimer) {
      clearInterval(inst.errorRateCheckTimer);
      inst.errorRateCheckTimer = null;
    }

    if (inst.timeSlotSaveTimer) {
      clearInterval(inst.timeSlotSaveTimer);
      inst.timeSlotSaveTimer = null;
      await inst.timeSlotCalculator.save().catch((err) => {
        logger.error(
          `[${instanceName}] Failed to persist time slot data on shutdown: ${err.message}`
        );
      });
    }

    if (inst.server) {
      await shutdownServer(inst.server);
    }
    inst.server = null;
    inst.port = null;
  }

  async stop(instanceName) {
    const name = instanceName || DEFAULT_INSTANCE_NAME;
    const inst = this._getInstance(name);

    if (!inst || !inst.server || !inst.server.listening) {
      logger.warn(`[${name}] No proxy server is currently running`);
      return;
    }

    try {
      if (inst.cleanupSSELogCallback) {
        inst.cleanupSSELogCallback();
        inst.cleanupSSELogCallback = null;
      }

      for (const clientRes of inst.sseClients) {
        try {
          clientRes.end();
        } catch {
          // ignore - client may already be closed
        }
      }
      inst.sseClients.clear();

      if (inst.periodicWeightAdjustTimer) {
        clearInterval(inst.periodicWeightAdjustTimer);
        inst.periodicWeightAdjustTimer = null;
      }

      if (inst.timeSlotCheckTimer) {
        clearInterval(inst.timeSlotCheckTimer);
        inst.timeSlotCheckTimer = null;
      }

      if (inst.errorRateCheckTimer) {
        clearInterval(inst.errorRateCheckTimer);
        inst.errorRateCheckTimer = null;
      }

      if (inst.timeSlotSaveTimer) {
        clearInterval(inst.timeSlotSaveTimer);
        inst.timeSlotSaveTimer = null;
        await inst.timeSlotCalculator.save().catch((err) => {
          logger.error(`[${name}] Failed to persist time slot data on stop: ${err.message}`);
        });
      }

      await shutdownServer(inst.server);
      logger.success(`[${name}] Proxy server stopped (was on port ${inst.port})`);
      inst.server = null;
      inst.port = null;
    } catch (error) {
      logger.error(`[${name}] Failed to stop proxy server: ${error.message}`);
      process.exit(1);
    }
  }

  async stopAll() {
    const names = [...this.instances.keys()];
    for (const name of names) {
      await this.stop(name);
    }
  }

  getStatus(instanceName) {
    const name = instanceName || DEFAULT_INSTANCE_NAME;
    const inst = this._getInstance(name);

    if (!inst) {
      return {
        name,
        running: false,
        port: null,
        pid: undefined,
      };
    }

    return {
      name,
      running: inst.server !== null && inst.server.listening,
      port: inst.port,
      pid: inst.server ? process.pid : undefined,
    };
  }

  getAllStatuses() {
    const statuses = [];
    for (const name of this.instances.keys()) {
      statuses.push(this.getStatus(name));
    }
    return statuses;
  }

  async reloadConfig(instanceName) {
    const name = instanceName || DEFAULT_INSTANCE_NAME;
    const inst = this._getInstance(name);

    if (!inst || !inst.server) {
      return { success: false, error: 'No running proxy instance' };
    }

    if (inst._reloading) {
      return { success: false, deferred: true, error: 'Reload already in progress' };
    }

    inst._reloading = true;

    try {
      const configManager = new ProxyConfigManager();
      const config = await configManager.readConfig();

      if (!config) {
        return { success: false, error: 'Configuration file not found' };
      }

      const validation = configManager.validateConfig(config);
      if (!validation.success) {
        return { success: false, error: `Invalid configuration: ${validation.error}` };
      }

      const newRoutes = await configManager.resolveRoutes(config.routes || {});

      for (const [routeName, route] of Object.entries(newRoutes)) {
        const validation = validateRoute(route);
        if (!validation.valid) {
          return { success: false, error: `Invalid route "${routeName}": ${validation.error}` };
        }
      }

      for (const [routeName, route] of Object.entries(newRoutes)) {
        const validUpstreams = [];
        for (const upstream of route.upstreams || []) {
          if (!upstream.baseURL) {
            const provider = upstream.provider || 'unknown';
            logger.warn(
              `Skipping upstream "${upstream.id || provider}" in route "${routeName}": ` +
                `provider "${provider}" has no baseURL.`
            );
            continue;
          }
          validUpstreams.push(upstream);
        }
        if (validUpstreams.length === 0 && (route.upstreams || []).length > 0) {
          delete newRoutes[routeName];
        } else if (validUpstreams.length < (route.upstreams || []).length) {
          route.upstreams = validUpstreams;
        }
      }

      if (Object.keys(newRoutes).length === 0) {
        return { success: false, error: 'New configuration has no valid routes' };
      }

      const oldRoutesSnapshot = { ...inst._currentRoutes };
      const diff = diffProxyConfigs(
        { routes: serializeRoutes(oldRoutesSnapshot) },
        { routes: serializeRoutes(newRoutes) }
      );

      for (const key of Object.keys(inst._currentRoutes)) {
        delete inst._currentRoutes[key];
      }
      for (const [key, value] of Object.entries(newRoutes)) {
        inst._currentRoutes[key] = value;
      }

      if (config.reliability && inst.circuitBreaker) {
        if (typeof inst.circuitBreaker.updateOptions === 'function') {
          inst.circuitBreaker.updateOptions(config.reliability);
        }
      }

      weightManager.reloadConfig(newRoutes);

      logger.info(`[${name}] Configuration reloaded successfully`);

      return {
        success: true,
        diff,
      };
    } catch (error) {
      logger.error(`[${name}] Failed to reload config: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      inst._reloading = false;
    }
  }

  listInstances() {
    return [...this.instances.keys()];
  }
}

function chainTransforms(...transforms) {
  for (let i = 1; i < transforms.length; i++) {
    transforms[i - 1].pipe(transforms[i]);
  }
  return transforms[0];
}

function serializeRoutes(routes) {
  const result = {};
  for (const [key, route] of Object.entries(routes || {})) {
    result[key] = {
      strategy: route.strategy,
      upstreams: (route.upstreams || []).map((u) => ({
        provider: u.provider,
        model: u.model,
        weight: u.weight,
        timeSlotWeights: u.timeSlotWeights,
      })),
    };
  }
  return result;
}

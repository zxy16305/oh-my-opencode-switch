import {
  routeRequest,
  failoverStickySession,
  recordUpstreamError,
  recordUpstreamLatency,
  recordUpstreamStats,
  adjustWeightForError,
  adjustWeightForLatency,
} from './router.js';
import { forwardRequest } from './server.js';
import { logAccess } from '../utils/access-log.js';
import { logger } from '../utils/logger.js';
import { authenticate, createAuthErrorResponse, extractApiKey } from '../utils/proxy-auth.js';

/**
 * Create request handler for proxy server
 * @param {object} routes - Resolved routes config
 * @param {object} auth - Auth config from proxy config
 * @param {CircuitBreaker} circuitBreaker - Circuit breaker instance
 * @param {function} logCallback - Callback for logging (optional)
 * @returns {function} Request handler function
 */
export function createRequestHandler(routes, auth, circuitBreaker, logCallback) {
  return async (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
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
              model,
              (id) => circuitBreaker.isAvailable(id)
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
              recordUpstreamError(model, upstream.id, proxyRes.statusCode);
              const errorData = new Map([[upstream.id, [proxyRes.statusCode]]]);
              adjustWeightForError(model, route.upstreams, route.dynamicWeight, errorData);
              if (logCallback) {
                logCallback.recordFailure(upstream.provider);
              }
            } else {
              circuitBreaker.recordSuccess(upstream.id);
              recordUpstreamLatency(model, upstream.id, Date.now() - startTime);
              const latencyData = new Map([[upstream.id, { avgDuration: Date.now() - startTime }]]);
              adjustWeightForLatency(model, route.upstreams, route.dynamicWeight, latencyData);
              if (logCallback) {
                logCallback.recordSuccess(upstream.provider);
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
            circuitBreaker.recordFailure(upstream.id);
            recordUpstreamError(model, upstream.id, 502);
            const errorData = new Map([[upstream.id, [502]]]);
            adjustWeightForError(model, route.upstreams, route.dynamicWeight, errorData);
            logger.error(`Upstream error for ${upstream.id}: ${err.message}`);
            if (logCallback) {
              logCallback.recordFailure(upstream.provider);
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
}

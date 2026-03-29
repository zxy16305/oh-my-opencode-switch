import { createServer, shutdownServer } from './server.js';
import { forwardRequest } from './server.js';
import { routeRequest, failoverStickySession } from './router.js';
import { CircuitBreaker } from './circuitbreaker.js';
import { logAccess } from '../utils/access-log.js';

const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
  allowedFails: 3,
  cooldownTimeMs: 60000,
};

export async function startProxyServer({ port, routes, config }) {
  const circuitBreaker = new CircuitBreaker(config?.reliability || DEFAULT_CIRCUIT_BREAKER_OPTIONS);

  const requestHandler = async (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
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
              console.warn(
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

        forwardRequest(req, res, targetUrl, {
          body: forwardBody,
          headers: extraHeaders,
          onProxyRes: (proxyRes) => {
            const duration = Date.now() - startTime;
            proxyRes.headers['x-used-provider'] = upstream.id;
            if (sessionId) {
              proxyRes.headers['x-session-id'] = sessionId;
            }
            if (proxyRes.statusCode >= 400) {
              circuitBreaker.recordFailure(upstream.id);
            } else {
              circuitBreaker.recordSuccess(upstream.id);
            }

            logAccess({
              sessionId: sessionId || null,
              provider: upstream.provider,
              model: upstream.model,
              virtualModel: model,
              status: proxyRes.statusCode,
              duration,
              body: requestBody,
            }).catch(() => {});
          },
          onError: (err) => {
            circuitBreaker.recordFailure(upstream.id);
            console.error(`Upstream error for ${upstream.id}: ${err.message}`);
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
                availableModels: error.details?.availableModels,
              },
            })
          );
        } else {
          console.error(`Request error: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: error.message } }));
        }
      }
    });
  };

  const { server } = await createServer({ port, requestHandler });

  const shutdown = async () => {
    console.log('[proxy] Shutting down...');
    await shutdownServer(server);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, port };
}

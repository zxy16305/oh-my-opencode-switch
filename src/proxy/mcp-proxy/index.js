import http from 'node:http';
import { URL } from 'node:url';
import { McpSseTransformer } from './sse-transformer.js';
import { logger } from '../../utils/logger.js';

export class McpProxy {
  constructor(config = {}) {
    this._routes = new Map();
    for (const [name, entry] of Object.entries(config)) {
      const upstreamUrl = new URL(entry.upstream);
      let prefix = entry.path;
      const upstreamPath = upstreamUrl.pathname;
      if (upstreamPath && upstreamPath !== '/' && entry.path.endsWith(upstreamPath)) {
        prefix = entry.path.slice(0, -upstreamPath.length) || '/';
      }
      this._routes.set(prefix, { name, upstreamUrl, prefix });
    }
  }

  matches(url) {
    const cleanUrl = url.split('?')[0];
    for (const [prefix] of this._routes) {
      if (cleanUrl === prefix || (prefix !== '/' && cleanUrl.startsWith(prefix + '/'))) {
        return true;
      }
    }
    return false;
  }

  handle(req, res) {
    const cleanUrl = req.url.split('?')[0];
    let matchedRoute = null;
    let matchedPrefix = '';
    // Find longest prefix match (in case of overlapping prefixes)
    for (const [prefix, route] of this._routes) {
      if (cleanUrl === prefix || (prefix !== '/' && cleanUrl.startsWith(prefix + '/'))) {
        if (prefix.length > matchedPrefix.length) {
          matchedRoute = route;
          matchedPrefix = prefix;
        }
      }
    }
    if (!matchedRoute) return false;

    const { name, upstreamUrl } = matchedRoute;
    const upstreamPath = req.url.slice(matchedPrefix.length) || '/';

    logger.info(
      `[mcp-proxy] ${name}: ${req.method} ${req.url} → ${upstreamUrl.origin}${upstreamPath}`
    );

    const proxyReq = http.request(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: upstreamPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: upstreamUrl.host,
        },
      },
      (proxyRes) => {
        const isSSE = (proxyRes.headers['content-type'] || '').includes(
          'text/event-stream'
        );

        if (isSSE) {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });

          const transformer = new McpSseTransformer({ pathPrefix: matchedPrefix });
          proxyRes.pipe(transformer).pipe(res);
        } else {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      }
    );

    proxyReq.on('error', (err) => {
      logger.error(`[mcp-proxy] ${name}: upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: `MCP proxy error: upstream unreachable - ${err.message}`,
            },
            id: null,
          })
        );
      }
    });

    // pipe() causes socket hang up with IncomingMessage→ClientRequest; forward body manually
    const bodyChunks = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      if (bodyChunks.length > 0) {
        proxyReq.write(Buffer.concat(bodyChunks));
      }
      proxyReq.end();
    });

    return true;
  }

  updateRoutes(config) {
    this._routes.clear();
    for (const [name, entry] of Object.entries(config)) {
      const upstreamUrl = new URL(entry.upstream);
      let prefix = entry.path;
      const upstreamPath = upstreamUrl.pathname;
      if (upstreamPath && upstreamPath !== '/' && entry.path.endsWith(upstreamPath)) {
        prefix = entry.path.slice(0, -upstreamPath.length) || '/';
      }
      this._routes.set(prefix, { name, upstreamUrl, prefix });
    }
    logger.info(`[mcp-proxy] routes updated: ${this._routes.size} routes`);
  }
}

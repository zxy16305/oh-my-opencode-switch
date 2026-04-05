import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { URL } from 'node:url';
import { OosError } from '../utils/errors.js';
import logger from '../utils/logger.js';

const DEFAULT_PORT = 3000;
export const SSE_HEADERS = {
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    tester.once('listening', () => {
      tester.close();
      resolve(true);
    });
    tester.listen(port);
  });
}

/**
 * @param {http.IncomingMessage | http.ServerResponse} headers
 * @returns {boolean}
 */
function isSSE(headers) {
  const contentType = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  return contentType.includes('text/event-stream');
}

/**
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 */
function sendError(res, statusCode, message) {
  const body = JSON.stringify({ error: { code: statusCode, message } });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * @param {http.IncomingMessage} clientReq
 * @param {URL} targetUrl
 * @returns {http.RequestOptions}
 */
function buildProxyOptions(clientReq, targetUrl, extraHeaders = {}) {
  const headers = { ...clientReq.headers };
  headers.host = targetUrl.host;
  delete headers['connection'];
  delete headers['transfer-encoding'];
  delete headers['keep-alive'];
  delete headers['authorization'];
  Object.assign(headers, extraHeaders);

  return {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: clientReq.method,
    headers,
    rejectUnauthorized: true,
  };
}

/**
 * @param {http.IncomingMessage} clientReq
 * @param {http.ServerResponse} clientRes
 * @param {string} targetUrl
 * @param {{ onProxyReq?: (proxyReq: http.ClientRequest, clientReq: http.IncomingMessage) => void, onProxyRes?: (proxyRes: http.IncomingMessage, clientReq: http.IncomingMessage) => void, onError?: (error: Error, phase: string) => void, body?: string | Buffer, headers?: Record<string, string> }} [options]
 */
export function forwardRequest(clientReq, clientRes, targetUrl, options = {}) {
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    sendError(clientRes, 400, 'Invalid upstream target URL');
    return;
  }

  const proxyOptions = buildProxyOptions(clientReq, parsedTarget, options.headers || {});

  if (options.body !== undefined) {
    proxyOptions.headers['content-length'] = Buffer.byteLength(options.body);
  }

  const transport = parsedTarget.protocol === 'https:' ? https : http;

  const proxyReq = transport.request(proxyOptions, (proxyRes) => {
    if (options.onProxyRes) {
      options.onProxyRes(proxyRes, clientReq);
    }

    if (isSSE(proxyRes.headers)) {
      Object.entries(SSE_HEADERS).forEach(([key, value]) => {
        if (!proxyRes.headers[key.toLowerCase()]) {
          proxyRes.headers[key.toLowerCase()] = value;
        }
      });
    }

    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);

    proxyRes.on('end', () => {
      if (options.onStreamEnd) {
        options.onStreamEnd();
      }
    });

    proxyRes.on('error', (err) => {
      console.error('[proxy] upstream response stream error:', err.message);
      if (options.onError) {
        options.onError(err, 'response');
      }
      if (!clientRes.headersSent) {
        sendError(clientRes, 502, 'Upstream response stream error');
      } else {
        clientRes.end();
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] upstream request error:', err.message);
    if (options.onError) {
      options.onError(err, 'request');
    }
    if (!clientRes.headersSent) {
      sendError(clientRes, 502, `Bad Gateway: ${err.message}`);
    } else {
      clientRes.end();
    }
  });

  if (options.onProxyReq) {
    options.onProxyReq(proxyReq, clientReq);
  }

  if (options.body !== undefined) {
    proxyReq.write(options.body);
    proxyReq.end();
  } else {
    clientReq.pipe(proxyReq);
  }

  clientReq.on('error', (err) => {
    console.error('[proxy] client request stream error:', err.message);
    proxyReq.destroy();
    if (!clientRes.headersSent) {
      sendError(clientRes, 400, `Bad Request: ${err.message}`);
    } else {
      clientRes.end();
    }
  });
}

/**
 * @param {{ port?: number, requestHandler?: (req: http.IncomingMessage, res: http.ServerResponse) => void }} [config]
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
export async function createServer(config = {}) {
  const port = config.port || DEFAULT_PORT;

  const available = await isPortAvailable(port);
  if (!available) {
    throw new OosError(`Port ${port} is already in use. Please choose a different port.`);
  }

  const server = http.createServer((req, res) => {
    try {
      if (config.requestHandler) {
        config.requestHandler(req, res);
      } else {
        sendError(res, 404, 'No route handler configured');
      }
    } catch (err) {
      console.error('[proxy] internal error:', err);
      if (!res.headersSent) {
        sendError(res, 500, `Internal Server Error: ${err.message}`);
      } else {
        res.end();
      }
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[proxy] Port ${port} is already in use.`);
    } else {
      console.error('[proxy] server error:', err.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      logger.info(`[proxy] server listening on port ${port}`);
      resolve({ server, port });
    });

    server.once('error', (err) => {
      reject(err);
    });
  });
}

/**
 * @param {http.Server} server
 * @returns {Promise<void>}
 */
export function shutdownServer(server) {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        logger.info('[proxy] server shut down');
        resolve();
      }
    });

    setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 5000).unref();
  });
}

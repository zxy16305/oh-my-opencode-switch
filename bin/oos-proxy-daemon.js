#! /usr/bin/env node

import { createServer, shutdownServer, isPortAvailable } from '../src/proxy/server.js';
import { ProxyConfigManager } from '../src/core/ProxyConfigManager.js';
import { routeRequest, validateRoutesConfig } from '../src/proxy/router.js';
import { forwardRequest } from '../src/proxy/server.js';
import { getProxyConfigPath } from '../src/utils/proxy-paths.js';
import { exists } from '../src/utils/files.js';

const DEFAULT_PORT = 3000;

let server = null;

async function startDaemon() {
  const configPath = getProxyConfigPath();
  const configManager = new ProxyConfigManager();
  let config = await configManager.readConfig();

  if (!config) {
    if (!(await exists(configPath))) {
      console.warn('[daemon] No proxy configuration found.');
    }
    config = { routes: {} };
  }

  const port = parseInt(process.env.PORT, 10) || config.port || DEFAULT_PORT;

  const available = await isPortAvailable(port);
  if (!available) {
    console.error(`[daemon] Port ${port} is already in use.`);
    process.exit(1);
  }

  const validationResult = validateRoutesConfig(config.routes || {});
  if (!validationResult.success) {
    console.error(`[daemon] Invalid routes configuration: ${validationResult.error}`);
    process.exit(1);
  }

  const routes = validationResult.data;

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

        const { upstream } = routeRequest(model, routes);
        const targetUrl = `${upstream.baseURL}/chat/completions`;

        if (upstream.apiKey) {
          req.headers['authorization'] = `Bearer ${upstream.apiKey}`;
        }

        forwardRequest(req, res, targetUrl);
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
          console.error(`[daemon] Request error: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: error.message } }));
        }
      }
    });
  };

  try {
    const result = await createServer({ port, requestHandler });
    server = result.server;

    console.log(`[daemon] OOS Proxy service started on port ${port}`);
    console.log(`[daemon] Config: ${configPath}`);

    if (Object.keys(routes).length > 0) {
      console.log(`[daemon] Routes: ${Object.keys(routes).join(', ')}`);
    } else {
      console.warn('[daemon] No routes configured');
    }
  } catch (error) {
    console.error(`[daemon] Failed to start: ${error.message}`);
    process.exit(1);
  }
}

async function shutdown() {
  console.log('[daemon] Shutting down OOS Proxy service...');
  if (server) {
    await shutdownServer(server);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startDaemon();

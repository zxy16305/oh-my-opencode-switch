#!/usr/bin/env node
import { startProxyServer } from '../src/proxy/service.js';
import { ProxyConfigManager } from '../src/core/ProxyConfigManager.js';
import { getProxyConfigPath } from '../src/utils/proxy-paths.js';
import { exists } from '../src/utils/files.js';

const DEFAULT_PORT = 3000;

async function main() {
  const configPath = getProxyConfigPath();
  const configManager = new ProxyConfigManager();
  let config = await configManager.readConfig();

  if (!config) {
    if (!(await exists(configPath))) {
      console.error(`[service] No proxy configuration found at ${configPath}`);
      console.error('[service] Run "oos proxy init" to create one.');
      process.exit(1);
    }
    config = { routes: {} };
  }

  const port = config.port || DEFAULT_PORT;
  const routes = await configManager.resolveRoutes(config.routes || {});

  for (const [routeName, route] of Object.entries(routes)) {
    for (const upstream of route.upstreams || []) {
      if (!upstream.baseURL) {
        console.error(
          `[service] Upstream "${upstream.provider}" in route "${routeName}" missing baseURL.`
        );
        process.exit(1);
      }
    }
  }

  await startProxyServer({ port, routes, config });
  console.log(`[service] OOS Proxy started on port ${port}`);
  console.log(`[service] Config: ${configPath}`);
  if (Object.keys(routes).length > 0) {
    console.log(`[service] Routes: ${Object.keys(routes).join(', ')}`);
  }
}

main().catch((err) => {
  console.error('[service] Failed to start:', err.message);
  process.exit(1);
});

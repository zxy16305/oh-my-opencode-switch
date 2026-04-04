import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { getOpencodeConfigPath } from '../utils/proxy-paths.js';
import { readJson, writeJson, exists, copyFile } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { ConfigError } from '../utils/errors.js';
import { getModelLimit } from '../utils/provider-discovery.js';

const DEFAULT_PROXY_PORT = 3000;
const PROVIDER_ID = 'opencode-proxy';

/**
 * Register proxy provider in opencode.json
 * Adds a "proxy" provider with virtual models from proxy-config.json routes
 * @param {object} options - CLI options
 * @param {number} [options.port] - Proxy server port (default: 3000)
 */
export async function registerAction(options = {}) {
  const configManager = new ProxyConfigManager();

  // 1. Read proxy config to get routes and port
  const proxyConfig = await configManager.readConfig();
  if (!proxyConfig || !proxyConfig.routes || Object.keys(proxyConfig.routes).length === 0) {
    logger.error('No routes found in proxy-config.json');
    logger.info('Run "oos proxy init" to create a proxy configuration first.');
    process.exit(1);
  }

  // Port priority: CLI --port > config.port > DEFAULT_PROXY_PORT
  const port = parseInt(options.port, 10) || proxyConfig.port || DEFAULT_PROXY_PORT;

  // 2. Read opencode config
  const opencodePath = getOpencodeConfigPath();
  if (!(await exists(opencodePath))) {
    logger.error('opencode.json not found');
    logger.info('Make sure OpenCode is initialized and has a configuration file.');
    process.exit(1);
  }

  let opencodeConfig;
  try {
    opencodeConfig = await readJson(opencodePath);
  } catch (error) {
    logger.error(`Failed to read opencode.json: ${error.message}`);
    process.exit(1);
  }

  // 3. Backup original file
  const backupPath = `${opencodePath}.bak`;
  try {
    await copyFile(opencodePath, backupPath);
    logger.info(`Backup created at ${backupPath}`);
  } catch (error) {
    logger.warn(`Could not create backup: ${error.message}`);
  }

  // 4. Build proxy provider config
  const proxyProvider = {
    npm: '@ai-sdk/openai-compatible',
    name: 'OOS Proxy',
    options: {
      baseURL: `http://localhost:${port}/v1`,
    },
    models: {},
  };

  const routes = proxyConfig.routes;
  const registeredModels = [];
  const skippedModels = [];

  for (const [virtualModel, route] of Object.entries(routes)) {
    if (!route.upstreams || route.upstreams.length === 0) {
      logger.warn(`Route "${virtualModel}" has no upstreams, skipping.`);
      skippedModels.push(virtualModel);
      continue;
    }

    // Get limits from all upstreams
    const limits = [];
    let modalities = null;
    let modelName = virtualModel;

    for (const upstream of route.upstreams) {
      const providerName = upstream.provider;
      const originalModelName = upstream.model;

      if (!providerName || !originalModelName) {
        logger.warn(
          `Upstream in route "${virtualModel}" missing provider or model, skipping upstream.`
        );
        continue;
      }

      let limit = null;
      let modelMetadata = null;

      const providerConfig = opencodeConfig.provider?.[providerName];
      if (!providerConfig) {
        logger.debug(
          `Provider "${providerName}" not found in opencode.json for route "${virtualModel}", checking models.dev...`
        );
        // Try to get limit from models.dev API
        try {
          const apiLimit = await getModelLimit(providerName, originalModelName);
          if (apiLimit) {
            limit = apiLimit;
            logger.debug(
              `Got limit from models.dev for ${providerName}/${originalModelName}:`,
              limit
            );
          } else {
            logger.debug(
              `No limit found in models.dev for ${providerName}/${originalModelName}, using default`
            );
          }
        } catch (error) {
          logger.debug(
            `Failed to get limit from models.dev for ${providerName}/${originalModelName}: ${error.message}`
          );
        }
      } else {
        const originalModel = providerConfig.models?.[originalModelName];
        if (!originalModel) {
          logger.warn(
            `Model "${originalModelName}" not found in provider "${providerName}" for route "${virtualModel}".`
          );
          continue;
        }
        modelMetadata = originalModel;
        // Use explicit limit from opencode.json if available
        limit = originalModel.limit || null;
      }

      // Fallback to default Infinity if no limit found
      if (!limit) {
        limit = { context: Infinity, output: Infinity };
      }
      limits.push({
        context: limit.context ?? Infinity,
        output: limit.output ?? Infinity,
      });

      // Use first upstream's modalities and name
      if (!modalities) {
        if (modelMetadata) {
          modalities = modelMetadata.modalities || null;
          modelName = modelMetadata.name || virtualModel;
        } else {
          modelName = virtualModel;
        }
      }
    }

    if (limits.length === 0) {
      logger.warn(`No valid upstreams found for route "${virtualModel}", skipping.`);
      skippedModels.push(virtualModel);
      continue;
    }

    // Calculate minimum limit across all upstreams
    const minLimit =
      limits.length === 1
        ? limits[0]
        : {
            context: Math.min(...limits.map((l) => l.context)),
            output: Math.min(...limits.map((l) => l.output)),
          };

    // Build model config
    const modelConfig = {
      name: `${modelName} (Proxy)`,
    };

    if (minLimit.context !== Infinity || minLimit.output !== Infinity) {
      const limitConfig = {};
      if (minLimit.context !== Infinity) limitConfig.context = minLimit.context;
      if (minLimit.output !== Infinity) limitConfig.output = minLimit.output;
      if (Object.keys(limitConfig).length > 0) {
        modelConfig.limit = limitConfig;
      }
    }

    // Add modalities if available
    if (modalities) {
      modelConfig.modalities = modalities;
    }

    proxyProvider.models[virtualModel] = modelConfig;
    registeredModels.push(virtualModel);
  }

  if (registeredModels.length === 0) {
    logger.error('No valid routes to register. Check your proxy-config.json and opencode.json.');
    process.exit(1);
  }

  // 5. Add proxy provider to opencode config
  opencodeConfig.provider = opencodeConfig.provider || {};
  opencodeConfig.provider[PROVIDER_ID] = proxyProvider;

  // 6. Write back to opencode.json
  try {
    await writeJson(opencodePath, opencodeConfig);
    logger.success(`Proxy provider "${PROVIDER_ID}" registered in opencode.json`);
    logger.info(`Registered ${registeredModels.length} model(s):`);
    logger.list(registeredModels);

    if (skippedModels.length > 0) {
      logger.warn(`Skipped ${skippedModels.length} model(s) due to missing config.`);
    }
  } catch (error) {
    logger.error(`Failed to write opencode.json: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Unregister proxy provider from opencode.json
 * Removes the "proxy" provider entry
 */
export async function unregisterAction() {
  const opencodePath = getOpencodeConfigPath();

  // 1. Check opencode.json exists
  if (!(await exists(opencodePath))) {
    logger.error('opencode.json not found');
    process.exit(1);
  }

  // 2. Read opencode config
  let opencodeConfig;
  try {
    opencodeConfig = await readJson(opencodePath);
  } catch (error) {
    logger.error(`Failed to read opencode.json: ${error.message}`);
    process.exit(1);
  }

  // 3. Check if proxy provider exists
  if (!opencodeConfig.provider?.[PROVIDER_ID]) {
    logger.warn('No opencode-proxy provider found in opencode.json');
    return;
  }

  // 4. Backup original file
  const backupPath = `${opencodePath}.bak`;
  try {
    await copyFile(opencodePath, backupPath);
    logger.info(`Backup created at ${backupPath}`);
  } catch (error) {
    logger.warn(`Could not create backup: ${error.message}`);
  }

  // 5. Remove proxy provider
  delete opencodeConfig.provider[PROVIDER_ID];

  // Clean up empty provider object
  if (Object.keys(opencodeConfig.provider).length === 0) {
    delete opencodeConfig.provider;
  }

  // 6. Write back to opencode.json
  try {
    await writeJson(opencodePath, opencodeConfig);
    logger.success(`Proxy provider "${PROVIDER_ID}" removed from opencode.json`);
  } catch (error) {
    logger.error(`Failed to write opencode.json: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Register proxy register commands with Commander program
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerProxyRegisterCommands(program) {
  const proxy = program.commands.find((cmd) => cmd.name() === 'proxy');

  if (!proxy) {
    throw new ConfigError(
      'Proxy command not found. Make sure proxy commands are registered first.'
    );
  }

  proxy
    .command('register')
    .description('Register proxy provider in opencode.json')
    .option('-p, --port <port>', 'Proxy server port (overrides config file)')
    .action(registerAction);

  proxy
    .command('unregister')
    .description('Remove proxy provider from opencode.json')
    .action(unregisterAction);
}

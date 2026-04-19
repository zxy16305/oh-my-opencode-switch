import { program } from 'commander';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { getOpencodeConfigPath } from '../utils/proxy-paths.js';
import { readJson, writeJson, exists, copyFile } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { ConfigError } from '../utils/errors.js';
import { getModelLimit } from '../utils/provider-discovery.js';

const DEFAULT_PROXY_PORT = 3000;
const PROVIDER_ID = 'opencode-proxy';
const PROVIDER_ID_RESPONSES = 'opencode-proxy-responses';

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
    program.error(
      'No routes found in proxy-config.json. Run "oos proxy init" to create a proxy configuration first.',
      { exitCode: 1 }
    );
  }

  // Port priority: CLI --port > config.port > DEFAULT_PROXY_PORT
  const port = parseInt(options.port, 10) || proxyConfig.port || DEFAULT_PROXY_PORT;

  // 2. Read opencode config
  const opencodePath = options.opencodePath || getOpencodeConfigPath();
  if (!(await exists(opencodePath))) {
    program.error(
      'opencode.json not found. Make sure OpenCode is initialized and has a configuration file.',
      { exitCode: 1 }
    );
  }

  let opencodeConfig;
  try {
    opencodeConfig = await readJson(opencodePath);
  } catch (error) {
    program.error(`Failed to read opencode.json: ${error.message}`, { exitCode: 1 });
  }

  // 3. Backup original file
  const backupPath = `${opencodePath}.bak`;
  try {
    await copyFile(opencodePath, backupPath);
    logger.info(`Backup created at ${backupPath}`);
  } catch (error) {
    logger.warn(`Could not create backup: ${error.message}`);
  }

  // 4. Split routes by protocol
  const routes = proxyConfig.routes;
  const chatRoutes = {};
  const responsesRoutes = {};

  for (const [virtualModel, route] of Object.entries(routes)) {
    const protocol = route.protocol || 'chat';
    if (protocol === 'responses') {
      responsesRoutes[virtualModel] = route;
    } else {
      chatRoutes[virtualModel] = route;
    }
  }

  // 5. Build provider configs
  const buildProviderConfig = (baseURL) => ({
    npm: '@ai-sdk/openai-compatible',
    name: 'OOS Proxy',
    options: {
      baseURL,
    },
    models: {},
  });

  const chatProvider = buildProviderConfig(`http://localhost:${port}/v1`);
  const responsesProvider = buildProviderConfig(`http://localhost:${port}/v1/responses`);

  const chatModels = [];
  const responsesModels = [];
  const skippedModels = [];

  /**
   * Process routes and register models to a provider
   * @param {object} providerConfig - Provider config object
   * @param {object} routesToProcess - Routes to process
   * @param {string[]} modelList - Array to collect registered model names
   */
  const processRoutes = async (providerConfig, routesToProcess, modelList) => {
    for (const [virtualModel, route] of Object.entries(routesToProcess)) {
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

        // Use first upstream's modalities (name comes from virtualModel/LB name)
        if (!modalities && modelMetadata) {
          modalities = modelMetadata.modalities || null;
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

      providerConfig.models[virtualModel] = modelConfig;
      modelList.push(virtualModel);
    }
  };

  // Process chat routes
  await processRoutes(chatProvider, chatRoutes, chatModels);
  // Process responses routes
  await processRoutes(responsesProvider, responsesRoutes, responsesModels);

  const totalRegistered = chatModels.length + responsesModels.length;
  if (totalRegistered === 0) {
    program.error('No valid routes to register. Check your proxy-config.json and opencode.json.', {
      exitCode: 1,
    });
  }

  // 6. Add providers to opencode config
  opencodeConfig.provider = opencodeConfig.provider || {};

  if (chatModels.length > 0) {
    opencodeConfig.provider[PROVIDER_ID] = chatProvider;
  }
  if (responsesModels.length > 0) {
    opencodeConfig.provider[PROVIDER_ID_RESPONSES] = responsesProvider;
  }

  // 7. Write back to opencode.json
  try {
    await writeJson(opencodePath, opencodeConfig);

    // Log results
    if (chatModels.length > 0) {
      logger.success(`Proxy provider "${PROVIDER_ID}" registered in opencode.json`);
      logger.info(`Registered ${chatModels.length} chat model(s):`);
      logger.list(chatModels);
    }
    if (responsesModels.length > 0) {
      logger.success(`Proxy provider "${PROVIDER_ID_RESPONSES}" registered in opencode.json`);
      logger.info(`Registered ${responsesModels.length} responses model(s):`);
      logger.list(responsesModels);
    }

    if (skippedModels.length > 0) {
      logger.warn(`Skipped ${skippedModels.length} model(s) due to missing config.`);
    }
  } catch (error) {
    program.error(`Failed to write opencode.json: ${error.message}`, { exitCode: 1 });
  }
}

/**
 * Unregister proxy provider from opencode.json
 * Removes the "proxy" provider entry
 */
export async function unregisterAction(options = {}) {
  const opencodePath = options.opencodePath || getOpencodeConfigPath();

  // 1. Check opencode.json exists
  if (!(await exists(opencodePath))) {
    program.error('opencode.json not found', { exitCode: 1 });
  }

  // 2. Read opencode config
  let opencodeConfig;
  try {
    opencodeConfig = await readJson(opencodePath);
  } catch (error) {
    program.error(`Failed to read opencode.json: ${error.message}`, { exitCode: 1 });
  }

  // 3. Check if any proxy provider exists
  const hasChatProvider = !!opencodeConfig.provider?.[PROVIDER_ID];
  const hasResponsesProvider = !!opencodeConfig.provider?.[PROVIDER_ID_RESPONSES];

  if (!hasChatProvider && !hasResponsesProvider) {
    logger.warn('No opencode-proxy or opencode-proxy-responses provider found in opencode.json');
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

  // 5. Remove proxy providers
  if (hasChatProvider) {
    delete opencodeConfig.provider[PROVIDER_ID];
    logger.success(`Proxy provider "${PROVIDER_ID}" removed from opencode.json`);
  }
  if (hasResponsesProvider) {
    delete opencodeConfig.provider[PROVIDER_ID_RESPONSES];
    logger.success(`Proxy provider "${PROVIDER_ID_RESPONSES}" removed from opencode.json`);
  }

  // Clean up empty provider object
  if (Object.keys(opencodeConfig.provider).length === 0) {
    delete opencodeConfig.provider;
  }

  // 6. Write back to opencode.json
  try {
    await writeJson(opencodePath, opencodeConfig);
  } catch (error) {
    program.error(`Failed to write opencode.json: ${error.message}`, { exitCode: 1 });
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

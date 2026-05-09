import { program } from 'commander';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { getOpencodeConfigPath } from '../utils/proxy-paths.js';
import { readJson, writeJson, exists, copyFile } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { ConfigError } from '../utils/errors.js';
import { getModelMetadata } from '../utils/provider-discovery.js';

const DEFAULT_PROXY_PORT = 3000;
const PROVIDER_ID = 'opencode-proxy';
const PROVIDER_ID_RESPONSES = 'opencode-proxy-responses';
const PLACEHOLDER_API_KEY = 'oos-proxy-placeholder-key';
const MODEL_METADATA_WHITELIST = ['options', 'variants', 'cost', 'limit', 'modalities', 'reasoning', 'thinking'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneDeep(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeMissingModelMetadata(baseMetadata, incomingMetadata) {
  if (!incomingMetadata) {
    return baseMetadata;
  }

  if (!baseMetadata) {
    return cloneDeep(incomingMetadata);
  }

  for (const [key, value] of Object.entries(incomingMetadata)) {
    if (value === undefined) {
      continue;
    }

    if (baseMetadata[key] === undefined) {
      baseMetadata[key] = cloneDeep(value);
      continue;
    }

    if (isPlainObject(baseMetadata[key]) && isPlainObject(value)) {
      mergeMissingModelMetadata(baseMetadata[key], value);
    }
  }

  return baseMetadata;
}

function pickAllowedModelMetadata(metadata) {
  if (!metadata) {
    return null;
  }

  const picked = {};
  for (const key of MODEL_METADATA_WHITELIST) {
    if (metadata[key] !== undefined) {
      picked[key] = cloneDeep(metadata[key]);
    }
  }

  return picked;
}

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
  const buildProviderConfig = (npm, baseURL, name, extraOptions = {}) => ({
    npm,
    name,
    options: {
      baseURL,
      apiKey: PLACEHOLDER_API_KEY,
      ...extraOptions,
    },
    models: {},
  });

  const chatProvider = buildProviderConfig(
    '@ai-sdk/openai-compatible',
    `http://localhost:${port}/v1`,
    'OOS Proxy (Chat)',
    { setCacheKey: true },
  );
  const responsesProvider = buildProviderConfig(
    '@ai-sdk/openai',
    `http://localhost:${port}/v1`,
    'OOS Proxy (Responses)',
    { setCacheKey: true },
  );

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
      let baseModelMetadata = null;
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

        const upstreamProviderConfig = opencodeConfig.provider?.[providerName];
        if (!upstreamProviderConfig) {
          logger.debug(
            `Provider "${providerName}" not found in opencode.json for route "${virtualModel}", checking models.dev...`
          );
          try {
            modelMetadata = await getModelMetadata(providerName, originalModelName);
            if (modelMetadata) {
              limit = modelMetadata.limit || null;
              logger.debug(
                `Got model metadata from models.dev for ${providerName}/${originalModelName}`
              );
            } else {
              logger.debug(
                `No model metadata found in models.dev for ${providerName}/${originalModelName}, using defaults`
              );
            }
          } catch (error) {
            logger.debug(
              `Failed to get model metadata from models.dev for ${providerName}/${originalModelName}: ${error.message}`
            );
          }
        } else {
          const originalModel = upstreamProviderConfig.models?.[originalModelName];
          if (!originalModel) {
            logger.warn(
              `Model "${originalModelName}" not found in provider "${providerName}" for route "${virtualModel}".`
            );
            continue;
          }
           modelMetadata = cloneDeep(originalModel);
           // Use explicit limit from opencode.json if available
           limit = originalModel.limit || null;
         }

         baseModelMetadata = mergeMissingModelMetadata(
           baseModelMetadata,
           pickAllowedModelMetadata(modelMetadata)
         );

        // Fallback to default Infinity if no limit found
        if (!limit) {
          limit = { context: Infinity, output: Infinity };
        }
        limits.push({
          context: limit.context ?? Infinity,
          output: limit.output ?? Infinity,
        });

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
        ...(baseModelMetadata ? cloneDeep(baseModelMetadata) : {}),
        name: `${modelName} (Proxy)`,
      };

      delete modelConfig.limit;

      if (minLimit.context !== Infinity || minLimit.output !== Infinity) {
        const limitConfig = {};
        if (minLimit.context !== Infinity) limitConfig.context = minLimit.context;
        if (minLimit.output !== Infinity) limitConfig.output = minLimit.output;
        if (Object.keys(limitConfig).length > 0) {
          modelConfig.limit = limitConfig;
        }
      }

      // Route-level thinking override — highest priority
      if (route.thinking) {
        modelConfig.thinking = cloneDeep(route.thinking);
      }

      // Route-level reasoningEffort override — highest priority
      if (route.reasoningEffort) {
        modelConfig.reasoning = { effort: route.reasoningEffort };
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

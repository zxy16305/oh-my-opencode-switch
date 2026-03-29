import {
  getProxyConfigPath,
  getOpencodeConfigPath,
  getOpencodeAuthPath,
} from '../utils/proxy-paths.js';
import { readJson, writeJson, exists, ensureDir } from '../utils/files.js';
import { validateProxyConfig } from '../utils/proxy-validators.js';
import { ConfigError, FileSystemError } from '../utils/errors.js';
import { getOosDir } from '../utils/paths.js';

export class ProxyConfigManager {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await ensureDir(getOosDir());
    this.initialized = true;
  }

  async readConfig() {
    await this.init();
    const configPath = getProxyConfigPath();

    if (!(await exists(configPath))) {
      return null;
    }

    try {
      const config = await readJson(configPath);
      const result = validateProxyConfig(config);
      if (!result.success) {
        throw new ConfigError(`Invalid proxy config: ${result.error}`);
      }
      return result.data;
    } catch (error) {
      if (error instanceof FileSystemError || error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(`Failed to read proxy config: ${error.message}`);
    }
  }

  async readOpencodeConfig() {
    const configPath = getOpencodeConfigPath();

    if (!(await exists(configPath))) {
      return null;
    }

    try {
      return await readJson(configPath);
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Failed to read opencode config: ${error.message}`);
    }
  }

  async readOpencodeAuth() {
    const authPath = getOpencodeAuthPath();

    if (!(await exists(authPath))) {
      return null;
    }

    try {
      return await readJson(authPath);
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Failed to read opencode auth: ${error.message}`);
    }
  }

  mergeProviderConfigs(opencodeConfig, authConfig) {
    if (!opencodeConfig && !authConfig) {
      return {};
    }

    const mergedProviders = {};

    if (opencodeConfig?.provider) {
      for (const [providerName, providerConfig] of Object.entries(opencodeConfig.provider)) {
        mergedProviders[providerName] = {
          baseURL: providerConfig?.options?.baseURL,
          apiKey: providerConfig?.options?.apiKey,
        };
      }
    }

    if (authConfig) {
      for (const [authKey, authEntry] of Object.entries(authConfig)) {
        if (authEntry?.type === 'api' && authEntry?.key) {
          const providerName = this._authKeyToProviderName(authKey);
          if (!mergedProviders[providerName]) {
            mergedProviders[providerName] = {};
          }
          if (!mergedProviders[providerName].apiKey) {
            mergedProviders[providerName].apiKey = authEntry.key;
          }
        }
      }
    }

    return mergedProviders;
  }

  _authKeyToProviderName(authKey) {
    const parts = authKey.split('-');
    if (parts.length > 0) {
      return parts[0];
    }
    return authKey;
  }

  async resolveRoutes(routes) {
    const opencodeConfig = await this.readOpencodeConfig();
    const authConfig = await this.readOpencodeAuth();
    const providerInfo = this.mergeProviderConfigs(opencodeConfig, authConfig);

    const resolvedRoutes = {};

    for (const [routeName, route] of Object.entries(routes || {})) {
      const resolvedUpstreams = (route.upstreams || []).map((upstream, index) => {
        const provider = upstream.provider;
        const info = providerInfo[provider] || {};

        if (!upstream.baseURL && info.baseURL) {
          upstream = { ...upstream, baseURL: info.baseURL };
        }

        if (!upstream.apiKey && info.apiKey) {
          upstream = { ...upstream, apiKey: info.apiKey };
        }

        if (!upstream.id) {
          upstream = { ...upstream, id: `${provider}-${upstream.model || index}` };
        }

        return upstream;
      });

      resolvedRoutes[routeName] = {
        ...route,
        upstreams: resolvedUpstreams,
      };
    }

    return resolvedRoutes;
  }

  async writeConfig(config) {
    await this.init();
    const configPath = getProxyConfigPath();

    const result = validateProxyConfig(config);
    if (!result.success) {
      throw new ConfigError(`Invalid proxy config: ${result.error}`);
    }

    try {
      await writeJson(configPath, result.data);
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Failed to write proxy config: ${error.message}`);
    }
  }

  validateConfig(config) {
    return validateProxyConfig(config);
  }
}

export default ProxyConfigManager;

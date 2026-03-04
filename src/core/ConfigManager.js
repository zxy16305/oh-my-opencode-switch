import path from 'path';
import { getSourceConfigPath, getOosDir, getBackupDir } from '../utils/paths.js';
import { writeJson, exists, ensureDir, readJsonWithComments } from '../utils/files.js';
import { ConfigError, FileSystemError } from '../utils/errors.js';
import { opencodeConfigSchema } from '../utils/validators.js';

export class ConfigManager {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await ensureDir(getOosDir());
    await ensureDir(getBackupDir());
    this.initialized = true;
  }

  async readConfig() {
    await this.init();
    const configPath = getSourceConfigPath();

    if (!(await exists(configPath))) {
      throw new ConfigError('OpenCode config file not found. Please initialize OpenCode first.');
    }

    try {
      const config = await readJsonWithComments(configPath);
      opencodeConfigSchema.parse(config);
      return config;
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Invalid config file: ${error.message}`);
    }
  }

  async writeConfig(config) {
    await this.init();
    const configPath = getSourceConfigPath();

    try {
      opencodeConfigSchema.parse(config);
      await writeJson(configPath, config);
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Invalid config: ${error.message}`);
    }
  }

  async backupConfig() {
    await this.init();
    const configPath = getSourceConfigPath();

    if (!(await exists(configPath))) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `oh-my-opencode.${timestamp}.json`;
    const backupPath = path.join(getBackupDir(), backupFileName);

    try {
      const config = await readJsonWithComments(configPath);
      await writeJson(backupPath, config);
      return backupPath;
    } catch (error) {
      throw new ConfigError(`Failed to backup config: ${error.message}`);
    }
  }
}

export default ConfigManager;

import path from 'path';
import fs from 'fs/promises';
import {
  getOosDir,
  getBackupDir,
  getActiveConfigPath,
  getNewConfigFilename,
  getOldConfigFilename,
  getBaseConfigDir,
  getConfigDir,
} from '../utils/paths.js';
import {
  writeJson,
  writeJsonWithComments,
  ensureDir,
  readJsonWithComments,
  remove,
} from '../utils/files.js';
import { ConfigError, FileSystemError } from '../utils/errors.js';
import { opencodeConfigSchema } from '../utils/validators.js';
import { getOpenAgentVersion, isVersionAtLeast } from '../utils/version.js';
import logger from '../utils/logger.js';

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
    const configPath = getActiveConfigPath();

    if (!configPath) {
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

    const version = await getOpenAgentVersion();
    const isNewVersion = isVersionAtLeast('3.15.1', version);

    const filename = isNewVersion ? getNewConfigFilename() : getOldConfigFilename();
    const configPath = path.join(getBaseConfigDir(), filename);

    try {
      opencodeConfigSchema.parse(config);

      if (isNewVersion) {
        await writeJsonWithComments(configPath, config);
      } else {
        await writeJson(configPath, config);
      }
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new ConfigError(`Invalid config: ${error.message}`);
    }
  }

  /**
   * Migrate .bak. backups (created by OpenCode) to .oos/backup/.
   * Root dir keeps 1 latest .bak., .oos/backup/ keeps up to 100.
   * Supports both old (oh-my-opencode.json) and new (oh-my-openagent.jsonc) backup files.
   */
  async backupConfig() {
    await this.init();
    const configDir = getConfigDir();

    try {
      const files = await fs.readdir(configDir);
      // Match both old and new backup file patterns:
      // - oh-my-opencode.json.bak.2026-01-15T10-30-45-123Z
      // - oh-my-openagent.jsonc.bak.2026-01-15T10-30-45-123Z
      const bakPattern =
        /^(oh-my-opencode\.json|oh-my-openagent\.jsonc)\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
      const bakFiles = files
        .filter((file) => bakPattern.test(file))
        .sort()
        .reverse();

      if (bakFiles.length === 0) {
        return null;
      }

      const filesToMove = bakFiles.slice(1);
      const backupDir = getBackupDir();

      for (const bakFile of filesToMove) {
        const srcPath = path.join(configDir, bakFile);
        // Extract base filename and timestamp from backup file
        // oh-my-opencode.json.bak.2026-01-15T10-30-45-123Z �?oh-my-opencode.2026-01-15T10-30-45-123Z.json
        // oh-my-openagent.jsonc.bak.2026-01-15T10-30-45-123Z �?oh-my-openagent.2026-01-15T10-30-45-123Z.jsonc
        const match = bakFile.match(
          /^(oh-my-opencode\.json|oh-my-openagent\.jsonc)\.bak\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/
        );
        const baseFilename = match[1];
        const timestamp = match[2];

        // Determine destination filename preserving the correct prefix and extension
        let destFileName;
        if (baseFilename === 'oh-my-opencode.json') {
          destFileName = `oh-my-opencode.${timestamp}.json`;
        } else {
          destFileName = `oh-my-openagent.${timestamp}.jsonc`;
        }
        const destPath = path.join(backupDir, destFileName);

        await fs.rename(srcPath, destPath);
      }

      await this._cleanupOldBackups(backupDir, 100);

      return bakFiles[0] ? path.join(configDir, bakFiles[0]) : null;
    } catch (error) {
      throw new ConfigError(`Failed to migrate backups: ${error.message}`);
    }
  }

  /**
   * Clean up old backup files, keeping only the latest N files
   * @param {string} backupDir - Backup directory path
   * @param {number} keepCount - Number of files to keep
   * @private
   */
  async _cleanupOldBackups(backupDir, keepCount) {
    const files = await fs.readdir(backupDir);
    // Match both old and new backup file patterns:
    // - oh-my-opencode.2026-01-15T10-30-45-123Z.json
    // - oh-my-openagent.2026-01-15T10-30-45-123Z.jsonc
    const backupPattern =
      /^(oh-my-opencode\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json|oh-my-openagent\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonc)$/;
    const backupFiles = files
      .filter((file) => backupPattern.test(file))
      .sort()
      .reverse();

    if (backupFiles.length > keepCount) {
      const filesToDelete = backupFiles.slice(keepCount);
      logger.info(
        `Cleaning up old backups: found ${backupFiles.length}, keeping ${keepCount}, deleting ${filesToDelete.length}...`
      );
      for (const file of filesToDelete) {
        const filePath = path.join(backupDir, file);
        await remove(filePath);
        logger.success(`Deleted old backup: ${file}`);
      }
    }
  }
}

export default ConfigManager;

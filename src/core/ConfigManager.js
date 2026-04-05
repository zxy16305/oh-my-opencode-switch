import path from 'path';
import fs from 'fs/promises';
import { getSourceConfigPath, getOosDir, getBackupDir } from '../utils/paths.js';
import { writeJson, exists, ensureDir, readJsonWithComments, remove } from '../utils/files.js';
import { ConfigError, FileSystemError } from '../utils/errors.js';
import { opencodeConfigSchema } from '../utils/validators.js';
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

  /**
   * Migrate .bak. backups (created by oh-my-opencode) to .oos/backup/.
   * Root dir keeps 1 latest .bak., .oos/backup/ keeps up to 100.
   */
  async backupConfig() {
    await this.init();
    const configDir = path.dirname(getSourceConfigPath());

    try {
      const files = await fs.readdir(configDir);
      const bakPattern = /^oh-my-opencode\.json\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
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
        const timestamp = bakFile.replace('oh-my-opencode.json.bak.', '');
        const destFileName = `oh-my-opencode.${timestamp}.json`;
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
    const backupPattern = /^oh-my-opencode\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
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

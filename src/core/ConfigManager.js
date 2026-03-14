import path from 'path';
import fs from 'fs/promises';
import { getSourceConfigPath, getOosDir, getBackupDir } from '../utils/paths.js';
import { writeJson, exists, ensureDir, readJsonWithComments, remove } from '../utils/files.js';
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
      
      // Clean up old backups - keep only latest 100
      const backupDir = getBackupDir();
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => /^oh-my-opencode\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/.test(file))
        .sort((a, b) => {
          // Extract timestamp from filename
          const timeA = new Date(a.replace(/oh-my-opencode\.|\.json/g, '').replace(/-/g, ':').replace(/(\d{2}:\d{2}:\d{2}):(\d{3})/, '$1.$2')).getTime();
          const timeB = new Date(b.replace(/oh-my-opencode\.|\.json/g, '').replace(/-/g, ':').replace(/(\d{2}:\d{2}:\d{2}):(\d{3})/, '$1.$2')).getTime();
          return timeA - timeB; // Oldest first
        });
      
      // Delete oldest backups if more than 100
      if (backupFiles.length > 100) {
        const filesToDelete = backupFiles.slice(0, backupFiles.length - 100);
        console.log(`Cleaning up old backups: found ${backupFiles.length} backups, keeping latest 100, deleting ${filesToDelete.length} oldest backups...`);
        for (const file of filesToDelete) {
          const filePath = path.join(backupDir, file);
          await remove(filePath);
          console.log(`  ✓ Deleted old backup: ${file}`);
        }
      }
      
      return backupPath;
    } catch (error) {
      throw new ConfigError(`Failed to backup config: ${error.message}`);
    }
  }
}

export default ConfigManager;

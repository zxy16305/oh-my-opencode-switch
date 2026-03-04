import path from 'path';
import {
  getProfilesDir,
  getProfilesMetadataPath,
  getProfileConfigPath,
  getProfileDirPath,
  getOosDir,
  getTemplatePath,
  getVariablesPath,
  hasTemplate,
} from '../utils/paths.js';
import { readJson, writeJson, exists, ensureDir, copyFile, remove } from '../utils/files.js';
import { validateProfileName, validateProfilesMetadata } from '../utils/validators.js';
import { ProfileError, ConfigError, MissingVariableError } from '../utils/errors.js';
import { ConfigManager } from './ConfigManager.js';
import { TemplateEngine } from './TemplateEngine.js';

const DEFAULT_CONFIG_TEMPLATE = {
  $schema:
    'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json',
  agents: {},
  categories: {},
};

export class ProfileManager {
  constructor() {
    this.configManager = new ConfigManager();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await this.configManager.init();
    await ensureDir(getOosDir());
    await ensureDir(getProfilesDir());
    this.initialized = true;
  }

  async getMetadata() {
    await this.init();
    const metaPath = getProfilesMetadataPath();

    if (!(await exists(metaPath))) {
      return {
        version: 1,
        activeProfile: null,
        profiles: {},
      };
    }

    try {
      const metadata = await readJson(metaPath);
      const result = validateProfilesMetadata(metadata);
      if (!result.success) {
        throw new ProfileError(`Invalid metadata: ${result.error}`);
      }
      return result.data;
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      throw new ProfileError(`Failed to read metadata: ${error.message}`);
    }
  }

  async saveMetadata(metadata) {
    await this.init();
    const metaPath = getProfilesMetadataPath();
    try {
      const result = validateProfilesMetadata(metadata);
      if (!result.success) {
        throw new ProfileError(`Invalid metadata: ${result.error}`);
      }
      await writeJson(metaPath, metadata);
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      throw new ProfileError(`Failed to save metadata: ${error.message}`);
    }
  }

  async listProfiles() {
    await this.init();
    const metadata = await this.getMetadata();
    return Object.values(metadata.profiles).map((profile) => ({
      ...profile,
      isActive: profile.name === metadata.activeProfile,
    }));
  }

  async getProfile(name) {
    await this.init();
    const metadata = await this.getMetadata();
    const profile = metadata.profiles[name];

    if (!profile) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    return {
      ...profile,
      isActive: profile.name === metadata.activeProfile,
    };
  }

  async createProfile(name, options = {}) {
    await this.init();
    const { description = '', template = false } = options;

    const nameValidation = validateProfileName(name);
    if (!nameValidation.success) {
      throw new ProfileError(nameValidation.error);
    }

    const metadata = await this.getMetadata();
    if (metadata.profiles[name]) {
      throw new ProfileError(`Profile "${name}" already exists`);
    }

    let config;
    try {
      config = await this.configManager.readConfig();
    } catch (error) {
      if (error instanceof ConfigError) {
        config = DEFAULT_CONFIG_TEMPLATE;
      } else {
        throw error;
      }
    }

    const profileDir = getProfileDirPath(name);
    await ensureDir(profileDir);

    if (template) {
      await writeJson(getTemplatePath(name), config);
      await writeJson(getVariablesPath(name), {});
    } else {
      await writeJson(getProfileConfigPath(name), config);
    }

    const now = new Date().toISOString();
    metadata.profiles[name] = {
      name,
      description,
      createdAt: now,
      updatedAt: now,
      isDefault: Object.keys(metadata.profiles).length === 0,
    };

    if (!metadata.activeProfile) {
      metadata.activeProfile = name;
    }

    await this.saveMetadata(metadata);
    return { ...metadata.profiles[name], template };
  }

  async deleteProfile(name) {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.profiles[name]) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    const profileDir = getProfileDirPath(name);
    await remove(profileDir);

    delete metadata.profiles[name];

    if (metadata.activeProfile === name) {
      const remaining = Object.keys(metadata.profiles);
      metadata.activeProfile = remaining.length > 0 ? remaining[0] : null;
    }

    await this.saveMetadata(metadata);
    return true;
  }

  async copyProfile(sourceName, targetName) {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.profiles[sourceName]) {
      throw new ProfileError(`Source profile "${sourceName}" not found`);
    }

    const nameValidation = validateProfileName(targetName);
    if (!nameValidation.success) {
      throw new ProfileError(nameValidation.error);
    }

    if (metadata.profiles[targetName]) {
      throw new ProfileError(`Target profile "${targetName}" already exists`);
    }

    const sourceMode = await this.detectProfileMode(sourceName);
    const targetDir = getProfileDirPath(targetName);

    await ensureDir(targetDir);

    if (sourceMode === 'template') {
      const sourceTemplatePath = getTemplatePath(sourceName);
      const sourceVariablesPath = getVariablesPath(sourceName);
      const targetTemplatePath = getTemplatePath(targetName);
      const targetVariablesPath = getVariablesPath(targetName);

      await copyFile(sourceTemplatePath, targetTemplatePath);

      if (await exists(sourceVariablesPath)) {
        await copyFile(sourceVariablesPath, targetVariablesPath);
      }
    } else {
      const sourcePath = getProfileConfigPath(sourceName);
      const targetPath = getProfileConfigPath(targetName);
      await copyFile(sourcePath, targetPath);
    }

    const now = new Date().toISOString();
    metadata.profiles[targetName] = {
      name: targetName,
      description: `Copy of ${sourceName}`,
      createdAt: now,
      updatedAt: now,
      isDefault: false,
    };

    await this.saveMetadata(metadata);
    return metadata.profiles[targetName];
  }

  async renameProfile(oldName, newName) {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.profiles[oldName]) {
      throw new ProfileError(`Profile "${oldName}" not found`);
    }

    const nameValidation = validateProfileName(newName);
    if (!nameValidation.success) {
      throw new ProfileError(nameValidation.error);
    }

    if (metadata.profiles[newName]) {
      throw new ProfileError(`Profile "${newName}" already exists`);
    }

    const oldDir = getProfileDirPath(oldName);
    const newDir = getProfileDirPath(newName);
    const oldConfig = getProfileConfigPath(oldName);
    const newConfig = getProfileConfigPath(newName);

    await ensureDir(path.dirname(newDir));

    if (await exists(oldConfig)) {
      const config = await readJson(oldConfig);
      await ensureDir(newDir);
      await writeJson(newConfig, config);
    }

    const profile = metadata.profiles[oldName];
    delete metadata.profiles[oldName];

    metadata.profiles[newName] = {
      ...profile,
      name: newName,
      updatedAt: new Date().toISOString(),
    };

    if (metadata.activeProfile === oldName) {
      metadata.activeProfile = newName;
    }

    await remove(oldDir);
    await this.saveMetadata(metadata);

    return metadata.profiles[newName];
  }

  async getActiveProfile() {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.activeProfile) {
      return null;
    }

    return metadata.profiles[metadata.activeProfile] || null;
  }

  /**
   * Detect the mode of a profile (legacy or template)
   * @param {string} name - Profile name
   * @returns {Promise<'legacy'|'template'>} Profile mode
   */
  async detectProfileMode(name) {
    await this.init();

    if (await hasTemplate(name)) {
      return 'template';
    }
    return 'legacy';
  }

  /**
   * Switch to a profile (supports both legacy and template modes)
   * @param {string} name - Profile name
   * @returns {Promise<Object>} Switched profile metadata
   */
  async switchProfile(name) {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.profiles[name]) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    const mode = await this.detectProfileMode(name);

    await this.configManager.backupConfig();

    if (mode === 'template') {
      await this._switchTemplateProfile(name);
    } else {
      await this._switchLegacyProfile(name);
    }

    metadata.activeProfile = name;
    metadata.profiles[name].lastUsedAt = new Date().toISOString();
    await this.saveMetadata(metadata);

    return metadata.profiles[name];
  }

  /**
   * Switch to a legacy profile (copy config.json)
   * @param {string} name - Profile name
   * @private
   */
  async _switchLegacyProfile(name) {
    const profileConfigPath = getProfileConfigPath(name);
    if (!(await exists(profileConfigPath))) {
      throw new ProfileError(`Profile config file missing: ${name}`);
    }

    const profileConfig = await readJson(profileConfigPath);
    await this.configManager.writeConfig(profileConfig);
  }

  /**
   * Switch to a template profile (render template + variables)
   * @param {string} name - Profile name
   * @private
   */
  async _switchTemplateProfile(name) {
    const templatePath = getTemplatePath(name);
    const variablesPath = getVariablesPath(name);

    if (!(await exists(templatePath))) {
      throw new ProfileError(`Template file missing for profile: ${name}`);
    }

    let templateObj = await readJson(templatePath);
    let variables = {};

    if (await exists(variablesPath)) {
      variables = await readJson(variablesPath);
    }

    const renderedConfig = await this._renderTemplate(templateObj, variables);
    await this.configManager.writeConfig(renderedConfig);
  }

  /**
   * Render a template object with variables
   * @param {Object} templateObj - Template object
   * @param {Object} variables - Variables for substitution
   * @returns {Promise<Object>} Rendered config
   * @private
   */
  async _renderTemplate(templateObj, variables) {
    const templateEngine = new TemplateEngine();
    const templateStr = JSON.stringify(templateObj);

    try {
      const renderedStr = templateEngine.render(templateStr, variables);
      return JSON.parse(renderedStr);
    } catch (error) {
      if (error instanceof MissingVariableError) {
        throw new ProfileError(`Missing variable in template: ${error.variableName}`);
      }
      throw new ProfileError(`Failed to render template: ${error.message}`);
    }
  }
}

export default ProfileManager;

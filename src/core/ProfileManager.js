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
  constructor(options = {}) {
    // Allow tests/consumers to override base path for profile data
    this.basePath = options.basePath || null;
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

    const profileMode = await this.detectProfileMode(oldName);

    await ensureDir(path.dirname(newDir));

    if (profileMode === 'template') {
      const oldTemplatePath = getTemplatePath(oldName);
      const newTemplatePath = getTemplatePath(newName);
      const oldVariablesPath = getVariablesPath(oldName);
      const newVariablesPath = getVariablesPath(newName);

      await ensureDir(newDir);
      await copyFile(oldTemplatePath, newTemplatePath);

      if (await exists(oldVariablesPath)) {
        await copyFile(oldVariablesPath, newVariablesPath);
      }
    } else if (await exists(oldConfig)) {
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
   * Export a profile configuration to a JSON export file.
   * Location resolution:
   * - If a basePath is provided, reads from {basePath}/profiles/{name}/config.json
   * - Falls back to the default path {profilesDir}/{name}/config.json
   * Export structure: { version: 1, exportedAt, profile, config }
   * Export destination: outputPath if provided, otherwise {basePath}/exports/{name}.export.json
   *                     when basePath not provided, defaults to {getOosDir()}/exports/...
   * @param {string} name - profile name
   * @param {Object} options - optional parameters
   * @param {string} options.outputPath - explicit export path
   * @returns {Promise<Object>} export object
   */
  async exportProfile(name, options = {}) {
    const { outputPath } = options;

    // Locate profile config
    let config = null;
    // Try basePath first if provided
    if (this.basePath) {
      const customPath = path.join(this.basePath, 'profiles', name, 'config.json');
      if (await exists(customPath)) {
        config = await readJson(customPath);
      }
    }

    // Fallback to default path if not found yet
    if (config == null) {
      const defaultPath = getProfileConfigPath(name);
      if (await exists(defaultPath)) {
        config = await readJson(defaultPath);
      }
    }

    if (config == null) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    const exportObj = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: name,
      config,
    };

    // If the profile is a template, include the template and variables in the export
    if (await hasTemplate(name)) {
      try {
        const template = await readJson(getTemplatePath(name));
        const varsPath = getVariablesPath(name);
        const hasVars = await exists(varsPath);
        const variables = hasVars ? await readJson(varsPath) : {};
        exportObj.template = template;
        exportObj.variables = variables;
      } catch (err) {
        // Do not fail export because of template read issues; keep legacy export intact
        // Errors here are non-fatal to preserve backward compatibility
      }
    }

    let exportPath;
    if (outputPath) {
      exportPath = outputPath;
    } else if (this.basePath) {
      exportPath = path.join(this.basePath, 'exports', `${name}.export.json`);
    } else {
      exportPath = path.join(getOosDir(), 'exports', `${name}.export.json`);
    }

    await ensureDir(path.dirname(exportPath));
    await writeJson(exportPath, exportObj);

    return exportObj;
  }

  /**
   * Import a profile from a JSON export file.
   * Expected export format: { version: 1, profile: <name>, config: <object> }
   * - Do not switch active profile during import
   * - Reset metadata: createdAt, isDefault = false
   * - Create profile directory and write config.json
   * @param {string} importPath - Path to the export JSON file
   * @param {Object} [options] - Optional params (currently unused)
   * @returns {Promise<Object>} Imported profile metadata entry
   */
  async importProfile(importPath, options = {}) {
    if (this.basePath) {
      // Step 1: Read and parse import file
      let payload;
      try {
        payload = await readJson(importPath);
      } catch (error) {
        if (error && error.name === 'FileSystemError') {
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('file not found')) {
            throw error;
          }
          if (msg.includes('invalid json')) {
            throw new ProfileError('Invalid export JSON');
          }
          throw error;
        }
        throw new ProfileError(`Invalid export: ${error?.message ?? ''}`);
      }

      // Step 2: Validate presence of version
      if (!payload || typeof payload.version === 'undefined') {
        throw new ProfileError('Export is missing version');
      }

      // Step 3: Validate profile name
      const profileName = payload.profile;
      const nameValidation = validateProfileName(profileName);
      if (!nameValidation.success) {
        throw new ProfileError(nameValidation.error);
      }

      // Step 4: Validate config presence
      const config = payload.config;
      if (config === undefined) {
        throw new ProfileError('Export is missing config');
      }

      // Step 5: Create destination profile directory
      const profileDir = path.join(this.basePath, 'profiles', profileName);
      await ensureDir(profileDir);
      const destConfigPath = path.join(profileDir, 'config.json');
      await writeJson(destConfigPath, config);

      // If the export contains template data, persist template and variables as well
      if (payload.template !== undefined) {
        const destTemplatePath = path.join(profileDir, 'template.json');
        const destVariablesPath = path.join(profileDir, 'variables.json');
        await writeJson(destTemplatePath, payload.template);
        await writeJson(destVariablesPath, payload.variables || {});
      }

      const metadataPath = path.join(this.basePath, 'profiles.json');
      let metadata = { version: 1, activeProfile: null, profiles: {} };
      if (await exists(metadataPath)) {
        try {
          const existing = await readJson(metadataPath);
          const result = validateProfilesMetadata(existing);
          if (!result.success) {
            throw new ProfileError(`Invalid metadata: ${result.error}`);
          }
          metadata = result.data;
        } catch (e) {
          if (e instanceof ProfileError) throw e;
          throw new ProfileError(`Failed to read metadata: ${e.message}`);
        }
      }

      if (metadata.profiles[profileName]) {
        throw new ProfileError(`Profile "${profileName}" already exists`);
      }

      const now = new Date().toISOString();
      metadata.profiles[profileName] = {
        name: profileName,
        description: '',
        createdAt: now,
        updatedAt: now,
        isDefault: false,
      };

      // Persist metadata to basePath
      const metaValidated = validateProfilesMetadata(metadata);
      if (!metaValidated.success) {
        throw new ProfileError(`Invalid metadata: ${metaValidated.error}`);
      }
      await writeJson(metadataPath, metadata);

      return metadata.profiles[profileName];
    }

    // Fallback to global path handling (existing behavior)
    await this.init();
    // Step 1: Read and parse import file
    let payload;
    try {
      payload = await readJson(importPath);
    } catch (error) {
      if (error && error.name === 'FileSystemError') {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('file not found')) {
          throw error;
        }
        if (msg.includes('invalid json')) {
          throw new ProfileError('Invalid export JSON');
        }
        throw error;
      }
      throw new ProfileError(`Invalid export: ${error?.message ?? ''}`);
    }

    if (!payload || typeof payload.version === 'undefined') {
      throw new ProfileError('Export is missing version');
    }

    const profileName = payload.profile;
    const nameValidation = validateProfileName(profileName);
    if (!nameValidation.success) {
      throw new ProfileError(nameValidation.error);
    }

    const config = payload.config;
    if (config === undefined) {
      throw new ProfileError('Export is missing config');
    }

    const profileDir = getProfileDirPath(profileName);
    await ensureDir(profileDir);
    const destConfigPath = getProfileConfigPath(profileName);
    await writeJson(destConfigPath, config);

    // Support template exports when importing from global exports
    if (payload.template !== undefined) {
      const destTemplatePath = getTemplatePath(profileName);
      const destVariablesPath = getVariablesPath(profileName);
      await writeJson(destTemplatePath, payload.template);
      await writeJson(destVariablesPath, payload.variables || {});
    }

    const metadata = await this.getMetadata();
    if (metadata.profiles[profileName]) {
      throw new ProfileError(`Profile "${profileName}" already exists`);
    }
    const now = new Date().toISOString();
    metadata.profiles[profileName] = {
      name: profileName,
      description: '',
      createdAt: now,
      updatedAt: now,
      isDefault: false,
    };
    await this.saveMetadata(metadata);
    return metadata.profiles[profileName];
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

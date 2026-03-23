import path from 'path';
import {
  getProfilesDir,
  getProfilesMetadataPath,
  getProfileDirPath,
  getOosDir,
  getTemplatePath,
  getVariablesPath,
} from '../utils/paths.js';
import { readJson, writeJson, exists, ensureDir, copyFile, remove } from '../utils/files.js';
import { validateProfileName, validateProfilesMetadata } from '../utils/validators.js';
import { ProfileError, ConfigError, MissingVariableError } from '../utils/errors.js';
import { ConfigManager } from './ConfigManager.js';
import { TemplateEngine } from './TemplateEngine.js';
import { DEFAULT_TEMPLATE_JSON } from '../commands/init.js';

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
    const { description = '' } = options;

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

    await writeJson(getTemplatePath(name), config);
    await writeJson(getVariablesPath(name), {});

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
    return { ...metadata.profiles[name] };
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

    const targetDir = getProfileDirPath(targetName);
    await ensureDir(targetDir);

    const sourceTemplatePath = getTemplatePath(sourceName);
    const sourceVariablesPath = getVariablesPath(sourceName);
    const targetTemplatePath = getTemplatePath(targetName);
    const targetVariablesPath = getVariablesPath(targetName);

    await copyFile(sourceTemplatePath, targetTemplatePath);

    if (await exists(sourceVariablesPath)) {
      await copyFile(sourceVariablesPath, targetVariablesPath);
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

    await ensureDir(path.dirname(newDir));

    const oldTemplatePath = getTemplatePath(oldName);
    const newTemplatePath = getTemplatePath(newName);
    const oldVariablesPath = getVariablesPath(oldName);
    const newVariablesPath = getVariablesPath(newName);

    await ensureDir(newDir);
    await copyFile(oldTemplatePath, newTemplatePath);

    if (await exists(oldVariablesPath)) {
      await copyFile(oldVariablesPath, newVariablesPath);
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
   * Export structure: { version: 1, exportedAt, profile, template, variables }
   * Export destination: outputPath if provided, otherwise {getOosDir()}/exports/...
   * @param {string} name - profile name
   * @param {Object} options - optional parameters
   * @param {string} options.outputPath - explicit export path
   * @returns {Promise<Object>} export object
   */
  async exportProfile(name, options = {}) {
    const { outputPath } = options;

    // Read template and variables
    const templatePath = getTemplatePath(name);
    if (!(await exists(templatePath))) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    const template = await readJson(templatePath);
    const varsPath = getVariablesPath(name);
    const hasVars = await exists(varsPath);
    const variables = hasVars ? await readJson(varsPath) : {};

    const exportObj = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: name,
      template,
      variables,
    };

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
   * Expected export format: { version: 1, profile: <name>, template: <object>, variables: <object> }
   * - Do not switch active profile during import
   * - Reset metadata: createdAt, isDefault = false
   * - Create profile directory and write template.json and variables.json
   * @param {string} importPath - Path to the export JSON file
   * @param {Object} [options] - Optional params (currently unused)
   * @returns {Promise<Object>} Imported profile metadata entry
   */
  async importProfile(importPath, _options = {}) {
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

    const template = payload.template;
    if (template === undefined) {
      throw new ProfileError('Export is missing template');
    }

    const profileDir = getProfileDirPath(profileName);
    await ensureDir(profileDir);
    const destTemplatePath = getTemplatePath(profileName);
    const destVariablesPath = getVariablesPath(profileName);
    await writeJson(destTemplatePath, template);
    await writeJson(destVariablesPath, payload.variables || {});

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
   * Switch to a profile (template mode)
   * @param {string} name - Profile name
   * @returns {Promise<Object>} Switched profile metadata
   */
  async switchProfile(name) {
    await this.init();
    const metadata = await this.getMetadata();

    if (!metadata.profiles[name]) {
      throw new ProfileError(`Profile "${name}" not found`);
    }

    await this.configManager.backupConfig();

    await this._switchTemplateProfile(name);

    metadata.activeProfile = name;
    metadata.profiles[name].lastUsedAt = new Date().toISOString();
    await this.saveMetadata(metadata);

    return metadata.profiles[name];
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
      let renderedConfig = JSON.parse(renderedStr);

      // Process model arrays: split into model + fallback_models
      renderedConfig = this._processModelArrays(renderedConfig);

      return renderedConfig;
    } catch (error) {
      if (error instanceof MissingVariableError) {
        throw new ProfileError(`Missing variable in template: ${error.variableName}`);
      }
      throw new ProfileError(`Failed to render template: ${error.message}`);
    }
  }

  /**
   * Process model arrays in config, splitting them into model (string) and fallback_models (array)
   * @param {Object} config - Rendered config object
   * @returns {Object} Processed config with model arrays split
   * @private
   */
  _processModelArrays(config) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    // Deep clone to avoid mutating the original
    const clone = JSON.parse(JSON.stringify(config));

    const walk = (node) => {
      if (!node || typeof node !== 'object') return node;

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          node[i] = walk(node[i]);
        }
        return node;
      }

      // Process object properties
      for (const [key, value] of Object.entries(node)) {
        if (key === 'model') {
          if (Array.isArray(value)) {
            if (value.length > 1) {
              // Multiple models: first -> model, rest -> fallback_models
              node['model'] = value[0];
              node['fallback_models'] = value.slice(1);
            } else if (value.length === 1) {
              // Single model: just set model, no fallback_models
              node['model'] = value[0];
              if (Object.prototype.hasOwnProperty.call(node, 'fallback_models')) {
                delete node['fallback_models'];
              }
            } else {
              // Empty array: set to null
              node['model'] = null;
              if (Object.prototype.hasOwnProperty.call(node, 'fallback_models')) {
                delete node['fallback_models'];
              }
            }
          }
          // If value is not an array (string, null, undefined), leave as-is
          continue;
        }
        // Recursively process nested objects
        node[key] = walk(value);
      }
      return node;
    };

    return walk(clone);
  }

  /**
   * Update templates for all profiles that share the same template name.
   * @param {string} sourceProfileName - Source profile name to copy template from
   * @param {Object} options - Optional parameters
   * @param {boolean} options.useDefault - Use DEFAULT_TEMPLATE_JSON instead of source profile
   * @returns {Promise<Object>} Result with updated, failed, and skipped arrays
   */
  async updateTemplates(sourceProfileName, options = {}) {
    const { useDefault = false } = options;

    await this.init();

    let sourceTemplate;
    if (useDefault) {
      sourceTemplate = DEFAULT_TEMPLATE_JSON;
    } else {
      if (!sourceProfileName) {
        throw new ProfileError('Source profile name is required when not using default template');
      }
      const sourcePath = getTemplatePath(sourceProfileName);
      if (!(await exists(sourcePath))) {
        throw new ProfileError(`Source profile "${sourceProfileName}" not found`);
      }
      sourceTemplate = await readJson(sourcePath);
    }

    const oosVersionTag = sourceTemplate.oosVersionTag;
    if (!oosVersionTag) {
      throw new ProfileError('Source template has no oosVersionTag');
    }
    const templateName = oosVersionTag.split(':')[0];

    const profiles = await this.listProfiles();
    const matches = [];
    for (const profile of profiles) {
      const templatePath = getTemplatePath(profile.name);
      if (!(await exists(templatePath))) continue;
      const template = await readJson(templatePath);
      if (template.oosVersionTag && template.oosVersionTag.startsWith(`${templateName}:`)) {
        matches.push(profile.name);
      }
    }

    const updated = [];
    const failed = [];
    for (const profileName of matches) {
      try {
        const templatePath = getTemplatePath(profileName);
        const backupPath = `${templatePath}.bak`;
        await copyFile(templatePath, backupPath);
        await writeJson(templatePath, sourceTemplate);
        updated.push(profileName);
      } catch (error) {
        failed.push({ name: profileName, error: error.message });
      }
    }

    return { updated, failed, skipped: [] };
  }
}

export default ProfileManager;

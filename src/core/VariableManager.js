import { getVariablesPath, getProfileDirPath } from '../utils/paths.js';
import { readJson, writeJson, exists, ensureDir } from '../utils/files.js';
import { validateVariableName, validateModelValue } from '../utils/validators.js';
import { VariableValidationError, FileSystemError } from '../utils/errors.js';

/**
 * VariableManager - Per-profile variable management
 * Variables are stored in ~/.config/opencode/.oos/profiles/{profileName}/variables.json
 */
export class VariableManager {
  /**
   * @param {string} profileName - Name of the profile to manage variables for
   */
  constructor(profileName) {
    this.profileName = profileName;
    this.initialized = false;
    this.variables = {};
  }

  /**
   * Initialize the VariableManager - ensure profile directory exists
   */
  async init() {
    if (this.initialized) return;

    const profileDir = getProfileDirPath(this.profileName);
    await ensureDir(profileDir);

    // Load existing variables if file exists
    const variablesPath = getVariablesPath(this.profileName);
    if (await exists(variablesPath)) {
      try {
        this.variables = await readJson(variablesPath);

        // Migration: Convert string model value to array format
        if (this.variables.model !== undefined) {
          const oldModel = this.variables.model;
          let migrated = false;

          // Convert string to single-element array
          if (typeof oldModel === 'string') {
            this.variables.model = [oldModel];
            migrated = true;
          }

          // Validate the model value
          const validation = validateModelValue(this.variables.model);
          if (validation.success) {
            // Use validated data (which may have deduplication)
            this.variables.model = validation.data;

            // Save if migration occurred
            if (migrated) {
              await this._save();
            }
          }
          // If validation fails, keep the original value (follow existing pattern)
        }
      } catch (error) {
        // If file is corrupt or unreadable, start fresh
        this.variables = {};
      }
    }

    this.initialized = true;
  }

  /**
   * Get a variable value by name
   * @param {string} variableName - Name of the variable (UPPER_SNAKE_CASE)
   * @returns {any} Variable value or undefined if not found
   */
  async get(variableName) {
    await this.init();
    return this.variables[variableName];
  }

  /**
   * Set a variable value
   * @param {string} variableName - Name of the variable (UPPER_SNAKE_CASE)
   * @param {any} value - Value to set (must be JSON-serializable)
   * @throws {VariableValidationError} If variable name is invalid
   */
  async set(variableName, value) {
    await this.init();

    // Validate variable name
    const validation = validateVariableName(variableName);
    if (!validation.success) {
      throw new VariableValidationError(variableName, validation.error);
    }

    this.variables[variableName] = value;
    await this._save();
  }

  /**
   * List all variables as an object
   * @returns {Object} All variables as key-value pairs
   */
  async list() {
    await this.init();
    return { ...this.variables };
  }

  /**
   * Delete a variable
   * @param {string} variableName - Name of the variable to delete
   * @returns {boolean} True if variable was deleted, false if it didn't exist
   */
  async delete(variableName) {
    await this.init();

    if (!(variableName in this.variables)) {
      return false;
    }

    delete this.variables[variableName];
    await this._save();
    return true;
  }

  /**
   * Check if a variable exists
   * @param {string} variableName - Name of the variable to check
   * @returns {boolean} True if variable exists
   */
  async has(variableName) {
    await this.init();
    return variableName in this.variables;
  }

  /**
   * Save variables to file
   * @private
   */
  async _save() {
    const variablesPath = getVariablesPath(this.profileName);
    try {
      await writeJson(variablesPath, this.variables);
    } catch (error) {
      throw new FileSystemError(`Failed to save variables: ${error.message}`);
    }
  }
}

export default VariableManager;

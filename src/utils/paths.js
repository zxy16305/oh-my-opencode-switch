import path from 'path';
import os from 'os';
import fs from 'fs';
import { exists } from './files.js';

/**
 * Base configuration directory
 * Windows: %USERPROFILE%\.config\opencode
 * Unix: ~/.config/opencode
 * Uses OOS_TEST_HOME env var for test isolation if set.
 */
export const getBaseConfigDir = () => {
  // Test environment safety validation
  // Prevents tests from accidentally writing to real user config
  if (process.env.NODE_ENV === 'test' && !process.env.OOS_TEST_HOME) {
    throw new Error(
      'Test environment requires OOS_TEST_HOME to be set. ' +
        'Use setupTestHome() from tests/helpers/test-home.js'
    );
  }

  const homeDir = process.env.OOS_TEST_HOME || os.homedir();
  return path.join(homeDir, '.config', 'opencode');
};

/**
 * OOS storage directory
 * ~/.config/opencode/.oos/
 */
export const getOosDir = () => {
  return path.join(getBaseConfigDir(), '.oos');
};

/**
 * Profiles storage directory
 * ~/.config/opencode/.oos/profiles/
 */
export const getProfilesDir = () => {
  return path.join(getOosDir(), 'profiles');
};

/**
 * Path to profiles metadata file
 * ~/.config/opencode/.oos/profiles.json
 */
export const getProfilesMetadataPath = () => {
  return path.join(getOosDir(), 'profiles.json');
};

/**
 * Source configuration file path
 * ~/.config/opencode/oh-my-opencode.json
 */
export const getSourceConfigPath = () => {
  return path.join(getBaseConfigDir(), 'oh-my-opencode.json');
};

/**
 * Get new configuration filename
 * @returns {string} 'oh-my-openagent.jsonc'
 */
export const getNewConfigFilename = () => {
  return 'oh-my-openagent.jsonc';
};

/**
 * Get old configuration filename
 * @returns {string} 'oh-my-opencode.json'
 */
export const getOldConfigFilename = () => {
  return 'oh-my-opencode.json';
};

/**
 * Get all source configuration file paths
 * Returns paths in priority order: new config first, then old config
 * @returns {string[]} Array of configuration file paths
 */
export const getSourceConfigPaths = () => {
  const baseDir = getBaseConfigDir();
  return [path.join(baseDir, getNewConfigFilename()), path.join(baseDir, getOldConfigFilename())];
};

/**
 * Get the active configuration file path
 * Checks which file exists and returns the first found (new config first, then old)
 * @returns {string|null} Path to existing config file, or null if neither exists
 */
export const getActiveConfigPath = () => {
  const paths = getSourceConfigPaths();
  for (const configPath of paths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
};

/**
 * Get configuration directory
 * @returns {string} Path to configuration directory
 */
export const getConfigDir = () => {
  return getBaseConfigDir();
};

/**
 * Get profile-specific directory path
 * @param {string} profileName - Name of the profile
 * @returns {string} Path to the profile's directory
 */
export const getProfileDirPath = (profileName) => {
  return path.join(getProfilesDir(), profileName);
};

/**
 * Get profile-specific template file path
 * @param {string} profileName - Name of the profile
 * @returns {string} Path to the profile's template.json
 */
export const getTemplatePath = (profileName) => {
  return path.join(getProfilesDir(), profileName, 'template.json');
};

/**
 * Get profile-specific variables file path
 * @param {string} profileName - Name of the profile
 * @returns {string} Path to the profile's variables.json
 */
export const getVariablesPath = (profileName) => {
  return path.join(getProfilesDir(), profileName, 'variables.json');
};

/**
 * Check if profile has a template file
 * @param {string} profileName - Name of the profile
 * @returns {Promise<boolean>} True if template.json exists
 */
export const hasTemplate = async (profileName) => {
  return exists(getTemplatePath(profileName));
};

/**
 * Check if profile has a variables file
 * @param {string} profileName - Name of the profile
 * @returns {Promise<boolean>} True if variables.json exists
 */
export const hasVariables = async (profileName) => {
  return exists(getVariablesPath(profileName));
};

export const getBackupDir = () => {
  return path.join(getOosDir(), 'backup');
};

/**
 * Path to proxy time slots data file
 * ~/.config/opencode/.oos/proxy-time-slots.json
 */
export const getProxyTimeSlotsPath = () => {
  return path.join(getOosDir(), 'proxy-time-slots.json');
};

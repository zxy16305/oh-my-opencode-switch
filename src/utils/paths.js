import path from 'path';
import os from 'os';
import { exists } from './files.js';

/**
 * Base configuration directory
 * Windows: %USERPROFILE%\.config\opencode
 * Unix: ~/.config/opencode
 */
export const getBaseConfigDir = () => {
  const homeDir = os.homedir();
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

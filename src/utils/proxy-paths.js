import path from 'path';
import os from 'os';
import { getOosDir } from './paths.js';

/**
 * Get the path to the proxy configuration file
 * ~/.config/opencode/.oos/proxy-config.json
 * @returns {string} Path to proxy-config.json
 */
export const getProxyConfigPath = () => {
  return path.join(getOosDir(), 'proxy-config.json');
};

/**
 * Get the path to OpenCode's provider configuration file
 * ~/.config/opencode/opencode.json
 * @returns {string} Path to opencode.json
 */
export const getOpencodeConfigPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, '.config', 'opencode', 'opencode.json');
};

/**
 * Get the path to OpenCode's auth credentials file
 * ~/.local/share/opencode/auth.json
 * @returns {string} Path to auth.json
 */
export const getOpencodeAuthPath = () => {
  const homeDir = os.homedir();
  return path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
};

/**
 * Get the path to the proxy time slots data file
 * ~/.config/opencode/.oos/proxy-time-slots.json
 * @returns {string} Path to proxy-time-slots.json
 */
export const getProxyTimeSlotsPath = () => {
  return path.join(getOosDir(), 'proxy-time-slots.json');
};

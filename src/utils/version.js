/**
 * Version detection and comparison utilities.
 * @module src/utils/version
 */

import { spawn } from 'child_process';

/**
 * Parse a version string into [major, minor, patch] components.
 * Handles formats like "v3.15.1", "3.15.1", "oh-my-openagent v3.15.1".
 *
 * @param {string} versionString - Raw version string
 * @returns {{major: number, minor: number, patch: number}|null} Parsed version or null if invalid
 */
export function parseVersion(versionString) {
  if (!versionString || typeof versionString !== 'string') {
    return null;
  }

  // Extract version number pattern: X.Y.Z
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two version objects.
 * Returns: negative if a < b, zero if a == b, positive if a > b.
 *
 * @param {{major: number, minor: number, patch: number}} a - First version
 * @param {{major: number, minor: number, patch: number}} b - Second version
 * @returns {number} Comparison result
 */
function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check if currentVersion is at least targetVersion.
 *
 * @param {string} targetVersion - Target version (e.g., "3.15.1")
 * @param {string|null} currentVersion - Current version to check, or null if unknown
 * @returns {boolean} True if current >= target, false otherwise (including null)
 */
export function isVersionAtLeast(targetVersion, currentVersion) {
  if (!currentVersion) {
    return false;
  }

  const target = parseVersion(targetVersion);
  const current = parseVersion(currentVersion);

  if (!target || !current) {
    return false;
  }

  return compareVersions(current, target) >= 0;
}

/**
 * Execute a command and capture its stdout.
 *
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @returns {Promise<string|null>} stdout content or null on failure
 */
function execCommand(command, args) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: true,
      timeout: 5000,
    });

    let stdout = '';
    let _stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      _stderr += data.toString();
    });

    proc.on('error', () => {
      resolve(null);
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Detect OpenAgent/OpenCode version.
 * Tries oh-my-openagent --version first, then oh-my-opencode --version.
 *
 * @returns {Promise<string|null>} Version string or null if detection fails
 */
export async function getOpenAgentVersion() {
  // Try oh-my-openagent first (new name)
  let output = await execCommand('oh-my-openagent', ['--version']);
  if (output) {
    return output;
  }

  // Fallback to oh-my-opencode (old name)
  output = await execCommand('oh-my-opencode', ['--version']);
  if (output) {
    return output;
  }

  return null;
}

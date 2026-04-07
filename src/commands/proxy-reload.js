import { logger } from '../utils/logger.js';

/**
 * Reload proxy configuration via control endpoint
 * @param {object} options - CLI options
 * @param {string} [options.host] - Proxy host (default: localhost)
 * @param {string} [options.port] - Proxy port (default: 3000)
 */
export async function reloadAction(options = {}) {
  const host = options.host || 'localhost';
  const port = options.port || '3000';
  const url = `http://${host}:${port}/_internal/reload`;

  let exitCode = 0;
  let success = false;
  let diff = null;
  let errorMessage = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      errorMessage = data.error || `HTTP ${response.status}`;

      if (response.status === 400) {
        exitCode = 1;
      } else {
        exitCode = 3;
      }
    } else {
      const data = await response.json();

      if (!data.success) {
        errorMessage = 'Unexpected response: missing success field';
        exitCode = 3;
      } else {
        success = true;
        diff = data.diff;
      }
    }
  } catch (error) {
    // Connection errors
    if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ETIMEDOUT') ||
      error.message?.includes('fetch failed')
    ) {
      errorMessage = `Connection failed: Cannot reach proxy at ${host}:${port}`;
      exitCode = 2;
    } else {
      errorMessage = `Failed to reload: ${error.message}`;
      exitCode = 3;
    }
  }

  // Output results
  if (success) {
    displayDiff(diff);
    logger.success('Configuration reloaded successfully');
  } else {
    logger.error(errorMessage);
  }

  process.exit(exitCode);
}

/**
 * Display configuration diff in user-friendly format
 * @param {object} diff - Diff object with added, removed, modified arrays
 */
function displayDiff(diff) {
  if (!diff) {
    return;
  }

  const { added = [], removed = [], modified = [] } = diff;

  if (added.length > 0) {
    logger.raw('\nAdded routes:');
    for (const route of added) {
      logger.raw(`  + ${route}`);
    }
  }

  if (removed.length > 0) {
    logger.raw('\nRemoved routes:');
    for (const route of removed) {
      logger.raw(`  - ${route}`);
    }
  }

  if (modified.length > 0) {
    logger.raw('\nModified routes:');
    for (const route of modified) {
      logger.raw(`  ~ ${route}`);
    }
  }

  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    logger.raw('\nNo configuration changes detected.');
  }
}

/**
 * Register proxy reload command with Commander program
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerProxyReloadCommand(program) {
  const proxyCommand = program.commands.find((cmd) => cmd.name() === 'proxy');

  if (!proxyCommand) {
    logger.error('Proxy command not found');
    return;
  }

  proxyCommand
    .command('reload')
    .description('Reload proxy configuration from disk')
    .option('--host <host>', 'Proxy host (default: localhost)', 'localhost')
    .option('--port <port>', 'Proxy port (default: 3000)', '3000')
    .action(reloadAction);
}

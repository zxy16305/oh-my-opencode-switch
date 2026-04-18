import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getBaseConfigDir } from '../utils/paths.js';
import { exists, ensureDir, copyFile, remove } from '../utils/files.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get OpenCode plugin directory path
 * ~/.config/opencode/plugin/
 */
function getPluginDir() {
  return path.join(getBaseConfigDir(), 'plugin');
}

/**
 * Get built-in plugins directory path
 * <package>/plugins/
 */
function getBuiltinPluginsDir() {
  return path.join(__dirname, '..', '..', 'plugins');
}

/**
 * Get list of built-in plugin names
 */
async function getBuiltinPlugins() {
  const pluginsDir = getBuiltinPluginsDir();
  const pluginFiles = [];

  try {
    const files = await fs.readdir(pluginsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        pluginFiles.push(file.slice(0, -3));
      }
    }
    return pluginFiles;
  } catch {
    return [];
  }
}

/**
 * Parse plugin metadata from JSDoc comments
 * Extracts Purpose field from JSDoc comments in plugin files
 * @param {string} filePath - Path to the plugin file
 * @returns {Promise<{name: string, description: string} | null>}
 */
export async function parsePluginMetadata(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const name = path.basename(filePath);

    // Extract Purpose field from JSDoc: * Purpose: <value>
    const match = content.match(/^\s*\*\s*Purpose:\s*(.+)$/m);
    const description = match ? match[1].trim() : '—';

    return { name, description };
  } catch {
    return null;
  }
}

/**
 * Install a plugin
 * Copies from <package>/plugins/<name>.js to ~/.config/opencode/plugin/<name>.js
 */
async function installAction(name, options) {
  const pluginDir = getPluginDir();
  const builtinPluginsDir = getBuiltinPluginsDir();

  const sourcePath = path.join(builtinPluginsDir, `${name}.js`);
  const destPath = path.join(pluginDir, `${name}.js`);

  const sourceExists = await exists(sourcePath);
  if (!sourceExists) {
    const available = await getBuiltinPlugins();
    if (available.length > 0) {
      logger.error(`Plugin '${name}' not found.`);
      logger.info('Available plugins:');
      logger.list(available);
    } else {
      logger.error(`Plugin '${name}' not found.`);
    }
    process.exitCode = 1;
    return;
  }

  const alreadyInstalled = await exists(destPath);
  if (alreadyInstalled && !options.force) {
    logger.error(`Plugin '${name}' is already installed. Use --force to overwrite.`);
    process.exitCode = 1;
    return;
  }

  await ensureDir(pluginDir);
  await copyFile(sourcePath, destPath);

  logger.success(`Installed plugin: ${name}`);
}

/**
 * Uninstall a plugin
 * Removes ~/.config/opencode/plugin/<name>.js
 */
async function uninstallAction(name) {
  const pluginDir = getPluginDir();
  const pluginPath = path.join(pluginDir, `${name}.js`);

  const pluginExists = await exists(pluginPath);
  if (!pluginExists) {
    logger.error(`Plugin '${name}' is not installed.`);
    process.exitCode = 1;
    return;
  }

  await remove(pluginPath);

  logger.success(`Uninstalled plugin: ${name}`);
}

/**
 * List installed plugins
 * @param {Object} options - Command options
 * @param {boolean} options.all - Show all built-in plugins with descriptions
 */
async function listAction(options) {
  // --all flag: show all built-in plugins with descriptions
  if (options && options.all) {
    const builtinPlugins = await getBuiltinPlugins();
    const builtinPluginsDir = getBuiltinPluginsDir();
    const pluginDir = getPluginDir();

    if (builtinPlugins.length === 0) {
      console.log('No built-in plugins available.');
      return;
    }

    const tableData = await Promise.all(
      builtinPlugins.map(async (name) => {
        const filePath = path.join(builtinPluginsDir, `${name}.js`);
        const metadata = await parsePluginMetadata(filePath);
        const installed = await exists(path.join(pluginDir, `${name}.js`));

        return {
          NAME: name,
          DESCRIPTION: metadata ? metadata.description : '—',
          STATUS: installed ? '[installed]' : '',
        };
      })
    );

    console.table(tableData);
    return;
  }

  // Default behavior: show installed plugins only
  const pluginDir = getPluginDir();

  const dirExists = await exists(pluginDir);
  if (!dirExists) {
    logger.info('No plugins installed.');
    return;
  }

  try {
    const files = await fs.readdir(pluginDir);
    const plugins = files.filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));

    if (plugins.length === 0) {
      logger.info('No plugins installed.');
      return;
    }

    logger.info('Installed plugins:');
    logger.list(plugins);
  } catch {
    logger.info('No plugins installed.');
  }
}

/**
 * Register plugin commands with Commander program
 */
export function registerPluginCommands(program) {
  const plugin = program.command('plugin').description('Manage OpenCode plugins');

  plugin
    .command('install <name>')
    .description('Install a built-in plugin')
    .option('-f, --force', 'Force overwrite if already installed')
    .action(installAction);

  plugin.command('uninstall <name>').description('Uninstall a plugin').action(uninstallAction);

  plugin
    .command('list')
    .description('List installed plugins')
    .option('-a, --all', 'Show all built-in plugins with descriptions')
    .action(listAction);
}

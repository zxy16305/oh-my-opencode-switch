import chalk from 'chalk';
import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';
import { getProfileConfigPath } from '../../utils/paths.js';
import { readJson } from '../../utils/files.js';

export async function showAction(name) {
  const manager = new ProfileManager();
  const profile = await manager.getProfile(name);

  // Summary section
  logger.raw(chalk.bold(`Profile: ${profile.name}`));
  logger.info(`Description: ${profile.description || '(none)'}`);
  logger.info(`Created: ${new Date(profile.createdAt).toLocaleString()}`);
  logger.info(`Last modified: ${new Date(profile.updatedAt).toLocaleString()}`);

  const configPath = getProfileConfigPath(profile.name);
  logger.info(`Path: ${configPath}`);

  if (profile.isActive) {
    logger.success('This is the currently active profile');
  }

  // Full config section
  try {
    const config = await readJson(configPath);
    logger.raw('');
    logger.raw(chalk.bold('Configuration:'));
    logger.raw(JSON.stringify(config, null, 2));
  } catch (error) {
    logger.warn(`Could not read config file: ${error.message}`);
  }
}

export function registerShowCommand(program) {
  program.command('show <name>').description('Show profile details').action(showAction);
}

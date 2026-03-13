import chalk from 'chalk';
import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';
import { getProfileDirPath, getTemplatePath, getVariablesPath } from '../../utils/paths.js';
import { readJson, exists } from '../../utils/files.js';

export async function showAction(name) {
  const manager = new ProfileManager();
  const profile = await manager.getProfile(name);

  // Summary section
  logger.raw(chalk.bold(`Profile: ${profile.name}`));
  logger.info(`Description: ${profile.description || '(none)'}`);
  logger.info(`Created: ${new Date(profile.createdAt).toLocaleString()}`);
  logger.info(`Last modified: ${new Date(profile.updatedAt).toLocaleString()}`);

  const profileDir = getProfileDirPath(profile.name);
  logger.info(`Path: ${profileDir}`);

  if (profile.isActive) {
    logger.success('This is the currently active profile');
  }

  // Template section
  const templatePath = getTemplatePath(profile.name);
  if (await exists(templatePath)) {
    try {
      const template = await readJson(templatePath);
      logger.raw('');
      logger.raw(chalk.bold('Template:'));
      logger.raw(JSON.stringify(template, null, 2));
    } catch (error) {
      logger.warn(`Could not read template file: ${error.message}`);
    }
  }

  // Variables section
  const variablesPath = getVariablesPath(profile.name);
  if (await exists(variablesPath)) {
    try {
      const variables = await readJson(variablesPath);
      logger.raw('');
      logger.raw(chalk.bold('Variables:'));
      logger.raw(JSON.stringify(variables, null, 2));
    } catch (error) {
      logger.warn(`Could not read variables file: ${error.message}`);
    }
  }
}

export function registerShowCommand(program) {
  program.command('show <name>').description('Show profile details').action(showAction);
}

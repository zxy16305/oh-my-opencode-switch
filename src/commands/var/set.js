import { ProfileManager } from '../../core/ProfileManager.js';
import { VariableManager } from '../../core/VariableManager.js';
import { logger } from '../../utils/logger.js';
import { ProfileError } from '../../utils/errors.js';

export async function setAction(profileName, variableName, value, options) {
  const profileManager = new ProfileManager();

  try {
    await profileManager.getProfile(profileName);
  } catch (error) {
    if (error instanceof ProfileError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const varManager = new VariableManager(profileName);

  let parsedValue = value;
  if (options.json) {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      logger.error(`Invalid JSON value: ${value}`);
      process.exit(1);
    }
  } else {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }
  }

  await varManager.set(variableName, parsedValue);
  logger.success(`Set variable "${variableName}" in profile "${profileName}"`);
}

export function registerSetCommand(program) {
  program
    .command('set <profile-name> <variable-name> <value>')
    .description('Set a variable value in a profile')
    .option('-j, --json', 'Force parse value as JSON')
    .action(setAction);
}

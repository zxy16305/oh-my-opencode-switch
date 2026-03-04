import { ProfileManager } from '../../core/ProfileManager.js';
import { VariableManager } from '../../core/VariableManager.js';
import { logger } from '../../utils/logger.js';
import { ProfileError } from '../../utils/errors.js';

export async function getAction(profileName, variableName) {
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
  const value = await varManager.get(variableName);

  if (value === undefined) {
    logger.error(`Variable "${variableName}" not found in profile "${profileName}"`);
    process.exit(1);
  }

  const output =
    typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value;
  logger.raw(output);
}

export function registerGetCommand(program) {
  program
    .command('get <profile-name> <variable-name>')
    .description('Get a variable value from a profile')
    .action(getAction);
}

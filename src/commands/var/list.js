import { ProfileManager } from '../../core/ProfileManager.js';
import { VariableManager } from '../../core/VariableManager.js';
import { logger } from '../../utils/logger.js';
import { ProfileError } from '../../utils/errors.js';

export async function listAction(profileName, options = {}) {
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
  const variables = await varManager.list();

  if (options.json) {
    console.log(JSON.stringify(variables, null, 2));
    return;
  }

  if (Object.keys(variables).length === 0) {
    logger.info(`No variables defined in profile "${profileName}"`);
    return;
  }

  logger.info(`Variables for profile "${profileName}":`);
  for (const [name, value] of Object.entries(variables)) {
    const displayValue =
      typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    logger.raw(`  ${name}: ${displayValue}`);
  }
}

export function registerListCommand(program) {
  program
    .command('list <profile-name>')
    .alias('ls')
    .description('List all variables in a profile')
    .option('--json', 'Output as JSON')
    .action(listAction);
}

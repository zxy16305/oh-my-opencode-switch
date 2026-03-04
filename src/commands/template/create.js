import { ProfileManager } from '../../core/ProfileManager.js';
import { ConfigManager } from '../../core/ConfigManager.js';
import { getTemplatePath } from '../../utils/paths.js';
import { writeJson, exists } from '../../utils/files.js';
import { logger } from '../../utils/logger.js';
import { ProfileError } from '../../utils/errors.js';

export async function createAction(profileName, options) {
  const profileManager = new ProfileManager();
  const configManager = new ConfigManager();

  await profileManager.getProfile(profileName);

  const templatePath = getTemplatePath(profileName);

  if (await exists(templatePath)) {
    if (!options.force) {
      throw new ProfileError(
        `Template already exists for profile "${profileName}". Use --force to overwrite.`
      );
    }
    logger.warn(`Overwriting existing template for profile "${profileName}"`);
  }

  const config = await configManager.readConfig();
  await writeJson(templatePath, config);

  logger.success(`Created template for profile "${profileName}"`);
  logger.info(`Template path: ${templatePath}`);
}

export function registerCreateCommand(program) {
  program
    .command('create <profile-name>')
    .description('Create a template from current OpenCode config')
    .option(
      '--from-current',
      'Create template from current OpenCode config (default behavior)',
      true
    )
    .option('-f, --force', 'Overwrite existing template')
    .action(createAction);
}

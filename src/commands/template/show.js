import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';
import { getTemplatePath, hasTemplate } from '../../utils/paths.js';
import { readJson } from '../../utils/files.js';

export async function showAction(name) {
  const manager = new ProfileManager();
  const profile = await manager.getProfile(name);

  const templatePath = getTemplatePath(profile.name);
  const templateExists = await hasTemplate(profile.name);

  if (!templateExists) {
    logger.error(`Profile '${profile.name}' does not have a template`);
    process.exit(1);
  }

  try {
    const template = await readJson(templatePath);
    logger.raw(JSON.stringify(template, null, 2));
  } catch (error) {
    logger.error(`Failed to read template: ${error.message}`);
    process.exit(1);
  }
}

export function registerShowCommand(program) {
  program.command('show <profile-name>').description('Show a profile template').action(showAction);
}

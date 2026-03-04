import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';

export async function createAction(name, options) {
  const manager = new ProfileManager();
  const profile = await manager.createProfile(name, {
    description: options.description || '',
    template: options.template || false,
  });

  if (profile.template) {
    logger.success(`Created template profile: ${profile.name}`);
  } else {
    logger.success(`Created profile: ${profile.name}`);
  }

  if (profile.description) {
    logger.info(`Description: ${profile.description}`);
  }
}

export function registerCreateCommand(program) {
  program
    .command('create <name>')
    .alias('new')
    .description('Create a new profile from current config')
    .option('-d, --description <desc>', 'Profile description')
    .option('-t, --template', 'Create as template profile with variables.json')
    .action(createAction);
}

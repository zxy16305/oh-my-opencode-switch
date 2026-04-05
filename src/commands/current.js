import { ProfileManager } from '../core/ProfileManager.js';
import logger from '../utils/logger.js';

export async function currentAction(_options) {
  const manager = new ProfileManager();
  const profile = await manager.getActiveProfile();

  if (profile) {
    logger.raw(profile.name);
  } else {
    logger.raw('(none)');
  }
}

export function registerCurrentCommand(program) {
  program.command('current').description('Show current profile').action(currentAction);
}

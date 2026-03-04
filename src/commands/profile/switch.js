import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';

export async function switchAction(name) {
  const manager = new ProfileManager();
  const profile = await manager.switchProfile(name);
  logger.success(`Switched to profile: ${profile.name}`);
  if (profile.description) {
    logger.info(`Description: ${profile.description}`);
  }
}

export function registerSwitchCommand(program) {
  program
    .command('switch <name>')
    .alias('use')
    .description('Switch to a profile')
    .action(switchAction);
}

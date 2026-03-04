import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';

export async function copyAction(sourceName, targetName) {
  const manager = new ProfileManager();
  await manager.copyProfile(sourceName, targetName);
  logger.success(`Copied "${sourceName}" to "${targetName}"`);
}

export function registerCopyCommand(program) {
  program
    .command('copy <source> <target>')
    .alias('cp')
    .description('Copy a profile')
    .action(copyAction);
}

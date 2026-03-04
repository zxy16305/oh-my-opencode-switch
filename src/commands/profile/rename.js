import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';

export async function renameAction(oldName, newName) {
  const manager = new ProfileManager();
  await manager.renameProfile(oldName, newName);
  logger.success(`Renamed "${oldName}" to "${newName}"`);
}

export function registerRenameCommand(program) {
  program
    .command('rename <oldName> <newName>')
    .alias('mv')
    .description('Rename a profile')
    .action(renameAction);
}

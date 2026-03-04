import readline from 'readline';
import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';

async function confirmDelete(name) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `Are you sure you want to delete profile "${name}"? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      }
    );
  });
}

export async function deleteAction(name, options) {
  const manager = new ProfileManager();
  
  // Check if profile exists and if it's active
  const profile = await manager.getProfile(name);
  
  // If profile is active, require -f flag
  if (profile.isActive && !options.force) {
    logger.warn('Warning: You are deleting the currently active profile.');
    logger.info('Use -f to confirm deletion.');
    process.exit(1);
  }
  
  // If not active and not forced, ask for confirmation
  if (!profile.isActive && !options.force) {
    const confirmed = await confirmDelete(name);
    if (!confirmed) {
      logger.info('Delete cancelled');
      return;
    }
  }

  await manager.deleteProfile(name);
  logger.success(`Deleted profile: ${name}`);
}

export function registerDeleteCommand(program) {
  program
    .command('delete <name>')
    .alias('rm')
    .description('Delete a profile')
    .option('-f, --force', 'Skip confirmation (required for active profile)')
    .action(deleteAction);
}

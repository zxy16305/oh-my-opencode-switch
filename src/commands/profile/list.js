import { ProfileManager } from '../../core/ProfileManager.js';
import logger from '../../utils/logger.js';

export async function listAction(options) {
  const manager = new ProfileManager();
  const profiles = await manager.listProfiles();

  if (profiles.length === 0) {
    if (options.json) {
      logger.raw('[]');
    } else {
      logger.raw('No profiles found');
    }
    return;
  }

  if (options.json) {
    logger.raw(JSON.stringify(profiles, null, 2));
    return;
  }

  if (options.quiet) {
    for (const profile of profiles) {
      logger.raw(profile.name);
    }
    return;
  }

  const tableData = profiles.map((profile) => ({
    NAME: profile.name,
    DESCRIPTION: profile.description || '',
    CREATED: new Date(profile.createdAt).toLocaleDateString(),
    CURRENT: profile.isActive ? '*' : ' ',
  }));

  console.table(tableData);
}

export function registerListCommand(program) {
  program
    .command('list')
    .alias('ls')
    .description('List all profiles')
    .option('-q, --quiet', 'Output only profile names, one per line')
    .option('--json', 'Output as JSON')
    .action(listAction);
}

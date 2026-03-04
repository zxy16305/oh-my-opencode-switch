import { ProfileManager } from '../../core/ProfileManager.js';
import { hasTemplate } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';
import { ProfileError } from '../../utils/errors.js';

export async function listAction(options) {
  try {
    const manager = new ProfileManager();
    const profiles = await manager.listProfiles();

    const profilesByTemplate = await Promise.all(
      profiles.map(async (profile) => ({
        profile,
        hasTemplate: await hasTemplate(profile.name),
      }))
    );

    const profilesTemplate = profilesByTemplate.filter((p) => p.hasTemplate).map((p) => p.profile);

    if (profilesTemplate.length === 0) {
      console.log('No profiles with templates found');
      return;
    }

    if (options.quiet) {
      for (const profile of profilesTemplate) {
        console.log(profile.name);
      }
      return;
    }

    const tableData = profilesTemplate.map((profile) => ({
      NAME: profile.name,
      DESCRIPTION: profile.description || '',
    }));

    console.table(tableData);
  } catch (error) {
    if (error instanceof ProfileError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

export function registerListCommand(program) {
  program
    .command('list')
    .alias('ls')
    .description('List all profiles with templates')
    .option('-q, --quiet', 'Output only profile names, one per line')
    .action(listAction);
}

import { ProfileManager } from '../../core/ProfileManager.js';
import { ProfileError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export function register(program) {
  program
    .command('updateTemplate [profileName]')
    .description('Update all profiles sharing the same template')
    .option('--default', 'Update from init.js default template')
    .action(async (profileName, options) => {
      try {
        if (!profileName && !options.default) {
          program.error('profileName is required, or use --default to update from init.js');
          return;
        }

        const manager = new ProfileManager();
        await manager.init();

        const result = await manager.updateTemplates(profileName, {
          useDefault: options.default,
        });

        if (result.updated.length > 0) {
          if (options.default) {
            logger.success(`Updated ${result.updated.length} profile(s) using default template`);
          } else {
            logger.success(
              `Updated ${result.updated.length} profile(s): ${result.updated.join(', ')}`
            );
          }

          if (result.failed.length > 0) {
            logger.error(
              `Failed to update ${result.failed.length} profile(s): ${result.failed.map((f) => f.name).join(', ')}`
            );
          }
        } else {
          if (options.default) {
            logger.info('No profiles found matching the default template');
          } else {
            logger.info(`No profiles found matching template name from '${profileName}'`);
          }
        }

        process.exit(0);
      } catch (error) {
        if (error instanceof ProfileError) {
          program.error(error.message);
        }
        throw error;
      }
    });
}

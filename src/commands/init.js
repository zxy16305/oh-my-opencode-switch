import path from 'path';
import {
  getOosDir,
  getSourceConfigPath,
  getProfilesDir,
  getProfilesMetadataPath,
} from '../utils/paths.js';
import { exists, writeJson, ensureDir } from '../utils/files.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CONFIG_TEMPLATE = {
  $schema:
    'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json',
  agents: {},
  categories: {},
};

export async function initAction(_options) {
  const oosDir = getOosDir();
  const profilesDir = getProfilesDir();
  const profilesMetaPath = getProfilesMetadataPath();
  const sourceConfigPath = getSourceConfigPath();

  // Check if already initialized
  const metaExists = await exists(profilesMetaPath);

  if (metaExists) {
    const metadata = await (async () => {
      try {
        const { readJson } = await import('../utils/files.js');
        return await readJson(profilesMetaPath);
      } catch {
        return null;
      }
    })();

    if (metadata && Object.keys(metadata.profiles || {}).length > 0) {
      logger.info('OOS is already initialized');
      return;
    }
  }

  // Create directories
  await ensureDir(oosDir);
  await ensureDir(profilesDir);

  // Create profiles.json with empty profiles if not exists
  if (!(await exists(profilesMetaPath))) {
    await writeJson(profilesMetaPath, {
      version: 1,
      activeProfile: null,
      profiles: {},
    });
  }

  // Create oh-my-opencode.json with default template if not exists
  if (!(await exists(sourceConfigPath))) {
    await ensureDir(path.dirname(sourceConfigPath));
    await writeJson(sourceConfigPath, DEFAULT_CONFIG_TEMPLATE);
  }

  logger.success(`Initialized oos in ${oosDir}`);
}

export function registerInitCommand(program) {
  program.command('init').description('Initialize oos environment').action(initAction);
}

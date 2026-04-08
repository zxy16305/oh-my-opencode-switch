import path from 'path';
import {
  getOosDir,
  getSourceConfigPath,
  getProfilesDir,
  getProfilesMetadataPath,
  getTemplatePath,
  getVariablesPath,
  getNewConfigFilename,
  getOldConfigFilename,
  getBaseConfigDir,
  getActiveConfigPath,
} from '../utils/paths.js';
import { getOpenAgentVersion, isVersionAtLeast } from '../utils/version.js';
import { exists, writeJson, ensureDir } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { ProfileManager } from '../core/ProfileManager.js';
import { DEFAULT_TEMPLATE_JSON } from '../core/ProfileRenderer.js';

export { DEFAULT_TEMPLATE_JSON } from '../core/ProfileRenderer.js';

const DEFAULT_CONFIG_TEMPLATE = {
  $schema:
    'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json',
  agents: {},
  categories: {},
  experimental: {
    plugins: ['./plugins/category-capture.ts'],
  },
};

const DEFAULT_VARIABLES_JSON = {
  MODEL_ORCHESTRATOR: 'fangzhou/doubao-seed-2-0-pro',
  MODEL_PLANNER: 'fangzhou/doubao-seed-2-0-pro',
  MODEL_REVIEWER: 'fangzhou/doubao-seed-2-0-pro',
  MODEL_ORACLE: 'fangzhou/kimi-k2.5',
  MODEL_EXECUTOR: 'fangzhou/doubao-seed-2-0-code',
  MODEL_EXECUTOR_DEEP: 'fangzhou/doubao-seed-2-0-code',
  MODEL_LIGHT: 'fangzhou/doubao-seed-2-0-code',
  MODEL_VISUAL: 'fangzhou/kimi-k2.5',
  MODEL_ULTRAWORK: 'fangzhou/doubao-seed-2-0-code',
};

export async function initAction(_options) {
  const oosDir = getOosDir();
  const profilesDir = getProfilesDir();
  const profilesMetaPath = getProfilesMetadataPath();
  const sourceConfigPath = getSourceConfigPath();

  // Check if already initialized
  const metaExists = await exists(profilesMetaPath);
  let isAlreadyInitialized = false;

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
      isAlreadyInitialized = true;
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

  // Create appropriate config file if no config exists
  const activeConfigPath = getActiveConfigPath();
  if (!activeConfigPath) {
    const baseConfigDir = getBaseConfigDir();
    await ensureDir(baseConfigDir);

    // Detect version to choose config filename
    const version = await getOpenAgentVersion();
    let configFilename;

    if (version && isVersionAtLeast('3.15.1', version)) {
      configFilename = getNewConfigFilename();
    } else {
      configFilename = getOldConfigFilename();
    }

    const configPath = path.join(baseConfigDir, configFilename);
    await writeJson(configPath, DEFAULT_CONFIG_TEMPLATE);
  }

  if (isAlreadyInitialized) {
    logger.info('OOS is already initialized');
  } else {
    logger.success(`Initialized oos in ${oosDir}`);
  }

  const profileManager = new ProfileManager();
  await profileManager.init();
  const metadata = await profileManager.getMetadata();

  if (!metadata.profiles['default-template']) {
    const originalActiveProfile = metadata.activeProfile;

    await profileManager.createProfile('default-template', {
      template: true,
      description: 'Default template profile',
    });

    const updatedMetadata = await profileManager.getMetadata();
    updatedMetadata.activeProfile = originalActiveProfile;
    await profileManager.saveMetadata(updatedMetadata);

    await writeJson(getTemplatePath('default-template'), DEFAULT_TEMPLATE_JSON);
    await writeJson(getVariablesPath('default-template'), DEFAULT_VARIABLES_JSON);
  }
}

export function registerInitCommand(program) {
  program.command('init').description('Initialize oos environment').action(initAction);
}

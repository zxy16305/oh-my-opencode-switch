import path from 'path';
import {
  getOosDir,
  getSourceConfigPath,
  getProfilesDir,
  getProfilesMetadataPath,
  getTemplatePath,
  getVariablesPath,
} from '../utils/paths.js';
import { exists, writeJson, ensureDir } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { ProfileManager } from '../core/ProfileManager.js';

const DEFAULT_CONFIG_TEMPLATE = {
  $schema:
    'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json',
  agents: {},
  categories: {},
};

export const DEFAULT_TEMPLATE_JSON = {
  $schema:
    'https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json',
  oosVersionTag: 'default:1.1',

  agents: {
    Sisyphus: {
      model: '{{MODEL_ORCHESTRATOR}}',
      ultrawork: {
        model: '{{MODEL_ULTRAWORK}}',
      },
    },
    'orchestrator-sisyphus': {
      model: '{{MODEL_ORCHESTRATOR}}',
    },
    atlas: {
      model: '{{MODEL_ORCHESTRATOR}}',
    },

    'Prometheus (Planner)': {
      model: '{{MODEL_PLANNER}}',
    },
    'Metis (Plan Consultant)': {
      model: '{{MODEL_PLANNER}}',
    },
    'Momus (Plan Reviewer)': {
      model: '{{MODEL_REVIEWER}}',
    },

    oracle: {
      model: '{{MODEL_ORACLE}}',
    },

    build: {
      model: '{{MODEL_EXECUTOR}}',
    },
    'OpenCode-Builder': {
      model: '{{MODEL_EXECUTOR_DEEP}}',
    },

    librarian: {
      model: '{{MODEL_LIGHT}}',
    },
    explore: {
      model: '{{MODEL_LIGHT}}',
    },

    'multimodal-looker': {
      model: '{{MODEL_VISUAL}}',
    },
    'frontend-ui-ux-engineer': {
      model: '{{MODEL_VISUAL}}',
    },
    'document-writer': {
      model: '{{MODEL_ORACLE}}',
    },
  },

  categories: {
    ultrabrain: {
      model: '{{MODEL_EXECUTOR_DEEP}}',
      reasoningEffort: 'high',
    },
    deep: {
      model: '{{MODEL_EXECUTOR_DEEP}}',
    },
    quick: {
      model: '{{MODEL_LIGHT}}',
    },
    'visual-engineering': {
      model: '{{MODEL_VISUAL}}',
    },
    artistry: {
      model: '{{MODEL_ORACLE}}',
    },
    writing: {
      model: '{{MODEL_ORACLE}}',
    },
    'unspecified-low': {
      model: '{{MODEL_ORCHESTRATOR}}',
    },
    'unspecified-high': {
      model: '{{MODEL_ULTRAWORK}}',
    },
  },

  experimental: {
    aggressive_truncation: false,
    dynamic_context_pruning: {
      enabled: true,
      notification: 'detailed',
      turn_protection: {
        enabled: true,
        turns: 7,
      },
      protected_tools: [
        'task',
        'todowrite',
        'todoread',
        'lsp_rename',
        'session_read',
        'session_write',
        'session_search',
      ],
      strategies: {
        deduplication: {
          enabled: true,
        },
        supersede_writes: {
          enabled: true,
          aggressive: false,
        },
        purge_errors: {
          enabled: true,
          turns: 8,
        },
      },
    },
  },

  background_task: {
    providerConcurrency: {
      baidu: 2,
      fangzhou: 2,
      ali: 2,
      openai: 1,
    },
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

  // Create oh-my-opencode.json with default template if not exists
  if (!(await exists(sourceConfigPath))) {
    await ensureDir(path.dirname(sourceConfigPath));
    await writeJson(sourceConfigPath, DEFAULT_CONFIG_TEMPLATE);
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

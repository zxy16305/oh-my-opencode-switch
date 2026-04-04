import { TemplateEngine } from './TemplateEngine.js';
import { MissingVariableError } from '../utils/errors.js';

/**
 * Default template configuration used when creating new profiles
 * Contains model assignments for all agent types and categories
 */
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
      model: '{{MODEL_EXECUTOR}}',
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
    },
  },

  background_task: {
    providerConcurrency: {
      baidu: 5,
      fangzhou: 5,
      ali: 5,
      openai: 1,
    },
  },
};

/**
 * ProfileRenderer - Handles template rendering for profile configurations
 * Responsible for rendering templates with variable substitution and model array processing
 */
export class ProfileRenderer {
  constructor() {
    this.templateEngine = new TemplateEngine();
  }

  /**
   * Render a template object with variables
   * @param {Object} templateObj - Template object
   * @param {Object} variables - Variables for substitution
   * @returns {Promise<Object>} Rendered config
   */
  async renderTemplate(templateObj, variables) {
    const templateStr = JSON.stringify(templateObj);

    try {
      const renderedStr = this.templateEngine.render(templateStr, variables);
      let renderedConfig = JSON.parse(renderedStr);

      // Process model arrays: split into model + fallback_models
      renderedConfig = this._processModelArrays(renderedConfig);

      return renderedConfig;
    } catch (error) {
      if (error instanceof MissingVariableError) {
        throw new MissingVariableError(error.variableName);
      }
      throw error;
    }
  }

  /**
   * Process model arrays in config, splitting them into model (string) and fallback_models (array)
   * @param {Object} config - Rendered config object
   * @returns {Object} Processed config with model arrays split
   * @private
   */
  _processModelArrays(config) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    // Deep clone to avoid mutating the original
    const clone = JSON.parse(JSON.stringify(config));

    const walk = (node) => {
      if (!node || typeof node !== 'object') return node;

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          node[i] = walk(node[i]);
        }
        return node;
      }

      // Process object properties
      for (const [key, value] of Object.entries(node)) {
        if (key === 'model') {
          if (Array.isArray(value)) {
            if (value.length > 1) {
              // Multiple models: first -> model, rest -> fallback_models
              node['model'] = value[0];
              node['fallback_models'] = value.slice(1);
            } else if (value.length === 1) {
              // Single model: just set model, no fallback_models
              node['model'] = value[0];
              if (Object.prototype.hasOwnProperty.call(node, 'fallback_models')) {
                delete node['fallback_models'];
              }
            } else {
              // Empty array: set to null
              node['model'] = null;
              if (Object.prototype.hasOwnProperty.call(node, 'fallback_models')) {
                delete node['fallback_models'];
              }
            }
          }
          // If value is not an array (string, null, undefined), leave as-is
          continue;
        }
        // Recursively process nested objects
        node[key] = walk(value);
      }
      return node;
    };

    return walk(clone);
  }
}

export default ProfileRenderer;

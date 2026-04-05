import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileRenderer, DEFAULT_TEMPLATE_JSON } from '../../../src/core/ProfileRenderer.js';
import { MissingVariableError } from '../../../src/utils/errors.js';

describe('ProfileRenderer', () => {
  let renderer;

  beforeEach(() => {
    renderer = new ProfileRenderer();
  });

  describe('renderTemplate', () => {
    it('should render template with all variables substituted', async () => {
      const template = {
        agents: {
          build: { model: '{{MODEL}}' },
        },
      };
      const variables = { MODEL: 'gpt-4' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
    });

    it('should render template with multiple variables', async () => {
      const template = {
        agents: {
          build: { model: '{{MODEL_EXEC}}' },
          oracle: { model: '{{MODEL_ORACLE}}' },
        },
      };
      const variables = { MODEL_EXEC: 'gpt-4', MODEL_ORACLE: 'claude-3' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
      assert.equal(result.agents.oracle.model, 'claude-3');
    });

    it('should render nested template objects', async () => {
      const template = {
        agents: {
          Sisyphus: {
            model: '{{MODEL_A}}',
            ultrawork: {
              model: '{{MODEL_B}}',
            },
          },
        },
      };
      const variables = { MODEL_A: 'model-a', MODEL_B: 'model-b' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.Sisyphus.model, 'model-a');
      assert.equal(result.agents.Sisyphus.ultrawork.model, 'model-b');
    });

    it('should throw MissingVariableError for missing variable', async () => {
      const template = { model: '{{MISSING}}' };
      const variables = {};
      await assert.rejects(
        () => renderer.renderTemplate(template, variables),
        MissingVariableError
      );
    });

    it('should include variable name in MissingVariableError', async () => {
      const template = { model: '{{MY_VAR}}' };
      const variables = {};
      try {
        await renderer.renderTemplate(template, variables);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof MissingVariableError);
        assert.equal(error.variableName, 'MY_VAR');
      }
    });

    it('should preserve non-variable fields unchanged', async () => {
      const template = {
        agents: {
          build: {
            model: '{{MODEL}}',
            extra: 'plain-text',
            number: 42,
            flag: true,
          },
        },
      };
      const variables = { MODEL: 'gpt-4' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.extra, 'plain-text');
      assert.equal(result.agents.build.number, 42);
      assert.equal(result.agents.build.flag, true);
    });

    it('should handle template with no variables', async () => {
      const template = {
        agents: {
          build: { model: 'static-model' },
        },
      };
      const result = await renderer.renderTemplate(template, {});
      assert.equal(result.agents.build.model, 'static-model');
    });

    it('should handle empty template object', async () => {
      const result = await renderer.renderTemplate({}, {});
      assert.deepEqual(result, {});
    });

    it('should handle variable used multiple times', async () => {
      const template = {
        agents: {
          build: { model: '{{MODEL}}' },
          oracle: { model: '{{MODEL}}' },
        },
      };
      const variables = { MODEL: 'gpt-4' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
      assert.equal(result.agents.oracle.model, 'gpt-4');
    });
  });

  describe('renderTemplate with model arrays', () => {
    it('should split multi-element model array into model + fallback_models', async () => {
      const template = {
        agents: {
          build: { model: '{{MODELS}}' },
        },
      };
      const variables = { MODELS: ['gpt-4', 'claude-3', 'gemini'] };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
      assert.deepEqual(result.agents.build.fallback_models, ['claude-3', 'gemini']);
    });

    it('should convert single-element model array to string', async () => {
      const template = {
        agents: {
          build: { model: '{{MODELS}}' },
        },
      };
      const variables = { MODELS: ['gpt-4'] };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
      assert.equal(result.agents.build.fallback_models, undefined);
    });

    it('should keep string model value as-is', async () => {
      const template = {
        agents: {
          build: { model: '{{MODEL}}' },
        },
      };
      const variables = { MODEL: 'gpt-4' };
      const result = await renderer.renderTemplate(template, variables);
      assert.equal(result.agents.build.model, 'gpt-4');
      assert.equal(result.agents.build.fallback_models, undefined);
    });
  });

  describe('_processModelArrays', () => {
    it('should split two-element array into model and fallback_models', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3'] },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
      assert.deepEqual(result.agents.Sisyphus.fallback_models, ['claude-3']);
    });

    it('should split three-element array into model and multiple fallbacks', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3', 'gemini'] },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
      assert.deepEqual(result.agents.Sisyphus.fallback_models, ['claude-3', 'gemini']);
    });

    it('should convert single-element array to string model', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4'] },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
      assert.equal(result.agents.Sisyphus.fallback_models, undefined);
    });

    it('should leave string model value unchanged', () => {
      const config = {
        agents: {
          Sisyphus: { model: 'gpt-4' },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
      assert.equal(result.agents.Sisyphus.fallback_models, undefined);
    });

    it('should handle null model value', () => {
      const config = {
        agents: {
          Sisyphus: { model: null },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, null);
    });

    it('should handle empty model array', () => {
      const config = {
        agents: {
          Sisyphus: { model: [] },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, null);
      assert.equal(result.agents.Sisyphus.fallback_models, undefined);
    });

    it('should process nested ultrawork.model arrays', () => {
      const config = {
        agents: {
          Sisyphus: {
            model: ['gpt-4'],
            ultrawork: {
              model: ['claude-3', 'gemini'],
            },
          },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
      assert.equal(result.agents.Sisyphus.ultrawork.model, 'claude-3');
      assert.deepEqual(result.agents.Sisyphus.ultrawork.fallback_models, ['gemini']);
    });

    it('should process categories model arrays', () => {
      const config = {
        categories: {
          deep: { model: ['gpt-4', 'claude-3'] },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.equal(result.categories.deep.model, 'gpt-4');
      assert.deepEqual(result.categories.deep.fallback_models, ['claude-3']);
    });

    it('should not mutate original config', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3'] },
        },
      };
      const originalModel = [...config.agents.Sisyphus.model];
      renderer._processModelArrays(config);
      assert.deepEqual(config.agents.Sisyphus.model, originalModel);
    });

    it('should return config unchanged if null', () => {
      assert.equal(renderer._processModelArrays(null), null);
    });

    it('should return config unchanged if not an object', () => {
      assert.equal(renderer._processModelArrays('string'), 'string');
      assert.equal(renderer._processModelArrays(42), 42);
    });

    it('should handle config with no model keys', () => {
      const config = {
        settings: {
          timeout: 30,
          retries: 3,
        },
      };
      const result = renderer._processModelArrays(config);
      assert.deepEqual(result, config);
    });

    it('should handle arrays containing non-model keys', () => {
      const config = {
        agents: {
          Sisyphus: {
            tags: ['tag1', 'tag2'],
            model: 'gpt-4',
          },
        },
      };
      const result = renderer._processModelArrays(config);
      assert.deepEqual(result.agents.Sisyphus.tags, ['tag1', 'tag2']);
      assert.equal(result.agents.Sisyphus.model, 'gpt-4');
    });
  });

  describe('DEFAULT_TEMPLATE_JSON', () => {
    it('should be a valid object', () => {
      assert.ok(DEFAULT_TEMPLATE_JSON);
      assert.equal(typeof DEFAULT_TEMPLATE_JSON, 'object');
    });

    it('should have agents property', () => {
      assert.ok(DEFAULT_TEMPLATE_JSON.agents);
    });

    it('should have categories property', () => {
      assert.ok(DEFAULT_TEMPLATE_JSON.categories);
    });

    it('should contain model template variables', () => {
      const jsonStr = JSON.stringify(DEFAULT_TEMPLATE_JSON);
      assert.ok(jsonStr.includes('{{MODEL_ORCHESTRATOR}}'));
      assert.ok(jsonStr.includes('{{MODEL_EXECUTOR}}'));
      assert.ok(jsonStr.includes('{{MODEL_LIGHT}}'));
    });

    it('should have all agents with model fields', () => {
      const { agents } = DEFAULT_TEMPLATE_JSON;
      for (const [, agentConfig] of Object.entries(agents)) {
        assert.ok(
          agentConfig.model || agentConfig.ultrawork?.model,
          'Agent should have a model field'
        );
      }
    });
  });
});

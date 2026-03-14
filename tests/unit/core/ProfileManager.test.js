import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileManager } from '../../../src/core/ProfileManager.js';

describe('ProfileManager', () => {
  describe('_processModelArrays', () => {
    let profileManager;

    beforeEach(() => {
      profileManager = new ProfileManager();
    });

    it('single-element array -> model string', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4'] },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, 'gpt-4');
      assert.equal(result?.agents?.Sisyphus?.fallback_models, undefined);
    });

    it('two-element array -> model and fallback_models', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3'] },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, 'gpt-4');
      assert.deepEqual(result?.agents?.Sisyphus?.fallback_models, ['claude-3']);
    });

    it('three-element array -> model and multiple fallbacks', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3', 'gemini'] },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, 'gpt-4');
      assert.deepEqual(result?.agents?.Sisyphus?.fallback_models, ['claude-3', 'gemini']);
    });

    it('string value -> backward compatibility', () => {
      const config = {
        agents: {
          Sisyphus: { model: 'gpt-4' },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, 'gpt-4');
      assert.equal(result?.agents?.Sisyphus?.fallback_models, undefined);
    });

    it('null value -> should not throw', () => {
      const config = {
        agents: {
          Sisyphus: { model: null },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, null);
    });

    it('categories model array -> should also split', () => {
      const config = {
        categories: {
          build: { model: ['gpt-4', 'claude-3'] },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.categories?.build?.model, 'gpt-4');
      assert.deepEqual(result?.categories?.build?.fallback_models, ['claude-3']);
    });

    it('nested ultrawork.model -> should also split', () => {
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

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, 'gpt-4');
      assert.equal(result?.agents?.Sisyphus?.ultrawork?.model, 'claude-3');
      assert.deepEqual(result?.agents?.Sisyphus?.ultrawork?.fallback_models, ['gemini']);
    });

    it('empty array -> should set model to null', () => {
      const config = {
        agents: {
          Sisyphus: { model: [] },
        },
      };

      const result = profileManager._processModelArrays(config);
      assert.equal(result?.agents?.Sisyphus?.model, null);
      assert.equal(result?.agents?.Sisyphus?.fallback_models, undefined);
    });

    it('should not mutate original config', () => {
      const config = {
        agents: {
          Sisyphus: { model: ['gpt-4', 'claude-3'] },
        },
      };

      const originalModel = [...config.agents.Sisyphus.model];
      profileManager._processModelArrays(config);

      // Original should still be an array
      assert.deepEqual(config.agents.Sisyphus.model, originalModel);
    });
  });
});

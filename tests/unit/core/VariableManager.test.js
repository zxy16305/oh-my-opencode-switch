import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { VariableManager } from '../../../src/core/VariableManager.js';
import { getVariablesPath, getProfileDirPath } from '../../../src/utils/paths.js';
import { VariableValidationError } from '../../../src/utils/errors.js';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

const testProfileName = 'test-variable-manager-profile';

describe('VariableManager', () => {
  let variableManager;
  let testHome;
  let profileDir;
  let variablesPath;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    profileDir = getProfileDirPath(testProfileName);
    variablesPath = getVariablesPath(testProfileName);
    await fs.mkdir(profileDir, { recursive: true });
    variableManager = new VariableManager(testProfileName);
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('constructor', () => {
    it('should create instance with profile name', () => {
      const vm = new VariableManager('my-profile');
      assert.equal(vm.profileName, 'my-profile');
      assert.equal(vm.initialized, false);
    });
  });

  describe('init', () => {
    it('should initialize and create profile directory if needed', async () => {
      const newProfileName = 'init-test-profile';
      const newProfileDir = getProfileDirPath(newProfileName);

      // Clean up
      await fs.rm(newProfileDir, { recursive: true, force: true });

      const vm = new VariableManager(newProfileName);
      await vm.init();

      assert.equal(vm.initialized, true);
      const dirExists = await fs
        .access(newProfileDir)
        .then(() => true)
        .catch(() => false);
      assert.equal(dirExists, true);

      // Clean up
      await fs.rm(newProfileDir, { recursive: true, force: true });
    });

    it('should load existing variables from file', async () => {
      const existingVariables = {
        API_KEY: 'secret123',
        DEBUG_MODE: true,
      };
      await fs.writeFile(variablesPath, JSON.stringify(existingVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables, existingVariables);
    });

    it('should start with empty variables if file does not exist', async () => {
      await variableManager.init();

      assert.deepEqual(variableManager.variables, {});
    });

    it('should not re-initialize if already initialized', async () => {
      await variableManager.init();
      variableManager.variables.EXISTING = 'value';

      await variableManager.init();

      assert.deepEqual(variableManager.variables, { EXISTING: 'value' });
    });
  });

  describe('get', () => {
    it('should return variable value', async () => {
      await variableManager.set('API_KEY', 'my-secret-key');

      const value = await variableManager.get('API_KEY');

      assert.equal(value, 'my-secret-key');
    });

    it('should return undefined for non-existent variable', async () => {
      const value = await variableManager.get('NON_EXISTENT');

      assert.equal(value, undefined);
    });
  });

  describe('set', () => {
    it('should set a string variable', async () => {
      await variableManager.set('API_KEY', 'my-secret-key');

      const value = await variableManager.get('API_KEY');
      assert.equal(value, 'my-secret-key');
    });

    it('should set a number variable', async () => {
      await variableManager.set('PORT_NUMBER', 3000);

      const value = await variableManager.get('PORT_NUMBER');
      assert.equal(value, 3000);
    });

    it('should set a boolean variable', async () => {
      await variableManager.set('DEBUG_MODE', true);

      const value = await variableManager.get('DEBUG_MODE');
      assert.equal(value, true);
    });

    it('should set a null variable', async () => {
      await variableManager.set('NULL_VALUE', null);

      const value = await variableManager.get('NULL_VALUE');
      assert.equal(value, null);
    });

    it('should set an object variable', async () => {
      const config = { host: 'localhost', port: 3000 };
      await variableManager.set('SERVER_CONFIG', config);

      const value = await variableManager.get('SERVER_CONFIG');
      assert.deepEqual(value, config);
    });

    it('should set an array variable', async () => {
      const list = ['item1', 'item2', 'item3'];
      await variableManager.set('ALLOWED_HOSTS', list);

      const value = await variableManager.get('ALLOWED_HOSTS');
      assert.deepEqual(value, list);
    });

    it('should overwrite existing variable', async () => {
      await variableManager.set('API_KEY', 'old-value');
      await variableManager.set('API_KEY', 'new-value');

      const value = await variableManager.get('API_KEY');
      assert.equal(value, 'new-value');
    });

    it('should persist variables to file', async () => {
      await variableManager.set('API_KEY', 'my-secret-key');

      const fileContent = await fs.readFile(variablesPath, 'utf8');
      const savedVariables = JSON.parse(fileContent);
      assert.equal(savedVariables.API_KEY, 'my-secret-key');
    });
  });

  describe('list', () => {
    it('should return empty object when no variables', async () => {
      const list = await variableManager.list();

      assert.deepEqual(list, {});
    });

    it('should return all variables', async () => {
      await variableManager.set('API_KEY', 'secret');
      await variableManager.set('DEBUG_MODE', true);
      await variableManager.set('PORT_NUMBER', 8080);

      const list = await variableManager.list();

      assert.deepEqual(list, {
        API_KEY: 'secret',
        DEBUG_MODE: true,
        PORT_NUMBER: 8080,
      });
    });

    it('should return a copy, not reference', async () => {
      await variableManager.set('API_KEY', 'secret');

      const list = await variableManager.list();
      list.API_KEY = 'modified';

      const value = await variableManager.get('API_KEY');
      assert.equal(value, 'secret');
    });
  });

  describe('delete', () => {
    it('should delete existing variable', async () => {
      await variableManager.set('API_KEY', 'secret');

      const result = await variableManager.delete('API_KEY');

      assert.equal(result, true);
      const value = await variableManager.get('API_KEY');
      assert.equal(value, undefined);
    });

    it('should return false for non-existent variable', async () => {
      const result = await variableManager.delete('NON_EXISTENT');

      assert.equal(result, false);
    });

    it('should update file after deletion', async () => {
      await variableManager.set('API_KEY', 'secret');
      await variableManager.set('OTHER_VAR', 'value');

      await variableManager.delete('API_KEY');

      const fileContent = await fs.readFile(variablesPath, 'utf8');
      const savedVariables = JSON.parse(fileContent);
      assert.deepEqual(savedVariables, { OTHER_VAR: 'value' });
    });
  });

  describe('has', () => {
    it('should return true for existing variable', async () => {
      await variableManager.set('API_KEY', 'secret');

      const result = await variableManager.has('API_KEY');

      assert.equal(result, true);
    });

    it('should return false for non-existent variable', async () => {
      const result = await variableManager.has('NON_EXISTENT');

      assert.equal(result, false);
    });

    it('should return true for variable with null value', async () => {
      await variableManager.set('NULL_VAR', null);

      const result = await variableManager.has('NULL_VAR');

      assert.equal(result, true);
    });
  });

  describe('Variable name validation', () => {
    it('should accept valid UPPER_SNAKE_CASE names', async () => {
      await variableManager.set('API_KEY', 'value');
      await variableManager.set('SERVER_PORT_NUMBER', 3000);
      await variableManager.set('A', 'single letter');

      assert.equal(await variableManager.get('API_KEY'), 'value');
      assert.equal(await variableManager.get('SERVER_PORT_NUMBER'), 3000);
      assert.equal(await variableManager.get('A'), 'single letter');
    });

    it('should reject lowercase variable name', async () => {
      await assert.rejects(
        async () => await variableManager.set('api_key', 'value'),
        VariableValidationError
      );
    });

    it('should reject mixed case variable name', async () => {
      await assert.rejects(
        async () => await variableManager.set('ApiKey', 'value'),
        VariableValidationError
      );
    });

    it('should reject variable name starting with number', async () => {
      await assert.rejects(
        async () => await variableManager.set('1_API_KEY', 'value'),
        VariableValidationError
      );
    });

    it('should reject variable name with spaces', async () => {
      await assert.rejects(
        async () => await variableManager.set('API KEY', 'value'),
        VariableValidationError
      );
    });

    it('should reject variable name with hyphens', async () => {
      await assert.rejects(
        async () => await variableManager.set('API-KEY', 'value'),
        VariableValidationError
      );
    });

    it('should reject empty variable name', async () => {
      await assert.rejects(
        async () => await variableManager.set('', 'value'),
        VariableValidationError
      );
    });

    it('should reject variable name exceeding 64 characters', async () => {
      const longName = 'A'.repeat(65);

      await assert.rejects(
        async () => await variableManager.set(longName, 'value'),
        VariableValidationError
      );
    });

    it('should accept variable name with exactly 64 characters', async () => {
      const validName = 'A'.repeat(64);

      await variableManager.set(validName, 'value');

      assert.equal(await variableManager.get(validName), 'value');
    });
  });

  describe('Error handling', () => {
    it('should throw VariableValidationError with correct properties', async () => {
      try {
        await variableManager.set('invalid-name', 'value');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof VariableValidationError);
        assert.equal(error.variableName, 'invalid-name');
        assert.ok(error.message.includes('invalid-name'));
      }
    });
  });

  describe('JSON types support', () => {
    it('should handle nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };

      await variableManager.set('NESTED_CONFIG', nested);

      const value = await variableManager.get('NESTED_CONFIG');
      assert.deepEqual(value, nested);
    });

    it('should handle arrays with mixed types', async () => {
      const mixed = ['string', 123, true, null, { key: 'value' }, [1, 2, 3]];

      await variableManager.set('MIXED_ARRAY', mixed);

      const value = await variableManager.get('MIXED_ARRAY');
      assert.deepEqual(value, mixed);
    });

    it('should handle empty object', async () => {
      await variableManager.set('EMPTY_OBJECT', {});

      const value = await variableManager.get('EMPTY_OBJECT');
      assert.deepEqual(value, {});
    });

    it('should handle empty array', async () => {
      await variableManager.set('EMPTY_ARRAY', []);

      const value = await variableManager.get('EMPTY_ARRAY');
      assert.deepEqual(value, []);
    });

    it('should handle special string values', async () => {
      const specialStrings = [
        'hello "world"',
        'line1\nline2',
        'tab\there',
        'path\\to\\file',
        '{"json": "string"}',
      ];

      for (const str of specialStrings) {
        await variableManager.set('SPECIAL_STRING', str);
        const value = await variableManager.get('SPECIAL_STRING');
        assert.equal(value, str);
      }
    });

    it('should handle numeric values', async () => {
      const numbers = [0, 1, -1, 3.14, -3.14, 1e10, 1e-10, Number.MAX_SAFE_INTEGER];

      for (const num of numbers) {
        const varName = `NUM_${num.toString().replace('-', 'NEG_').replace('.', '_').replace('e', 'E')}`;
        await variableManager.set(varName, num);
        const value = await variableManager.get(varName);
        assert.equal(value, num);
      }
    });
  });

  describe('Model variable migration', () => {
    it('should convert string model value to array on initialization', async () => {
      const oldVariables = {
        model: 'claude-3-sonnet',
        API_KEY: 'secret123',
      };
      await fs.writeFile(variablesPath, JSON.stringify(oldVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables.model, ['claude-3-sonnet']);
      assert.equal(variableManager.variables.API_KEY, 'secret123');
    });

    it('should save migrated array model back to file', async () => {
      const oldVariables = { model: 'gpt-4' };
      await fs.writeFile(variablesPath, JSON.stringify(oldVariables));

      await variableManager.init();

      const fileContent = await fs.readFile(variablesPath, 'utf8');
      const savedVariables = JSON.parse(fileContent);
      assert.deepEqual(savedVariables.model, ['gpt-4']);
    });

    it('should leave existing array model unchanged', async () => {
      const originalVariables = {
        model: ['claude-3-sonnet', 'gpt-4'],
        OTHER_VAR: 'value',
      };
      await fs.writeFile(variablesPath, JSON.stringify(originalVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables.model, ['claude-3-sonnet', 'gpt-4']);
      assert.equal(variableManager.variables.OTHER_VAR, 'value');
    });

    it('should deduplicate array model values during migration', async () => {
      const oldVariables = { model: ['claude-3-sonnet', 'claude-3-sonnet', 'gpt-4'] };
      await fs.writeFile(variablesPath, JSON.stringify(oldVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables.model, ['claude-3-sonnet', 'gpt-4']);
    });

    it('should preserve other variables during migration', async () => {
      const oldVariables = {
        model: 'claude-3-sonnet',
        API_KEY: 'test-key',
        DEBUG_MODE: true,
        NESTED: { key: 'value' },
      };
      await fs.writeFile(variablesPath, JSON.stringify(oldVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables.model, ['claude-3-sonnet']);
      assert.equal(variableManager.variables.API_KEY, 'test-key');
      assert.equal(variableManager.variables.DEBUG_MODE, true);
      assert.deepEqual(variableManager.variables.NESTED, { key: 'value' });
    });

    it('should do nothing if no model variable exists', async () => {
      const oldVariables = { API_KEY: 'test-key' };
      await fs.writeFile(variablesPath, JSON.stringify(oldVariables));

      await variableManager.init();

      assert.deepEqual(variableManager.variables, oldVariables);
    });
  });
});

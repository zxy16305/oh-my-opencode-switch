import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OosError,
  ConfigError,
  ProfileError,
  FileSystemError,
  MissingVariableError,
  CircularReferenceError,
  TemplateSyntaxError,
  VariableValidationError,
} from '../../src/utils/errors.js';
import {
  validateProfileName,
  validateProfilesMetadata,
  validateVariableName,
} from '../../src/utils/validators.js';

describe('Errors', () => {
  describe('OosError', () => {
    it('should create OosError with correct properties', () => {
      const error = new OosError('Test error', 'TEST_ERROR', 1);
      assert.equal(error.message, 'Test error (TEST_ERROR)');
      assert.equal(error.code, 'TEST_ERROR');
      assert.equal(error.exitCode, 1);
      assert.equal(error.name, 'OosError');
    });
  });

  describe('ConfigError', () => {
    it('should create ConfigError with correct default values', () => {
      const error = new ConfigError('Config error');
      assert.equal(error.message, 'Config error (E002)');
      assert.equal(error.code, 'E002');
      assert.equal(error.exitCode, 2);
      assert.equal(error.name, 'ConfigError');
    });
  });

  describe('ProfileError', () => {
    it('should create ProfileError with correct default values', () => {
      const error = new ProfileError('Profile error');
      assert.equal(error.message, 'Profile error (E001)');
      assert.equal(error.code, 'E001');
      assert.equal(error.exitCode, 1);
      assert.equal(error.name, 'ProfileError');
    });
  });

  describe('FileSystemError', () => {
    it('should create FileSystemError with correct default values', () => {
      const error = new FileSystemError('FS error');
      assert.equal(error.message, 'FS error (E005)');
      assert.equal(error.code, 'E005');
      assert.equal(error.exitCode, 5);
      assert.equal(error.name, 'FileSystemError');
    });
  });

  describe('MissingVariableError', () => {
    it('should create MissingVariableError with correct properties', () => {
      const error = new MissingVariableError('API_KEY');
      assert.equal(error.message, 'Missing required variable: API_KEY (E010)');
      assert.equal(error.code, 'E010');
      assert.equal(error.exitCode, 2);
      assert.equal(error.name, 'MissingVariableError');
      assert.equal(error.variableName, 'API_KEY');
    });

    it('should inherit from OosError', () => {
      const error = new MissingVariableError('TEST_VAR');
      assert(error instanceof OosError);
    });
  });

  describe('CircularReferenceError', () => {
    it('should create CircularReferenceError with correct properties', () => {
      const error = new CircularReferenceError(['A', 'B', 'C']);
      assert.equal(error.message, 'Circular reference detected: A -> B -> C (E011)');
      assert.equal(error.code, 'E011');
      assert.equal(error.exitCode, 2);
      assert.equal(error.name, 'CircularReferenceError');
      assert.deepEqual(error.variablePath, ['A', 'B', 'C']);
    });

    it('should inherit from OosError', () => {
      const error = new CircularReferenceError(['A', 'B']);
      assert(error instanceof OosError);
    });
  });

  describe('TemplateSyntaxError', () => {
    it('should create TemplateSyntaxError with correct properties', () => {
      const error = new TemplateSyntaxError(10, 'Unexpected token');
      assert.equal(error.message, 'Template syntax error at position 10: Unexpected token (E012)');
      assert.equal(error.code, 'E012');
      assert.equal(error.exitCode, 2);
      assert.equal(error.name, 'TemplateSyntaxError');
      assert.equal(error.position, 10);
      assert.equal(error.details, 'Unexpected token');
    });

    it('should accept object position', () => {
      const error = new TemplateSyntaxError({ line: 5, column: 10 }, 'Syntax error');
      assert.equal(error.position.line, 5);
      assert.equal(error.position.column, 10);
    });

    it('should inherit from OosError', () => {
      const error = new TemplateSyntaxError(1, 'test');
      assert(error instanceof OosError);
    });
  });

  describe('VariableValidationError', () => {
    it('should create VariableValidationError with correct properties', () => {
      const error = new VariableValidationError('api-key', 'must be UPPER_SNAKE_CASE');
      assert.equal(
        error.message,
        "Invalid variable name 'api-key': must be UPPER_SNAKE_CASE (E013)"
      );
      assert.equal(error.code, 'E013');
      assert.equal(error.exitCode, 2);
      assert.equal(error.name, 'VariableValidationError');
      assert.equal(error.variableName, 'api-key');
      assert.equal(error.reason, 'must be UPPER_SNAKE_CASE');
    });

    it('should inherit from OosError', () => {
      const error = new VariableValidationError('test', 'reason');
      assert(error instanceof OosError);
    });
  });
});

describe('Validators', () => {
  describe('validateProfileName', () => {
    it('should validate valid profile names', () => {
      assert(validateProfileName('valid-profile').success);
      assert(validateProfileName('valid_profile').success);
      assert(validateProfileName('valid123').success);
    });

    it('should reject invalid profile names', () => {
      assert(!validateProfileName('').success);
      assert(!validateProfileName('invalid name').success);
      assert(!validateProfileName('-invalid').success);
      assert(!validateProfileName('invalid-').success);
      assert(!validateProfileName('current').success);
    });
  });

  describe('validateProfilesMetadata', () => {
    it('should validate valid profiles metadata', () => {
      const metadata = {
        version: 1,
        activeProfile: null,
        profiles: {},
      };
      const result = validateProfilesMetadata(metadata);
      assert(result.success);
      assert(result.data);
    });

    it('should reject invalid profiles metadata', () => {
      const result = validateProfilesMetadata({});
      assert(!result.success);
    });
  });

  describe('validateVariableName', () => {
    it('should validate valid variable names', () => {
      assert(validateVariableName('API_KEY').success);
      assert(validateVariableName('DEBUG_MODE').success);
      assert(validateVariableName('SERVER_PORT_8080').success);
      assert(validateVariableName('A').success);
      assert(validateVariableName('ABC_123_XYZ').success);
    });

    it('should reject invalid variable names', () => {
      assert(!validateVariableName('').success);
      assert(!validateVariableName('api-key').success);
      assert(!validateVariableName('apiKey').success);
      assert(!validateVariableName('API-KEY').success);
      assert(!validateVariableName('123START').success);
      assert(!validateVariableName('lower_case').success);
      assert(!validateVariableName('a'.repeat(65)).success);
    });

    it('should return proper error message', () => {
      const result = validateVariableName('invalid-name');
      assert(!result.success);
      assert(result.error.includes('UPPER_SNAKE_CASE'));
    });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variableNameSchema, validateVariableName } from '../../../src/utils/validators.js';

describe('variableNameSchema', () => {
  describe('valid names', () => {
    it('should accept simple UPPER_SNAKE_CASE name', () => {
      const result = variableNameSchema.safeParse('MY_VARIABLE');
      assert.equal(result.success, true);
    });

    it('should accept name with numbers', () => {
      const result = variableNameSchema.safeParse('MY_VAR_123');
      assert.equal(result.success, true);
    });

    it('should accept single letter name', () => {
      const result = variableNameSchema.safeParse('A');
      assert.equal(result.success, true);
    });

    it('should accept name with multiple underscores', () => {
      const result = variableNameSchema.safeParse('MY__VARIABLE');
      assert.equal(result.success, true);
    });

    it('should accept max length 64 characters', () => {
      const name = 'A'.repeat(64);
      const result = variableNameSchema.safeParse(name);
      assert.equal(result.success, true);
    });
  });

  describe('invalid names', () => {
    it('should reject empty string', () => {
      const result = variableNameSchema.safeParse('');
      assert.equal(result.success, false);
    });

    it('should reject lowercase letters', () => {
      const result = variableNameSchema.safeParse('my_variable');
      assert.equal(result.success, false);
    });

    it('should reject name starting with number', () => {
      const result = variableNameSchema.safeParse('1_VARIABLE');
      assert.equal(result.success, false);
    });

    it('should reject name starting with underscore', () => {
      const result = variableNameSchema.safeParse('_VARIABLE');
      assert.equal(result.success, false);
    });

    it('should reject name with spaces', () => {
      const result = variableNameSchema.safeParse('MY VARIABLE');
      assert.equal(result.success, false);
    });

    it('should reject name with special characters', () => {
      const result = variableNameSchema.safeParse('MY-VARIABLE');
      assert.equal(result.success, false);
    });

    it('should reject name exceeding 64 characters', () => {
      const name = 'A'.repeat(65);
      const result = variableNameSchema.safeParse(name);
      assert.equal(result.success, false);
    });

    it('should reject mixed case', () => {
      const result = variableNameSchema.safeParse('MyVariable');
      assert.equal(result.success, false);
    });
  });
});

describe('validateVariableName', () => {
  it('should return success for valid name', () => {
    const result = validateVariableName('MY_VARIABLE');
    assert.deepEqual(result, { success: true, data: 'MY_VARIABLE' });
  });

  it('should return error for invalid name', () => {
    const result = validateVariableName('invalid');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('should return error for empty string', () => {
    const result = validateVariableName('');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('should return error for non-string input', () => {
    const result = validateVariableName(123);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

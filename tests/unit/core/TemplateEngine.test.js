import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateEngine } from '../../../src/core/TemplateEngine.js';
import {
  MissingVariableError,
  CircularReferenceError,
  TemplateSyntaxError,
  VariableValidationError,
} from '../../../src/utils/errors.js';

describe('TemplateEngine', () => {
  let templateEngine;

  beforeEach(() => {
    templateEngine = new TemplateEngine();
  });

  describe('render', () => {
    describe('basic variable substitution', () => {
      it('should substitute a single variable', () => {
        const template = 'Hello, {{NAME}}!';
        const variables = { NAME: 'World' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Hello, World!');
      });

      it('should substitute multiple variables', () => {
        const template = '{{GREETING}}, {{NAME}}! Welcome to {{PLACE}}.';
        const variables = {
          GREETING: 'Hello',
          NAME: 'Alice',
          PLACE: 'Wonderland',
        };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Hello, Alice! Welcome to Wonderland.');
      });

      it('should handle the same variable used multiple times', () => {
        const template = '{{NAME}} says: "My name is {{NAME}}."';
        const variables = { NAME: 'Bob' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Bob says: "My name is Bob."');
      });

      it('should return unchanged template when no variables', () => {
        const template = 'This is a plain string with no variables.';
        const variables = {};
        const result = templateEngine.render(template, variables);
        assert.equal(result, template);
      });

      it('should handle variables with whitespace around braces', () => {
        const template = 'Hello, {{  NAME  }}!';
        const variables = { NAME: 'World' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Hello, World!');
      });
    });

    describe('variable types', () => {
      it('should substitute string values', () => {
        const template = 'Value: {{VAR}}';
        const variables = { VAR: 'test string' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Value: test string');
      });

      it('should substitute number values', () => {
        const template = 'Count: {{COUNT}}';
        const variables = { COUNT: 42 };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Count: 42');
      });

      it('should substitute negative numbers', () => {
        const template = 'Temperature: {{TEMP}}';
        const variables = { TEMP: -15 };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Temperature: -15');
      });

      it('should substitute floating point numbers', () => {
        const template = 'Pi: {{PI}}';
        const variables = { PI: 3.14159 };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Pi: 3.14159');
      });

      it('should substitute boolean true', () => {
        const template = 'Enabled: {{ENABLED}}';
        const variables = { ENABLED: true };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Enabled: true');
      });

      it('should substitute boolean false', () => {
        const template = 'Enabled: {{ENABLED}}';
        const variables = { ENABLED: false };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Enabled: false');
      });

      it('should substitute null value', () => {
        const template = 'Value: {{VAR}}';
        const variables = { VAR: null };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Value: null');
      });
    });

    describe('object and array values', () => {
      it('should stringify object values as JSON', () => {
        const template = 'Config: {{CONFIG}}';
        const variables = { CONFIG: { host: 'localhost', port: 3000 } };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Config: {"host":"localhost","port":3000}');
      });

      it('should stringify array values as JSON', () => {
        const template = 'Items: {{ITEMS}}';
        const variables = { ITEMS: ['a', 'b', 'c'] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Items: ["a","b","c"]');
      });

      it('should stringify nested objects', () => {
        const template = 'Data: {{DATA}}';
        const variables = {
          DATA: {
            user: {
              name: 'Alice',
              roles: ['admin', 'user'],
            },
          },
        };
        const result = templateEngine.render(template, variables);
        assert.ok(result.includes('"user"'));
        assert.ok(result.includes('"Alice"'));
        assert.ok(result.includes('admin'));
      });

      it('should stringify empty object', () => {
        const template = 'Empty: {{OBJ}}';
        const variables = { OBJ: {} };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Empty: {}');
      });

      it('should stringify empty array', () => {
        const template = 'Empty: {{ARR}}';
        const variables = { ARR: [] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Empty: []');
      });

      it('should stringify array with mixed types', () => {
        const template = 'Mixed: {{MIXED}}';
        const variables = { MIXED: ['string', 123, true, null, { key: 'value' }] };
        const result = templateEngine.render(template, variables);
        assert.ok(result.includes('"string"'));
        assert.ok(result.includes('123'));
        assert.ok(result.includes('true'));
        assert.ok(result.includes('null'));
        assert.ok(result.includes('"key":"value"'));
      });
    });

    describe('model variable handling', () => {
      it('should handle single string model value', () => {
        const template = 'Model: {{model}}';
        const variables = { model: 'claude-3-sonnet' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Model: claude-3-sonnet');
      });

      it('should use first valid element from model array', () => {
        const template = 'Model: {{model}}';
        const variables = { model: ['claude-3-sonnet', 'gpt-4', 'other'] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Model: claude-3-sonnet');
      });

      it('should skip invalid elements and use next valid', () => {
        const template = 'Model: {{model}}';
        const variables = { model: ['', '   ', 'claude-3-opus', 'gpt-4'] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Model: claude-3-opus');
      });

      it('should skip non-string elements', () => {
        const template = 'Model: {{model}}';
        const variables = { model: [123, null, true, 'claude-3-haiku'] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Model: claude-3-haiku');
      });

      it('should throw VariableValidationError when no valid model found', () => {
        const template = 'Model: {{model}}';
        const variables = { model: ['', '   ', 123, null, true] };
        assert.throws(() => templateEngine.render(template, variables), VariableValidationError);
      });

      it('should trim whitespace from valid model', () => {
        const template = 'Model: {{model}}';
        const variables = { model: ['   claude-3-5-sonnet   '] };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Model: claude-3-5-sonnet');
      });
    });

    describe('missing variables', () => {
      it('should throw MissingVariableError for missing variable', () => {
        const template = 'Hello, {{NAME}}!';
        const variables = {};

        assert.throws(() => templateEngine.render(template, variables), MissingVariableError);
      });

      it('should include variable name in MissingVariableError', () => {
        const template = 'Hello, {{NAME}}!';
        const variables = {};

        try {
          templateEngine.render(template, variables);
          assert.fail('Should have thrown MissingVariableError');
        } catch (error) {
          assert.ok(error instanceof MissingVariableError);
          assert.equal(error.variableName, 'NAME');
        }
      });

      it('should throw MissingVariableError for first missing variable', () => {
        const template = '{{A}} and {{B}} and {{C}}';
        const variables = { A: 'a', C: 'c' }; // B is missing

        assert.throws(() => templateEngine.render(template, variables), MissingVariableError);
      });

      it('should not throw when variable is explicitly undefined', () => {
        // undefined values in object are treated as missing
        const template = 'Hello, {{NAME}}!';
        const variables = { NAME: undefined };

        assert.throws(() => templateEngine.render(template, variables), MissingVariableError);
      });
    });

    describe('circular reference detection', () => {
      it('should throw CircularReferenceError for direct circular reference', () => {
        const template = '{{A}}';
        const variables = {
          A: '{{B}}',
          B: '{{A}}',
        };

        assert.throws(() => templateEngine.render(template, variables), CircularReferenceError);
      });

      it('should include path in CircularReferenceError', () => {
        const template = '{{A}}';
        const variables = {
          A: '{{B}}',
          B: '{{A}}',
        };

        try {
          templateEngine.render(template, variables);
          assert.fail('Should have thrown CircularReferenceError');
        } catch (error) {
          assert.ok(error instanceof CircularReferenceError);
          assert.ok(Array.isArray(error.variablePath));
          assert.ok(error.variablePath.includes('A'));
          assert.ok(error.variablePath.includes('B'));
        }
      });

      it('should throw for self-referencing variable', () => {
        const template = '{{SELF}}';
        const variables = {
          SELF: '{{SELF}}',
        };

        assert.throws(() => templateEngine.render(template, variables), CircularReferenceError);
      });

      it('should throw for longer circular chain', () => {
        const template = '{{A}}';
        const variables = {
          A: '{{B}}',
          B: '{{C}}',
          C: '{{D}}',
          D: '{{A}}',
        };

        assert.throws(() => templateEngine.render(template, variables), CircularReferenceError);
      });

      it('should not throw for non-circular variable references', () => {
        const template = '{{A}}';
        const variables = {
          A: 'Value is {{B}}',
          B: 'simple',
        };

        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Value is simple');
      });
    });

    describe('logic construct rejection', () => {
      it('should reject #if construct', () => {
        const template = '{{#if CONDITION}}yes{{/if}}';
        const variables = { CONDITION: true };

        assert.throws(() => templateEngine.render(template, variables), TemplateSyntaxError);
      });

      it('should reject #each construct', () => {
        const template = '{{#each ITEMS}}{{this}}{{/each}}';
        const variables = { ITEMS: [1, 2, 3] };

        assert.throws(() => templateEngine.render(template, variables), TemplateSyntaxError);
      });

      it('should reject #unless construct', () => {
        const template = '{{#unless HIDDEN}}visible{{/unless}}';
        const variables = { HIDDEN: false };

        assert.throws(() => templateEngine.render(template, variables), TemplateSyntaxError);
      });

      it('should reject #with construct', () => {
        const template = '{{#with USER}}{{name}}{{/with}}';
        const variables = { USER: { name: 'Alice' } };

        assert.throws(() => templateEngine.render(template, variables), TemplateSyntaxError);
      });

      it('should reject nested logic constructs', () => {
        const template = '{{#if A}}{{#if B}}yes{{/if}}{{/if}}';
        const variables = { A: true, B: true };

        assert.throws(() => templateEngine.render(template, variables), TemplateSyntaxError);
      });

      it('should include construct name in error message', () => {
        const template = '{{#if COND}}text{{/if}}';

        try {
          templateEngine.render(template, {});
          assert.fail('Should have thrown TemplateSyntaxError');
        } catch (error) {
          assert.ok(error instanceof TemplateSyntaxError);
          assert.ok(error.message.includes('if'));
        }
      });
    });

    describe('special characters and escaping', () => {
      it('should handle variable values with special characters', () => {
        const template = 'Path: {{PATH}}';
        const variables = { PATH: 'C:\\Users\\test\\file.txt' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Path: C:\\Users\\test\\file.txt');
      });

      it('should handle variable values with quotes', () => {
        const template = 'Quote: {{TEXT}}';
        const variables = { TEXT: 'He said "Hello"' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Quote: He said "Hello"');
      });

      it('should handle variable values with newlines', () => {
        const template = 'Text: {{TEXT}}';
        const variables = { TEXT: 'Line 1\nLine 2\nLine 3' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Text: Line 1\nLine 2\nLine 3');
      });

      it('should handle variable values with tabs', () => {
        const template = 'Data: {{DATA}}';
        const variables = { DATA: 'Col1\tCol2\tCol3' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Data: Col1\tCol2\tCol3');
      });

      it('should handle empty string variable', () => {
        const template = 'Value: "{{VAR}}"';
        const variables = { VAR: '' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'Value: ""');
      });

      it('should handle HTML-like content in variable', () => {
        const template = 'HTML: {{HTML}}';
        const variables = { HTML: '<script>alert("xss")</script>' };
        const result = templateEngine.render(template, variables);
        // Handlebars escapes HTML by default
        assert.ok(result.includes('&lt;') || result.includes('<script>'));
      });
    });

    describe('template validation', () => {
      it('should validate correct template', () => {
        const template = 'Hello, {{NAME}}!';
        const result = templateEngine.validate(template);
        assert.equal(result.valid, true);
      });

      it('should detect invalid template with logic constructs', () => {
        const template = '{{#if COND}}text{{/if}}';
        const result = templateEngine.validate(template);
        assert.equal(result.valid, false);
        assert.ok(result.error);
      });
    });

    describe('edge cases', () => {
      it('should handle empty template', () => {
        const result = templateEngine.render('', {});
        assert.equal(result, '');
      });

      it('should handle template with only whitespace', () => {
        const result = templateEngine.render('   \n\t  ', {});
        assert.equal(result, '   \n\t  ');
      });

      it('should handle very long variable value', () => {
        const template = '{{LONG}}';
        const longValue = 'x'.repeat(10000);
        const variables = { LONG: longValue };
        const result = templateEngine.render(template, variables);
        assert.equal(result, longValue);
      });

      it('should handle many variables in template', () => {
        const parts = [];
        const variables = {};
        for (let i = 0; i < 100; i++) {
          parts.push(`{{VAR_${i}}}`);
          variables[`VAR_${i}`] = `value_${i}`;
        }
        const template = parts.join(' ');
        const result = templateEngine.render(template, variables);
        assert.ok(result.includes('value_0'));
        assert.ok(result.includes('value_99'));
      });

      it('should handle variable names with numbers', () => {
        const template = '{{API_KEY_1}} and {{VAR2}}';
        const variables = { API_KEY_1: 'key1', VAR2: 'value2' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'key1 and value2');
      });

      it('should handle variable names with underscores', () => {
        const template = '{{MY_LONG_VARIABLE_NAME}}';
        const variables = { MY_LONG_VARIABLE_NAME: 'value' };
        const result = templateEngine.render(template, variables);
        assert.equal(result, 'value');
      });
    });
  });

  describe('_extractVariables', () => {
    it('should extract all variable names', () => {
      const template = '{{A}} {{B}} {{C}}';
      const vars = templateEngine._extractVariables(template);
      assert.deepEqual([...vars].sort(), ['A', 'B', 'C']);
    });

    it('should return empty set for no variables', () => {
      const template = 'no variables here';
      const vars = templateEngine._extractVariables(template);
      assert.equal(vars.size, 0);
    });

    it('should deduplicate repeated variables', () => {
      const template = '{{A}} {{A}} {{B}} {{A}}';
      const vars = templateEngine._extractVariables(template);
      assert.deepEqual([...vars].sort(), ['A', 'B']);
    });
  });
});

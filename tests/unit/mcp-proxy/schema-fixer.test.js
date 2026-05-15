import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixEnumTypes, fixToolsListResponse } from '../../../src/proxy/mcp-proxy/schema-fixer.js';

describe('fixEnumTypes', () => {
  test('adds type:string to string enum missing type', () => {
    const result = fixEnumTypes({ enum: ['a', 'b', 'c'] });
    assert.deepStrictEqual(result, { enum: ['a', 'b', 'c'], type: 'string' });
  });

  test('skips mixed-type enum', () => {
    const input = { enum: ['a', 1] };
    const result = fixEnumTypes(input);
    assert.strictEqual(result.type, undefined);
  });

  test('skips enum that already has type', () => {
    const input = { enum: ['a', 'b'], type: 'string' };
    const result = fixEnumTypes(input);
    assert.deepStrictEqual(result, { enum: ['a', 'b'], type: 'string' });
  });

  test('handles nested properties', () => {
    const result = fixEnumTypes({ properties: { foo: { enum: ['x', 'y'] } } });
    assert.deepStrictEqual(result.properties.foo, { enum: ['x', 'y'], type: 'string' });
  });

  test('handles nested items', () => {
    const result = fixEnumTypes({ items: { enum: ['x'] } });
    assert.deepStrictEqual(result.items, { enum: ['x'], type: 'string' });
  });

  test('handles anyOf', () => {
    const result = fixEnumTypes({ anyOf: [{ enum: ['a'] }] });
    assert.deepStrictEqual(result.anyOf[0], { enum: ['a'], type: 'string' });
  });

  test('handles allOf', () => {
    const result = fixEnumTypes({ allOf: [{ enum: ['b'] }] });
    assert.deepStrictEqual(result.allOf[0], { enum: ['b'], type: 'string' });
  });

  test('handles oneOf', () => {
    const result = fixEnumTypes({ oneOf: [{ enum: ['c'] }] });
    assert.deepStrictEqual(result.oneOf[0], { enum: ['c'], type: 'string' });
  });

  test('handles empty enum (vacuously all strings)', () => {
    const result = fixEnumTypes({ enum: [] });
    assert.deepStrictEqual(result, { enum: [], type: 'string' });
  });

  test('does not mutate input', () => {
    const input = { enum: ['a'] };
    const output = fixEnumTypes(input);
    assert.notStrictEqual(output, input);
    assert.strictEqual(input.type, undefined);
  });

  test('returns primitives unchanged', () => {
    assert.strictEqual(fixEnumTypes('hello'), 'hello');
    assert.strictEqual(fixEnumTypes(42), 42);
    assert.strictEqual(fixEnumTypes(null), null);
    assert.strictEqual(fixEnumTypes(true), true);
  });
});

describe('fixToolsListResponse', () => {
  test('fixes inputSchema with enum missing type', () => {
    const msg = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{
          name: 'myTool',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { enum: ['fast', 'slow'] }
            }
          }
        }]
      }
    };
    const fixed = fixToolsListResponse(msg);
    assert.strictEqual(fixed.result.tools[0].inputSchema.properties.mode.type, 'string');
  });

  test('fixes outputSchema with enum missing type', () => {
    const msg = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{
          name: 'myTool',
          outputSchema: {
            type: 'object',
            properties: {
              format: { enum: ['text', 'json'] }
            }
          }
        }]
      }
    };
    const fixed = fixToolsListResponse(msg);
    assert.strictEqual(fixed.result.tools[0].outputSchema.properties.format.type, 'string');
  });

  test('no enum without type remains after fixing', () => {
    const msg = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [{
          name: 'tool1',
          inputSchema: {
            type: 'object',
            properties: {
              a: { enum: ['x', 'y'] },
              b: { type: 'string', enum: ['p', 'q'] }
            }
          }
        }, {
          name: 'tool2',
          inputSchema: {
            type: 'object',
            properties: {
              c: {
                anyOf: [{ enum: ['m', 'n'] }]
              }
            }
          }
        }]
      }
    };
    const fixed = fixToolsListResponse(msg);

    const violations = [];
    function checkForViolation(obj, path) {
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (Array.isArray(obj.enum) && !obj.type) {
          const allStrings = obj.enum.every((v) => typeof v === 'string');
          if (allStrings && obj.enum.length > 0) {
            violations.push(path);
          }
        }
        for (const [key, val] of Object.entries(obj)) {
          checkForViolation(val, `${path}.${key}`);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, i) => checkForViolation(item, `${path}[${i}]`));
      }
    }

    for (let i = 0; i < fixed.result.tools.length; i++) {
      const tool = fixed.result.tools[i];
      if (tool.inputSchema) checkForViolation(tool.inputSchema, `tools[${i}].inputSchema`);
      if (tool.outputSchema) checkForViolation(tool.outputSchema, `tools[${i}].outputSchema`);
    }
    assert.strictEqual(violations.length, 0, `Found enum without type at: ${violations.join(', ')}`);
  });

  test('returns original for non-tools/list response', () => {
    const msg = { jsonrpc: '2.0', id: 2, result: { content: [] } };
    const out = fixToolsListResponse(msg);
    assert.strictEqual(out, msg);
  });

  test('returns original for null input', () => {
    assert.strictEqual(fixToolsListResponse(null), null);
  });

  test('returns original when result has no tools array', () => {
    const msg = { jsonrpc: '2.0', id: 1, result: { something: 'else' } };
    assert.strictEqual(fixToolsListResponse(msg), msg);
  });
});

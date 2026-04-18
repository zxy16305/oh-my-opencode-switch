/**
 * Tests for request-transformer module.
 * Transforms Chat Completions API format → Responses API format for GPT-5.
 * @module tests/unit/request-transformer.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformRequestBody } from '../../src/proxy/request-transformer.js';

describe('transformRequestBody', () => {
  // ---------------------------------------------------------------------------
  // Test 1: Full transformation with all fields
  // ---------------------------------------------------------------------------
  it('should transform all fields: messages→input, tools unwrap, reasoning_effort, max_tokens', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' },
          },
        },
      ],
      reasoning_effort: 'medium',
      max_tokens: 1000,
      stream: true,
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.deepEqual(result.input, requestBody.messages);
    assert.equal(result.messages, undefined, 'messages should be removed');
    assert.deepEqual(result.tools, [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object' },
      },
    ]);
    assert.deepEqual(result.reasoning, { effort: 'medium' });
    assert.equal(result.reasoning_effort, undefined, 'reasoning_effort should be removed');
    assert.equal(result.max_output_tokens, 1000);
    assert.equal(result.max_tokens, undefined, 'max_tokens should be removed');
    assert.equal(result.model, 'gpt-5');
    assert.equal(result.stream, true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Messages only (no tools, no reasoning) → just rename messages→input, model
  // ---------------------------------------------------------------------------
  it('should transform messages to input without tools or reasoning', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5-turbo'));

    assert.deepEqual(result.input, requestBody.messages);
    assert.equal(result.messages, undefined);
    assert.equal(result.model, 'gpt-5-turbo');
    assert.equal(result.tools, undefined);
    assert.equal(result.reasoning, undefined);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Tools unwrap verification (function wrapper removed)
  // ---------------------------------------------------------------------------
  it('should unwrap tools[].function to tools[] directly', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search web',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
        },
        {
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Do math',
            parameters: { type: 'object' },
          },
        },
      ],
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].function, undefined, 'function wrapper should be removed');
    assert.equal(result.tools[0].name, 'search');
    assert.equal(result.tools[0].description, 'Search web');
    assert.deepEqual(result.tools[0].parameters, {
      type: 'object',
      properties: { q: { type: 'string' } },
    });
    assert.equal(result.tools[1].name, 'calculate');
  });

  // ---------------------------------------------------------------------------
  // Test 4: reasoning_effort → reasoning.effort restructuring
  // ---------------------------------------------------------------------------
  it('should restructure reasoning_effort to reasoning.effort', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [],
      reasoning_effort: 'high',
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.deepEqual(result.reasoning, { effort: 'high' });
    assert.equal(result.reasoning_effort, undefined);
  });

  // ---------------------------------------------------------------------------
  // Test 5: max_tokens → max_output_tokens rename
  // ---------------------------------------------------------------------------
  it('should rename max_tokens to max_output_tokens', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [],
      max_tokens: 2048,
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.equal(result.max_output_tokens, 2048);
    assert.equal(result.max_tokens, undefined);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Fields preserved: temperature, top_p, presence_penalty, frequency_penalty, stop, user
  // ---------------------------------------------------------------------------
  it('should preserve other fields: temperature, top_p, presence_penalty, etc.', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [],
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      stop: ['END'],
      user: 'user-123',
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.equal(result.temperature, 0.7);
    assert.equal(result.top_p, 0.9);
    assert.equal(result.presence_penalty, 0.1);
    assert.equal(result.frequency_penalty, 0.2);
    assert.deepEqual(result.stop, ['END']);
    assert.equal(result.user, 'user-123');
  });

  // ---------------------------------------------------------------------------
  // Test 7: stream: true preserved
  // ---------------------------------------------------------------------------
  it('should preserve stream option', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [],
      stream: true,
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

    assert.equal(result.stream, true);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Model replaced with upstreamModel
  // ---------------------------------------------------------------------------
  it('should replace model with upstreamModel parameter', () => {
    const requestBody = {
      model: 'original-model',
      messages: [],
    };

    const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5-custom'));

    assert.equal(result.model, 'gpt-5-custom');
  });

  // ---------------------------------------------------------------------------
  // Test 9: Edge case - empty requestBody → minimal output
  // ---------------------------------------------------------------------------
  it('should handle empty requestBody with minimal output', () => {
    const requestBody = {};
    const upstreamModel = 'gpt-5';

    const result = JSON.parse(transformRequestBody(requestBody, upstreamModel));

    assert.equal(result.model, 'gpt-5');
    assert.equal(result.input, undefined);
    assert.equal(result.tools, undefined);
    assert.equal(result.reasoning, undefined);
    assert.equal(result.max_output_tokens, undefined);
  });

  // ---------------------------------------------------------------------------
  // Additional: Returns JSON string
  // ---------------------------------------------------------------------------
  it('should return a JSON string', () => {
    const requestBody = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = transformRequestBody(requestBody, 'gpt-5');

    assert.equal(typeof result, 'string');
    // Should be valid JSON
    assert.doesNotThrow(() => JSON.parse(result));
  });

  // ---------------------------------------------------------------------------
  // Additional: reasoning_effort with low/medium/high values
  // ---------------------------------------------------------------------------
  it('should handle all reasoning_effort values', () => {
    for (const effort of ['low', 'medium', 'high']) {
      const requestBody = {
        model: 'gpt-4',
        messages: [],
        reasoning_effort: effort,
      };

      const result = JSON.parse(transformRequestBody(requestBody, 'gpt-5'));

      assert.deepEqual(result.reasoning, { effort });
    }
  });
});

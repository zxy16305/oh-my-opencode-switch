/**
 * Unit tests for proxy/response-transformer module
 * @module tests/unit/response-transformer.test
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseTransformer } from '../../src/proxy/response-transformer.js';

// ===========================================================================
// Helper to collect stream output
// ===========================================================================

function collectStreamOutput(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk.toString()));
    stream.on('end', () => resolve(chunks.join('')));
    stream.on('error', reject);
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('ResponseTransformer', () => {
  let transformer;

  beforeEach(() => {
    transformer = new ResponseTransformer();
  });

  // -------------------------------------------------------------------------
  // Test 1: SSE text delta transformation → Chat Completions chunk with content
  // -------------------------------------------------------------------------

  test('text delta transforms to Chat Completions chunk with content', async () => {
    const input = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"object":"chat.completion.chunk"'));
    assert.ok(output.includes('"content":"hello"'));
    assert.ok(output.includes('"role":"assistant"'));
    assert.ok(output.includes('"id":"chatcmpl-'));
  });

  // -------------------------------------------------------------------------
  // Test 2: Tool call delta transformation → Chat Completions chunk with tool_calls
  // -------------------------------------------------------------------------

  test('tool call delta transforms to Chat Completions chunk with tool_calls', async () => {
    const input = 'data: {"type":"response.function_call_arguments.delta","name":"get_weather","arguments":"{\\"loc","delta":"{\\"loc"}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"tool_calls"'));
    assert.ok(output.includes('"name":"get_weather"'));
    assert.ok(output.includes('"type":"function"'));
  });

  // -------------------------------------------------------------------------
  // Test 3: Response completed → usage event + [DONE]
  // -------------------------------------------------------------------------

  test('response.completed injects usage event and [DONE]', async () => {
    const input = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":20}}}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    // Should have usage chunk
    assert.ok(output.includes('"usage"'));
    assert.ok(output.includes('"prompt_tokens":10'));
    assert.ok(output.includes('"completion_tokens":20'));
    assert.ok(output.includes('"total_tokens":30'));
    // Should have [DONE]
    assert.ok(output.includes('data: [DONE]'));
  });

  test('response.completed preserves cache usage fields for downstream token parsing', async () => {
    const input =
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":124550,"output_tokens":135,"total_tokens":124685,"input_tokens_details":{"cached_tokens":120000},"prompt_tokens_details":{"cache_creation_input_tokens":4500}}}}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"prompt_tokens":124550'));
    assert.ok(output.includes('"completion_tokens":135'));
    assert.ok(output.includes('"total_tokens":124685'));
    assert.ok(output.includes('"input_tokens_details":{"cached_tokens":120000}'));
    assert.ok(
      output.includes(
        '"prompt_tokens_details":{"cache_creation_input_tokens":4500,"cached_tokens":120000}'
      ) ||
        output.includes(
          '"prompt_tokens_details":{"cached_tokens":120000,"cache_creation_input_tokens":4500}'
        )
    );
    assert.ok(output.includes('data: [DONE]'));
  });

  // -------------------------------------------------------------------------
  // Test 4: Partial chunk handling (write partial data, then rest, verify output)
  // -------------------------------------------------------------------------

  test('partial chunks are buffered and processed correctly', async () => {
    const outputPromise = collectStreamOutput(transformer);

    // Write partial chunk (no complete line)
    transformer.write('data: {"type":"response.output_text.delta","delta":"hel');
    // Write the rest
    transformer.write('lo"}\n\n');
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"content":"hello"'));
  });

  test('multiple partial chunks across line boundaries', async () => {
    const outputPromise = collectStreamOutput(transformer);

    // First line split across chunks
    transformer.write('data: {"type":"response.output_text.delta","delta":"fi');
    transformer.write('rst"}\n\ndata: {"type":"response.output_text.delta","delta":"sec');
    transformer.write('ond"}\n\n');
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"content":"first"'));
    assert.ok(output.includes('"content":"second"'));
  });

  // -------------------------------------------------------------------------
  // Test 5: Multiple sequential deltas → multiple output chunks
  // -------------------------------------------------------------------------

  test('multiple sequential deltas produce multiple output chunks', async () => {
    const input = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","delta":" "}\n\n',
      'data: {"type":"response.output_text.delta","delta":"world"}\n\n',
    ].join('');
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    // All three chunks should be in output
    assert.ok(output.includes('"content":"Hello"'));
    assert.ok(output.includes('"content":" "'));
    assert.ok(output.includes('"content":"world"'));
  });

  // -------------------------------------------------------------------------
  // Test 6: Unknown event type → graceful handling
  // -------------------------------------------------------------------------

  test('unknown event type is passed through unchanged', async () => {
    const input = 'data: {"type":"unknown.event.type","some":"data"}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    // Unknown events should be passed through as-is
    assert.ok(output.includes('"type":"unknown.event.type"'));
    assert.ok(output.includes('"some":"data"'));
  });

  test('malformed JSON is handled gracefully', async () => {
    const input = 'data: {invalid json}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    // Should not throw, should complete
    const output = await outputPromise;
    // Malformed lines are silently skipped
    assert.ok(output === '' || output.includes('data:'));
  });

  // -------------------------------------------------------------------------
  // Test 7: Empty lines and comments are ignored
  // -------------------------------------------------------------------------

  test('empty lines and non-data lines are ignored', async () => {
    const input = '\n: comment line\n\ndata: {"type":"response.output_text.delta","delta":"test"}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"content":"test"'));
    // Should not include comment
    assert.ok(!output.includes(': comment line'));
  });

  // -------------------------------------------------------------------------
  // Test 8: Tool call with complete flow
  // -------------------------------------------------------------------------

  test('tool call with function name and arguments', async () => {
    const input = 'data: {"type":"response.function_call_arguments.delta","call_id":"call_abc123","name":"search","arguments":"{\\"query\\":\\"test\\"}"}\n\n';
    const outputPromise = collectStreamOutput(transformer);

    transformer.write(input);
    transformer.end();

    const output = await outputPromise;
    assert.ok(output.includes('"tool_calls"'));
    assert.ok(output.includes('"name":"search"'));
    assert.ok(output.includes('"id":"call_abc123"'));
  });
});

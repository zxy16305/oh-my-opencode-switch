import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TokenCaptivee } from '../../../src/utils/token-capttee.js';

describe('TokenCaptivee', () => {
  let stream;
  let forwardedChunks;

  beforeEach(() => {
    forwardedChunks = [];
  });

  describe('SSE streaming responses', () => {
    it('should capture usage from SSE streaming response with usage in last data line before [DONE]', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });
      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });

    it('should handle SSE response without usage field (returns null, no crash)', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.strictEqual(usage, null);

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });

    it('should handle large SSE streaming responses without usage', async () => {
      const chunks = [];
      for (let i = 0; i < 100; i++) {
        chunks.push(`data: {"choices":[{"delta":{"content":"chunk${i}"}}]}\n\n`);
      }
      chunks.push('data: [DONE]\n\n');

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.strictEqual(usage, null);

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });
  });

  describe('Non-streaming JSON responses', () => {
    it('should capture usage from non-streaming JSON response', async () => {
      const responseData = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{ message: { content: 'Hello world', role: 'assistant' } }],
        usage: { prompt_tokens: 200, completion_tokens: 75, total_tokens: 275 },
      };
      const chunk = JSON.stringify(responseData);

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      stream.write(chunk);
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 200,
        output_tokens: 75,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 275,
      });

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunk);
    });

    it('should handle non-streaming JSON without usage field', async () => {
      const responseData = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [{ message: { content: 'Hello world', role: 'assistant' } }],
      };
      const chunk = JSON.stringify(responseData);

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      stream.write(chunk);
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.strictEqual(usage, null);

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunk);
    });
  });

  describe('Chunk boundary handling', () => {
    it('should handle fragmented usage JSON across chunk boundaries', async () => {
      const chunk1 = 'data: {"choices":[],"usage":{"prompt_tokens":100,';
      const chunk2 = '"completion_tokens":50,"total_tokens":150}}\n\n';
      const chunk3 = 'data: [DONE]\n\n';

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      stream.write(chunk1);
      stream.write(chunk2);
      stream.write(chunk3);
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunk1 + chunk2 + chunk3);
    });

    it('should handle SSE data line split across multiple chunks', async () => {
      const parts = [
        'data: {"choices":',
        '[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"usage":',
        '{"prompt_tokens":50,"completion_tokens":25}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const part of parts) {
        stream.write(part);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 50,
        output_tokens: 25,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 75,
      });

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, parts.join(''));
    });
  });

  describe('Error handling', () => {
    it('should handle malformed JSON in usage field (returns null, no crash)', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"usage":{"prompt_tokens":not_a_number}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.strictEqual(usage, null);

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });

    it('should handle malformed SSE data lines gracefully', async () => {
      const chunks = [
        'data: {invalid json}\n\n',
        'data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.deepEqual(usage, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });
  });

  describe('Data forwarding verification', () => {
    it('should forward all data unchanged through stream', async () => {
      const originalData = Buffer.from([
        'data: line1\n\n',
        'data: line2\n\n',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ].join(''));

      stream = new TokenCaptivee();
      const receivedData = [];

      stream.on('data', (chunk) => receivedData.push(chunk));

      for (let i = 0; i < originalData.length; i += 10) {
        stream.write(originalData.slice(i, i + 10));
      }
      stream.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      const forwarded = Buffer.concat(receivedData);

      assert.deepEqual(forwarded, originalData);
    });

    it('should not delay data forwarding', async () => {
      stream = new TokenCaptivee();

      const receivedOrder = [];
      stream.on('data', (chunk) => {
        receivedOrder.push(chunk.toString());
      });

      const chunk1 = 'data: {"usage":{"prompt_tokens":100}}\n\n';
      const chunk2 = 'data: [DONE]\n\n';

      stream.write(chunk1);
      assert.strictEqual(receivedOrder.length, 1);
      assert.strictEqual(receivedOrder[0], chunk1);

      stream.write(chunk2);
      assert.strictEqual(receivedOrder.length, 2);

      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));
    });
  });

  describe('Anthropic-style usage', () => {
    it('should capture Anthropic-style usage from SSE stream', async () => {
      const chunks = [
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        'data: {"type":"message_delta","usage":{"input_tokens":150,"output_tokens":75,"cache_read_input_tokens":30,"cache_creation_input_tokens":20}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 150,
        output_tokens: 75,
        cache_read: 30,
        cache_write: 20,
        reasoning_tokens: 0,
        total_tokens: 225,
      });
    });
  });

  describe('Responses API format', () => {
    it('should capture usage from response.completed event', async () => {
      const chunks = [
        'data: {"type":"response.created","response":{"id":"resp_123"}}\n\n',
        'data: {"type":"response.output.text.delta","delta":{"text":"Hello"}}\n\n',
        'data: {"type":"response.output.text.delta","delta":{"text":" world"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_123","usage":{"input_tokens":200,"output_tokens":100,"total_tokens":300,"cache_read_input_tokens":50}}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      assert.deepEqual(usage, {
        input_tokens: 200,
        output_tokens: 100,
        cache_read: 50,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 300,
      });

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });

    it('should handle both Chat Completions usage and response.completed in same stream (response.completed takes precedence)', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":200,"output_tokens":100,"total_tokens":300}}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();

      // Response.completed comes after Chat Completions usage, so it should take precedence
      assert.deepEqual(usage, {
        input_tokens: 200,
        output_tokens: 100,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 300,
      });
    });

    it('should ignore response.completed event without usage field', async () => {
      const chunks = [
        'data: {"type":"response.created","response":{"id":"resp_123"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_123"}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      const usage = stream.getUsage();
      assert.strictEqual(usage, null);

      const forwardedData = Buffer.concat(forwardedChunks).toString();
      assert.strictEqual(forwardedData, chunks.join(''));
    });

    it('should handle malformed response.completed event gracefully', async () => {
      const chunks = [
        'data: {"type":"response.completed", invalid json}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
        'data: [DONE]\n\n',
      ];

      stream = new TokenCaptivee();
      stream.on('data', (chunk) => forwardedChunks.push(chunk));

      for (const chunk of chunks) {
        stream.write(chunk);
      }
      stream.end();
      await new Promise((resolve) => stream.on('finish', resolve));

      // Should fall back to Chat Completions usage
      const usage = stream.getUsage();
      assert.deepEqual(usage, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });
    });
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { McpSseTransformer } from '../../../src/proxy/mcp-proxy/sse-transformer.js';

function transformSSE(input) {
  return new Promise((resolve, reject) => {
    const transformer = new McpSseTransformer();
    const chunks = [];
    transformer.on('data', (chunk) => chunks.push(chunk));
    transformer.on('end', () => resolve(Buffer.concat(chunks).toString()));
    transformer.on('error', reject);
    transformer.end(input);
  });
}

function transformSSEWithPrefix(input, pathPrefix) {
  return new Promise((resolve, reject) => {
    const transformer = new McpSseTransformer({ pathPrefix });
    const chunks = [];
    transformer.on('data', (chunk) => chunks.push(chunk));
    transformer.on('end', () => resolve(Buffer.concat(chunks).toString()));
    transformer.on('error', reject);
    transformer.end(input);
  });
}

describe('McpSseTransformer', () => {
  test('transforms tools/list SSE data line', async () => {
    const toolsListMsg = JSON.stringify({
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
    });
    const input = `data: ${toolsListMsg}\n\n`;
    const output = await transformSSE(input);

    const dataMatch = output.match(/^data: (.+)\n/);
    assert.ok(dataMatch, 'output should contain a data line');
    const parsed = JSON.parse(dataMatch[1]);
    assert.strictEqual(parsed.result.tools[0].inputSchema.properties.mode.type, 'string');
  });

  test('passes through tools/call SSE data line unchanged', async () => {
    const msg = {
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'hello' }] }
    };
    const input = `data: ${JSON.stringify(msg)}\n\n`;
    const output = await transformSSE(input);

    const dataMatch = output.match(/^data: (.+)\n/);
    assert.ok(dataMatch);
    assert.deepStrictEqual(JSON.parse(dataMatch[1]), msg);
  });

  test('passes through JSON-RPC error unchanged', async () => {
    const msg = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request' } };
    const input = `data: ${JSON.stringify(msg)}\n\n`;
    const output = await transformSSE(input);

    const dataMatch = output.match(/^data: (.+)\n/);
    assert.ok(dataMatch);
    assert.deepStrictEqual(JSON.parse(dataMatch[1]), msg);
  });

  test('passes through non-data lines', async () => {
    const input = 'event: message\nid: 123\n\n';
    const output = await transformSSE(input);
    assert.strictEqual(output, input);
  });

  test('handles non-JSON data lines', async () => {
    const input = 'data: not-json-at-all\n\n';
    const output = await transformSSE(input);
    assert.strictEqual(output, input);
  });

  test('handles empty data line', async () => {
    const input = 'data:\n\n';
    const output = await transformSSE(input);
    assert.strictEqual(output, input);
  });

  test('rewrites endpoint URI with pathPrefix', async () => {
    const input = 'event: endpoint\ndata: /message?sessionId=abc-123\n\n';
    const output = await transformSSEWithPrefix(input, '/mcp/idea');
    assert.strictEqual(output, 'event: endpoint\ndata: /mcp/idea/message?sessionId=abc-123\n\n');
  });

  test('does not rewrite non-absolute-path data without prefix', async () => {
    const input = 'data: not-json-at-all\n\n';
    const output = await transformSSEWithPrefix(input, '');
    assert.strictEqual(output, input);
  });

  test('does not rewrite absolute URL endpoint', async () => {
    const input = 'data: http://example.com/message\n\n';
    const output = await transformSSEWithPrefix(input, '/mcp/idea');
    assert.strictEqual(output, input);
  });
});

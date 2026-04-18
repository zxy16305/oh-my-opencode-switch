import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTokenUsage, deFormatTokenCompact } from '../../../src/utils/token-parser.js';

describe('parseTokenUsage', () => {
  describe('OpenAI format', () => {
    it('should parse OpenAI response with full usage', () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });
    });

    it('should parse OpenAI response with reasoning and cache tokens', () => {
      const response = {
        usage: {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 350,
          reasoning_tokens: 30,
          prompt_tokens_details: {
            cached_tokens: 50,
          },
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 200,
        output_tokens: 100,
        cache_read: 50,
        cache_write: 0,
        reasoning_tokens: 30,
        total_tokens: 350,
      });
    });

    it('should handle OpenAI response without total_tokens', () => {
      const response = {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150, // calculated from input + output
      });
    });

    it('should parse context cache fields for baidu/deepseek-v3.2 responses', () => {
      const response = {
        model: 'baidu/deepseek-v3.2',
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          total_tokens: 1500,
          prompt_cache_hit_tokens: 900,
          prompt_cache_miss_tokens: 300,
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read: 900,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 1500,
      });
    });

    it('should parse context cache fields for alibaba-coding-plan-cn/qwen3.6-plus responses', () => {
      const response = {
        model: 'alibaba-coding-plan-cn/qwen3.6-plus',
        usage: {
          prompt_tokens: 2200,
          completion_tokens: 180,
          total_tokens: 2380,
          prompt_tokens_details: {
            cached_tokens: 1600,
            cache_creation_input_tokens: 400,
          },
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 2200,
        output_tokens: 180,
        cache_read: 1600,
        cache_write: 400,
        reasoning_tokens: 0,
        total_tokens: 2380,
      });
    });
  });

  describe('Anthropic format', () => {
    it('should parse Anthropic response format', () => {
      const response = {
        usage: {
          input_tokens: 150,
          output_tokens: 75,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 150,
        output_tokens: 75,
        cache_read: 30,
        cache_write: 20,
        reasoning_tokens: 0,
        total_tokens: 225, // input + output
      });
    });

    it('should handle Anthropic response with partial cache data', () => {
      const response = {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 25,
        },
      };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 25,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 150,
      });
    });
  });

  describe('Edge cases', () => {
    it('should return null for response without usage field', () => {
      const response = { id: '123', choices: [] };

      const result = parseTokenUsage(response);

      assert.strictEqual(result, null);
    });

    it('should return null for null response', () => {
      const result = parseTokenUsage(null);

      assert.strictEqual(result, null);
    });

    it('should return null for undefined response', () => {
      const result = parseTokenUsage(undefined);

      assert.strictEqual(result, null);
    });

    it('should handle empty usage object', () => {
      const response = { usage: {} };

      const result = parseTokenUsage(response);

      assert.deepEqual(result, {
        input_tokens: 0,
        output_tokens: 0,
        cache_read: 0,
        cache_write: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
      });
    });

    it('should handle unknown provider format gracefully', () => {
      const response = {
        usage: {
          some_other_field: 100,
        },
      };

      const result = parseTokenUsage(response);

      // Should return null since no known fields are present
      assert.strictEqual(result, null);
    });
  });
});

describe('deFormatTokenCompact', () => {
  it('should parse compact format with k suffix', () => {
    const tokStr = 'tok=i100k/o50k/c20k/r10k/t180k';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 100000,
      output_tokens: 50000,
      cache_read: 20000,
      reasoning_tokens: 10000,
      total_tokens: 180000,
    });
  });

  it('should parse compact format with m suffix', () => {
    const tokStr = 'tok=i1.1m/o500k/c200k/r30k/t1.8m';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 1100000,
      output_tokens: 500000,
      cache_read: 200000,
      reasoning_tokens: 30000,
      total_tokens: 1800000,
    });
  });

  it('should parse compact format with plain numbers', () => {
    const tokStr = 'tok=i100/o50/c0/r0/t150';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 100,
      output_tokens: 50,
      cache_read: 0,
      reasoning_tokens: 0,
      total_tokens: 150,
    });
  });

  it('should handle mixed suffixes', () => {
    const tokStr = 'tok=i1m/o500k/c200/r30/t1500050';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 1000000,
      output_tokens: 500000,
      cache_read: 200,
      reasoning_tokens: 30,
      total_tokens: 1500050,
    });
  });

  it('should handle decimal values with k suffix', () => {
    const tokStr = 'tok=i1.5k/o0.5k/c0.1k/r0/t2k';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 1500,
      output_tokens: 500,
      cache_read: 100,
      reasoning_tokens: 0,
      total_tokens: 2000,
    });
  });

  it('should return null for invalid format', () => {
    const result = deFormatTokenCompact('invalid-string');

    assert.strictEqual(result, null);
  });

  it('should return null for null input', () => {
    const result = deFormatTokenCompact(null);

    assert.strictEqual(result, null);
  });

  it('should return null for undefined input', () => {
    const result = deFormatTokenCompact(undefined);

    assert.strictEqual(result, null);
  });

  it('should handle partial fields', () => {
    const tokStr = 'tok=i100/o50';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 100,
      output_tokens: 50,
      cache_read: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
    });
  });

  it('should handle case-insensitive suffixes', () => {
    const tokStr = 'tok=i100K/o50M/c20k/r10K/t1000500';

    const result = deFormatTokenCompact(tokStr);

    assert.deepEqual(result, {
      input_tokens: 100000,
      output_tokens: 50000000,
      cache_read: 20000,
      reasoning_tokens: 10000,
      total_tokens: 1000500,
    });
  });
});

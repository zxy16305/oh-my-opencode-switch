import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLogEntry, formatTokenCompact } from '../../../src/utils/access-log.js';

describe('formatTokenCompact', () => {
  it('should format complete token data with all fields', () => {
    const parsed = {
      input_tokens: 100,
      output_tokens: 50,
      cache_read: 20,
      cache_write: 10,
      reasoning_tokens: 5,
      total_tokens: 185,
    };

    const result = formatTokenCompact(parsed);

    assert.strictEqual(result, 'tok=i100/o50/c30/r5/t185');
  });

  it('should format large numbers with k suffix (>= 1,000)', () => {
    const parsed = {
      input_tokens: 5000,
      output_tokens: 3000,
      cache_read: 2000,
      cache_write: 1000,
      reasoning_tokens: 500,
      total_tokens: 11500,
    };

    const result = formatTokenCompact(parsed);

    assert.strictEqual(result, 'tok=i5k/o3k/c3k/r500/t11.5k');
  });

  it('should format very large numbers with m suffix (>= 1,000,000)', () => {
    const parsed = {
      input_tokens: 1100000,
      output_tokens: 500000,
      cache_read: 200000,
      cache_write: 100000,
      reasoning_tokens: 50000,
      total_tokens: 1950000,
    };

    const result = formatTokenCompact(parsed);

    assert.strictEqual(result, 'tok=i1.1m/o500k/c300k/r50k/t1.95m');
  });

  it('should format numbers exactly at boundaries', () => {
    // Exactly 1000 should be k suffix
    const parsed1 = {
      input_tokens: 1000,
      output_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      reasoning_tokens: 0,
      total_tokens: 1000,
    };
    assert.strictEqual(formatTokenCompact(parsed1), 'tok=i1k/o0/c0/r0/t1k');

    // Exactly 1000000 should be m suffix
    const parsed2 = {
      input_tokens: 1000000,
      output_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      reasoning_tokens: 0,
      total_tokens: 1000000,
    };
    assert.strictEqual(formatTokenCompact(parsed2), 'tok=i1m/o0/c0/r0/t1m');
  });

  it('should handle small numbers without suffix (< 1,000)', () => {
    const parsed = {
      input_tokens: 150,
      output_tokens: 75,
      cache_read: 25,
      cache_write: 10,
      reasoning_tokens: 5,
      total_tokens: 265,
    };

    const result = formatTokenCompact(parsed);

    assert.strictEqual(result, 'tok=i150/o75/c35/r5/t265');
  });

  it('should handle zero values', () => {
    const parsed = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read: 0,
      cache_write: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
    };

    const result = formatTokenCompact(parsed);

    assert.strictEqual(result, 'tok=i0/o0/c0/r0/t0');
  });

  it('should handle missing optional fields', () => {
    const parsed = {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    };

    const result = formatTokenCompact(parsed);

    // Missing cache_read, cache_write, reasoning_tokens default to 0
    assert.strictEqual(result, 'tok=i100/o50/c0/r0/t150');
  });

  it('should handle decimal k/m values correctly', () => {
    const parsed = {
      input_tokens: 1500,
      output_tokens: 1500000,
      cache_read: 0,
      cache_write: 0,
      reasoning_tokens: 0,
      total_tokens: 1501500,
    };

    const result = formatTokenCompact(parsed);

    // 1500 -> 1.5k, 1500000 -> 1.5m, 1501500 -> 1.5015m (should round appropriately)
    assert.ok(result.startsWith('tok=i1.5k/o1.5m/c0/r0/t'));
  });
});

describe('formatLogEntry with tokens', () => {
  const baseEntry = {
    timestamp: '2026-04-09T12:00:00.000',
    sessionId: 'session-123',
    provider: 'openai',
    model: 'gpt-4',
    virtualModel: 'gpt-4',
    status: 200,
    ttfb: 100,
    duration: 500,
  };

  it('should append token field at the end when tokens object is provided', () => {
    const entry = {
      ...baseEntry,
      tokens: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read: 20,
        cache_write: 10,
        reasoning_tokens: 5,
        total_tokens: 185,
      },
    };

    const logLine = formatLogEntry(entry);

    assert.ok(logLine.includes('tok=i100/o50/c30/r5/t185'), 'should include token field');
    // Token field should be at the end (before newline)
    const trimmed = logLine.trim();
    assert.ok(trimmed.endsWith('tok=i100/o50/c30/r5/t185'), 'token field should be at the end');
  });

  it('should append pre-formatted token string when tokens is a string', () => {
    const entry = {
      ...baseEntry,
      tokens: 'tok=i200/o100/c50/r10/t360',
    };

    const logLine = formatLogEntry(entry);

    assert.ok(logLine.includes('tok=i200/o100/c50/r10/t360'), 'should include token string');
    const trimmed = logLine.trim();
    assert.ok(trimmed.endsWith('tok=i200/o100/c50/r10/t360'), 'token field should be at the end');
  });

  it('should not include token field when tokens is not provided (backward compatible)', () => {
    const entry = {
      ...baseEntry,
    };

    const logLine = formatLogEntry(entry);

    assert.ok(!logLine.includes('tok='), 'should NOT include token field');
    assert.ok(!logLine.includes('input_tokens'), 'should NOT include old verbose format');
  });

  it('should not include token field when tokens is null', () => {
    const entry = {
      ...baseEntry,
      tokens: null,
    };

    const logLine = formatLogEntry(entry);

    assert.ok(!logLine.includes('tok='), 'should NOT include token field when tokens is null');
  });

  it('should not include token field when tokens is undefined', () => {
    const entry = {
      ...baseEntry,
      tokens: undefined,
    };

    const logLine = formatLogEntry(entry);

    assert.ok(!logLine.includes('tok='), 'should NOT include token field when tokens is undefined');
  });

  it('should preserve all existing fields order when adding token field', () => {
    const entry = {
      ...baseEntry,
      agent: 'build',
      category: 'code-generation',
      tokens: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read: 200,
        cache_write: 100,
        reasoning_tokens: 50,
        total_tokens: 1850,
      },
    };

    const logLine = formatLogEntry(entry);

    // Check existing fields are present
    assert.ok(logLine.includes('[2026-04-09T12:00:00.000]'), 'should include timestamp');
    assert.ok(logLine.includes('session=session-123'), 'should include session');
    assert.ok(logLine.includes('agent=build'), 'should include agent');
    assert.ok(logLine.includes('category=code-generation'), 'should include category');
    assert.ok(logLine.includes('provider=openai'), 'should include provider');
    assert.ok(logLine.includes('model=gpt-4'), 'should include model');
    assert.ok(logLine.includes('virtualModel=gpt-4'), 'should include virtualModel');
    assert.ok(logLine.includes('status=200'), 'should include status');
    assert.ok(logLine.includes('ttfb=100ms'), 'should include ttfb');
    assert.ok(logLine.includes('duration=500ms'), 'should include duration');
    assert.ok(logLine.includes('tok=i1k/o500/c300/r50/t1.85k'), 'should include token field');

    // Token field should be at the end
    const trimmed = logLine.trim();
    assert.ok(trimmed.endsWith('tok=i1k/o500/c300/r50/t1.85k'), 'token field should be at the end');
  });

  it('should format large token values with suffixes in log entry', () => {
    const entry = {
      ...baseEntry,
      tokens: {
        input_tokens: 2500000,
        output_tokens: 1500000,
        cache_read: 500000,
        cache_write: 300000,
        reasoning_tokens: 100000,
        total_tokens: 4900000,
      },
    };

    const logLine = formatLogEntry(entry);

    assert.ok(logLine.includes('tok=i2.5m/o1.5m/c800k/r100k/t4.9m'), 'should format large numbers');
  });
});
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByCategory } from '../../../src/analytics/analyzer/category-stats.js';

describe('aggregateByCategory', () => {
  it('should return empty array for empty entries', () => {
    const result = aggregateByCategory([], []);
    assert.deepEqual(result, []);
  });

  it('should aggregate stats by category', () => {
    const entries = [
      { category: 'coding', status: 200, duration: 100, model: 'gpt-4' },
      { category: 'coding', status: 200, duration: 200, model: 'gpt-4' },
      { category: 'analysis', status: 200, duration: 150, model: 'claude-3' },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result.length, 2);
    assert.equal(result[0].category, 'coding');
    assert.equal(result[0].callCount, 2);
    assert.equal(result[0].avgDuration, 150);
    assert.equal(result[1].category, 'analysis');
    assert.equal(result[1].callCount, 1);
  });

  it('should handle null category as unknown', () => {
    const entries = [
      { category: null, status: 200, duration: 100, model: 'gpt-4' },
      { category: null, status: 200, duration: 200, model: 'gpt-4' },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].category, 'unknown');
    assert.equal(result[0].callCount, 2);
  });

  it('should handle undefined category as unknown', () => {
    const entries = [
      { category: undefined, status: 200, duration: 100, model: 'gpt-4' },
      { status: 200, duration: 200, model: 'gpt-4' },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].category, 'unknown');
    assert.equal(result[0].callCount, 2);
  });

  it('should sort by call count descending', () => {
    const entries = [
      { category: 'analysis', status: 200 },
      { category: 'coding', status: 200 },
      { category: 'coding', status: 200 },
      { category: 'coding', status: 200 },
      { category: 'analysis', status: 200 },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].category, 'coding');
    assert.equal(result[0].callCount, 3);
    assert.equal(result[1].category, 'analysis');
    assert.equal(result[1].callCount, 2);
  });

  it('should calculate success rate correctly', () => {
    const entries = [
      { category: 'coding', status: 200 },
      { category: 'coding', status: 200 },
      { category: 'coding', status: 500 },
      { category: 'coding', status: 400 },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].category, 'coding');
    assert.equal(result[0].callCount, 4);
    assert.equal(result[0].successRate, 50);
  });

  it('should track models used', () => {
    const entries = [
      { category: 'coding', status: 200, model: 'gpt-4' },
      { category: 'coding', status: 200, model: 'gpt-4' },
      { category: 'coding', status: 200, model: 'claude-3' },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].category, 'coding');
    assert.ok(result[0].modelUsed.includes('gpt-4'));
    assert.ok(result[0].modelUsed.includes('claude-3'));
  });

  it('should handle missing fields gracefully', () => {
    const entries = [
      { category: 'coding', status: 200 },
      { category: 'coding', status: 200, duration: null },
      { category: 'coding', status: 200, model: null },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result[0].callCount, 3);
    assert.equal(result[0].avgDuration, undefined);
    assert.equal(result[0].modelUsed, undefined);
  });

  it('should handle mixed null and valid categories', () => {
    const entries = [
      { category: 'coding', status: 200 },
      { category: null, status: 200 },
      { category: 'analysis', status: 200 },
      { category: null, status: 200 },
    ];

    const result = aggregateByCategory(entries, []);

    assert.equal(result.length, 3);
    const categories = result.map((r) => r.category);
    assert.ok(categories.includes('coding'));
    assert.ok(categories.includes('analysis'));
    assert.ok(categories.includes('unknown'));
  });
});

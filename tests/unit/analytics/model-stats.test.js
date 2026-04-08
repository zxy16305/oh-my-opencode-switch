import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByModel,
  aggregateByProvider,
} from '../../../src/analytics/analyzer/model-stats.js';

describe('aggregateByModel', () => {
  it('should return empty array for empty data', () => {
    const result = aggregateByModel([]);
    assert.deepEqual(result, []);
  });

  it('should aggregate by provider|model key', () => {
    const entries = [
      { provider: 'ali', model: 'glm-4', status: 200, duration: 1000, ttfb: 100 },
      { provider: 'ali', model: 'glm-4', status: 200, duration: 1500, ttfb: 150 },
      { provider: 'baidu', model: 'glm-4', status: 200, duration: 2000, ttfb: 200 },
    ];

    const result = aggregateByModel(entries);

    assert.equal(result.length, 2);
    assert.equal(result[0].provider, 'ali');
    assert.equal(result[0].model, 'glm-4');
    assert.equal(result[0].requests, 2);
    assert.equal(result[0].success, 2);
    assert.equal(result[0].failure, 0);
    assert.equal(result[0].successRate, '100.00%');
    assert.equal(result[0].avgDuration, 1250);
    assert.equal(result[0].avgTtfb, 125);
  });

  it('should count success and failure correctly', () => {
    const entries = [
      { provider: 'ali', model: 'glm-4', status: 200, duration: 1000, ttfb: 100 },
      { provider: 'ali', model: 'glm-4', status: 400, duration: 500, ttfb: 50 },
      { provider: 'ali', model: 'glm-4', status: 500, duration: 500, ttfb: 50 },
    ];

    const result = aggregateByModel(entries);

    assert.equal(result[0].requests, 3);
    assert.equal(result[0].success, 1);
    assert.equal(result[0].failure, 2);
    assert.equal(result[0].successRate, '33.33%');
  });

  it('should sort results by request count descending', () => {
    const entries = [
      { provider: 'baidu', model: 'model-b', status: 200, duration: 0, ttfb: 0 },
      { provider: 'ali', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
      { provider: 'ali', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
      { provider: 'ali', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
    ];

    const result = aggregateByModel(entries);

    assert.equal(result[0].model, 'model-a');
    assert.equal(result[0].requests, 3);
    assert.equal(result[1].model, 'model-b');
    assert.equal(result[1].requests, 1);
  });

  it('should calculate percentile values correctly', () => {
    const entries = [];
    for (let i = 1; i <= 100; i++) {
      entries.push({
        provider: 'ali',
        model: 'glm-4',
        status: 200,
        duration: i * 10,
        ttfb: i,
      });
    }

    const result = aggregateByModel(entries);

    assert.equal(result[0].requests, 100);
    assert.equal(result[0].avgDuration, 505);
    assert.ok(result[0].durationP95 > 0);
    assert.ok(result[0].durationP99 > 0);
    assert.ok(result[0].durationP99 >= result[0].durationP95);
    assert.ok(result[0].ttfbP99 >= result[0].ttfbP95);
  });

  it('should handle missing duration and ttfb fields', () => {
    const entries = [{ provider: 'ali', model: 'glm-4', status: 200 }];

    const result = aggregateByModel(entries);

    assert.equal(result[0].requests, 1);
    assert.equal(result[0].avgDuration, 0);
    assert.equal(result[0].avgTtfb, 0);
  });
});

describe('aggregateByProvider', () => {
  it('should return empty array for empty data', () => {
    const result = aggregateByProvider([]);
    assert.deepEqual(result, []);
  });

  it('should aggregate by provider only', () => {
    const entries = [
      { provider: 'ali', model: 'glm-4', status: 200, duration: 1000, ttfb: 100 },
      { provider: 'ali', model: 'glm-4.7', status: 200, duration: 1500, ttfb: 150 },
      { provider: 'baidu', model: 'qwen-plus', status: 200, duration: 2000, ttfb: 200 },
    ];

    const result = aggregateByProvider(entries);

    assert.equal(result.length, 2);
    assert.equal(result[0].provider, 'ali');
    assert.equal(result[0].requests, 2);
    assert.equal(result[1].provider, 'baidu');
    assert.equal(result[1].requests, 1);
  });

  it('should handle unknown provider', () => {
    const entries = [{ provider: null, model: 'model-a', status: 200, duration: 0, ttfb: 0 }];

    const result = aggregateByProvider(entries);

    assert.equal(result[0].provider, 'unknown');
    assert.equal(result[0].requests, 1);
  });

  it('should sort by request count descending', () => {
    const entries = [
      { provider: 'baidu', model: 'm1', status: 200, duration: 0, ttfb: 0 },
      { provider: 'ali', model: 'm2', status: 200, duration: 0, ttfb: 0 },
      { provider: 'ali', model: 'm3', status: 200, duration: 0, ttfb: 0 },
    ];

    const result = aggregateByProvider(entries);

    assert.equal(result[0].provider, 'ali');
    assert.equal(result[0].requests, 2);
    assert.equal(result[1].provider, 'baidu');
    assert.equal(result[1].requests, 1);
  });
});

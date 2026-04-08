import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSummary } from '../../../src/analytics/analyzer/summary-stats.js';

describe('aggregateSummary', () => {
  it('should return correct summary for empty data', () => {
    const result = aggregateSummary([], [], []);

    assert.equal(result.totalRequests, 0);
    assert.equal(result.totalSessions, 0);
    assert.equal(result.totalMessages, 0);
    assert.equal(result.totalInputTokens, 0);
    assert.equal(result.totalOutputTokens, 0);
    assert.equal(result.totalTokens, 0);
    assert.equal(result.topModel, 'N/A');
    assert.equal(result.topAgent, 'N/A');
    assert.equal(result.successRate, '0.00%');
    assert.equal(result.successCount, 0);
    assert.equal(result.failureCount, 0);
    assert.equal(result.avgDuration, 0);
    assert.equal(result.avgTtfb, 0);
  });

  it('should calculate correct totals for simple data', () => {
    const accesslogEntries = [
      { sessionId: 'session1', model: 'model-a', status: 200, duration: 1000, ttfb: 100 },
      { sessionId: 'session1', model: 'model-a', status: 200, duration: 1500, ttfb: 150 },
      { sessionId: 'session2', model: 'model-b', status: 500, duration: 2000, ttfb: 200 },
    ];

    const sessions = [{ id: 'session1' }, { id: 'session2' }];

    const messages = [
      { agent: 'agent-1', tokens: { input: 100, output: 200 } },
      { agent: 'agent-1', tokens: { input: 150, output: 250 } },
      { agent: 'agent-2', tokens: { input: 50, output: 100 } },
    ];

    const result = aggregateSummary(accesslogEntries, sessions, messages);

    assert.equal(result.totalRequests, 3);
    assert.equal(result.totalSessions, 2);
    assert.equal(result.totalMessages, 3);
    assert.equal(result.totalInputTokens, 300);
    assert.equal(result.totalOutputTokens, 550);
    assert.equal(result.totalTokens, 850);
    assert.equal(result.topModel, 'model-a');
    assert.equal(result.topAgent, 'agent-1');
    assert.equal(result.successCount, 2);
    assert.equal(result.failureCount, 1);
    assert.equal(result.successRate, '66.67%');
    assert.equal(result.avgDuration, 1500);
    assert.equal(result.avgTtfb, 150);
  });

  it('should handle null sessionId correctly', () => {
    const accesslogEntries = [
      { sessionId: null, model: 'model-a', status: 200, duration: 1000, ttfb: 100 },
      { sessionId: 'session1', model: 'model-a', status: 200, duration: 1500, ttfb: 150 },
    ];

    const sessions = [{ id: 'session1' }];
    const messages = [];

    const result = aggregateSummary(accesslogEntries, sessions, messages);

    assert.equal(result.totalSessions, 1);
  });

  it('should handle missing tokens in messages', () => {
    const accesslogEntries = [];
    const sessions = [];
    const messages = [
      { agent: 'agent-1' },
      { agent: 'agent-2', tokens: {} },
      { agent: 'agent-1', tokens: { input: 100 } },
    ];

    const result = aggregateSummary(accesslogEntries, sessions, messages);

    assert.equal(result.totalInputTokens, 100);
    assert.equal(result.totalOutputTokens, 0);
  });

  it('should identify top model and agent correctly', () => {
    const accesslogEntries = [
      { sessionId: 's1', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
      { sessionId: 's1', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
      { sessionId: 's1', model: 'model-a', status: 200, duration: 0, ttfb: 0 },
      { sessionId: 's1', model: 'model-b', status: 200, duration: 0, ttfb: 0 },
      { sessionId: 's1', model: 'model-b', status: 200, duration: 0, ttfb: 0 },
    ];

    const sessions = [{ id: 's1' }];
    const messages = [
      { agent: 'agent-x', tokens: {} },
      { agent: 'agent-x', tokens: {} },
      { agent: 'agent-y', tokens: {} },
      { agent: 'agent-y', tokens: {} },
      { agent: 'agent-y', tokens: {} },
      { agent: 'agent-y', tokens: {} },
    ];

    const result = aggregateSummary(accesslogEntries, sessions, messages);

    assert.equal(result.topModel, 'model-a');
    assert.equal(result.topAgent, 'agent-y');
  });

  it('should handle unknown agent and model', () => {
    const accesslogEntries = [{ sessionId: 's1', model: null, status: 200, duration: 0, ttfb: 0 }];

    const sessions = [{ id: 's1' }];
    const messages = [{ agent: null, tokens: {} }];

    const result = aggregateSummary(accesslogEntries, sessions, messages);

    assert.equal(result.topModel, 'unknown');
    assert.equal(result.topAgent, 'unknown');
  });
});

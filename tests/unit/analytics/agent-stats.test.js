import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByAgent,
  getAgentDistribution,
} from '../../../src/analytics/analyzer/agent-stats.js';

describe('aggregateByAgent', () => {
  it('should return empty array for empty messages', () => {
    const result = aggregateByAgent([]);
    assert.deepEqual(result, []);
  });

  it('should aggregate call counts by agent', () => {
    const messages = [
      { agent: 'build', tokens: { input: 100, output: 200 } },
      { agent: 'build', tokens: { input: 150, output: 250 } },
      { agent: 'oracle', tokens: { input: 50, output: 100 } },
    ];

    const result = aggregateByAgent(messages);

    assert.equal(result.length, 2);
    assert.equal(result[0].agent, 'build');
    assert.equal(result[0].callCount, 2);
    assert.equal(result[0].inputTokens, 250);
    assert.equal(result[0].outputTokens, 450);
    assert.equal(result[1].agent, 'oracle');
    assert.equal(result[1].callCount, 1);
    assert.equal(result[1].inputTokens, 50);
    assert.equal(result[1].outputTokens, 100);
  });

  it('should sort by call count descending', () => {
    const messages = [
      { agent: 'oracle', tokens: {} },
      { agent: 'build', tokens: {} },
      { agent: 'build', tokens: {} },
      { agent: 'build', tokens: {} },
      { agent: 'oracle', tokens: {} },
    ];

    const result = aggregateByAgent(messages);

    assert.equal(result[0].agent, 'build');
    assert.equal(result[0].callCount, 3);
    assert.equal(result[1].agent, 'oracle');
    assert.equal(result[1].callCount, 2);
  });

  it('should handle null agent as unknown', () => {
    const messages = [
      { agent: null, tokens: {} },
      { agent: null, tokens: {} },
    ];

    const result = aggregateByAgent(messages);

    assert.equal(result[0].agent, 'unknown');
    assert.equal(result[0].callCount, 2);
  });

  it('should handle missing tokens gracefully', () => {
    const messages = [
      { agent: 'build' },
      { agent: 'build', tokens: null },
      { agent: 'build', tokens: { input: 100, output: 200 } },
    ];

    const result = aggregateByAgent(messages);

    assert.equal(result[0].callCount, 3);
    assert.equal(result[0].inputTokens, 100);
    assert.equal(result[0].outputTokens, 200);
  });

  it('should initialize percentage to 0', () => {
    const messages = [{ agent: 'build', tokens: {} }];

    const result = aggregateByAgent(messages);

    assert.equal(result[0].percentage, 0);
  });
});

describe('getAgentDistribution', () => {
  it('should return empty array for empty messages', () => {
    const result = getAgentDistribution([]);
    assert.deepEqual(result, []);
  });

  it('should calculate percentage distribution', () => {
    const messages = [
      { agent: 'build', tokens: {} },
      { agent: 'build', tokens: {} },
      { agent: 'oracle', tokens: {} },
      { agent: 'oracle', tokens: {} },
      { agent: 'oracle', tokens: {} },
      { agent: 'oracle', tokens: {} },
      { agent: 'librarian', tokens: {} },
      { agent: 'librarian', tokens: {} },
    ];

    const result = getAgentDistribution(messages);

    assert.equal(result.length, 3);
    assert.equal(result[0].agent, 'oracle');
    assert.equal(result[0].percentage, 50);
    assert.equal(result[1].agent, 'build');
    assert.equal(result[1].percentage, 25);
    assert.equal(result[2].agent, 'librarian');
    assert.equal(result[2].percentage, 25);
  });

  it('should handle single agent with 100%', () => {
    const messages = [
      { agent: 'build', tokens: {} },
      { agent: 'build', tokens: {} },
    ];

    const result = getAgentDistribution(messages);

    assert.equal(result[0].percentage, 100);
  });

  it('should sum percentages to 100', () => {
    const messages = [
      { agent: 'a', tokens: {} },
      { agent: 'b', tokens: {} },
      { agent: 'c', tokens: {} },
    ];

    const result = getAgentDistribution(messages);

    const totalPct = result.reduce((sum, r) => sum + r.percentage, 0);
    assert.ok(Math.abs(totalPct - 100) < 0.01);
  });

  it('should handle large number of agents', () => {
    const messages = [];
    for (let i = 1; i <= 10; i++) {
      messages.push({ agent: `agent-${i}`, tokens: {} });
    }

    const result = getAgentDistribution(messages);

    assert.equal(result.length, 10);
    const totalPct = result.reduce((sum, r) => sum + r.percentage, 0);
    assert.ok(Math.abs(totalPct - 100) < 0.01);
  });
});

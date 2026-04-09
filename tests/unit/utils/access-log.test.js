import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLogEntry } from '../../../src/utils/access-log.js';

describe('formatLogEntry - conditional agent/category printing', () => {
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

  it('should print both agent and category fields when both exist', () => {
    const entry = {
      ...baseEntry,
      agent: 'build',
      category: 'code-generation',
    };

    const logLine = formatLogEntry(entry);

    assert.ok(logLine.includes('agent=build'), 'should include agent field');
    assert.ok(logLine.includes('category=code-generation'), 'should include category field');
    assert.ok(!logLine.includes('agent=unknown'), 'should not have unknown agent');
    assert.ok(!logLine.includes('category=unknown'), 'should not have unknown category');
  });

  it('should print only agent field when only agent exists', () => {
    const entry = {
      ...baseEntry,
      agent: 'oracle',
      category: null,
    };

    const logLine = formatLogEntry(entry);

    assert.ok(logLine.includes('agent=oracle'), 'should include agent field');
    assert.ok(!logLine.includes('category='), 'should NOT include category field');
    assert.ok(!logLine.includes('unknown'), 'should not have unknown values');
  });

  it('should print only category field when only category exists', () => {
    const entry = {
      ...baseEntry,
      agent: null,
      category: 'research',
    };

    const logLine = formatLogEntry(entry);

    assert.ok(!logLine.includes('agent='), 'should NOT include agent field');
    assert.ok(logLine.includes('category=research'), 'should include category field');
    assert.ok(!logLine.includes('unknown'), 'should not have unknown values');
  });

  it('should print neither agent nor category fields when both are missing', () => {
    const entry = {
      ...baseEntry,
      agent: null,
      category: null,
    };

    const logLine = formatLogEntry(entry);

    assert.ok(!logLine.includes('agent='), 'should NOT include agent field');
    assert.ok(!logLine.includes('category='), 'should NOT include category field');
    assert.ok(!logLine.includes('unknown'), 'should not have unknown values');
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLogLine, calculatePercentile, generateStats } from '../../src/utils/stats.js';
import { getLogPath } from '../../src/utils/access-log.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

describe('parseLogLine', () => {
  it('should parse log line with ttfb field', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=50ms duration=1000ms';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.provider, 'ali');
    assert.strictEqual(result.model, 'glm-4');
    assert.strictEqual(result.virtualModel, 'lb');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.ttfb, 50, 'should extract ttfb value');
    assert.strictEqual(result.duration, 1000);
  });

  it('should parse log line without ttfb (backward compatible)', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 duration=1000ms';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.provider, 'ali');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.duration, 1000);
    assert.strictEqual(result.ttfb, 0);
  });

  it('should parse log line with ttfb=0', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=sess1 provider=baidu model=qwen-3 virtualModel=rr status=200 ttfb=0ms duration=500ms';
    const result = parseLogLine(line);

    assert.ok(result);
    assert.strictEqual(result.ttfb, 0);
    assert.strictEqual(result.duration, 500);
  });

  it('should parse log line with large ttfb value', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=15000ms duration=30000ms';
    const result = parseLogLine(line);

    assert.ok(result);
    assert.strictEqual(result.ttfb, 15000);
    assert.strictEqual(result.duration, 30000);
  });

  it('should parse log line with session id and ttfb', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=abc-123 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=120ms duration=800ms';
    const result = parseLogLine(line);

    assert.ok(result);
    assert.strictEqual(result.sessionId, 'abc-123');
    assert.strictEqual(result.ttfb, 120);
  });

  it('should return null for invalid log line', () => {
    assert.strictEqual(parseLogLine('not a log line'), null);
    assert.strictEqual(parseLogLine(''), null);
  });

  it('should parse log line with error status and ttfb', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=500 ttfb=200ms duration=5000ms';
    const result = parseLogLine(line);

    assert.ok(result);
    assert.strictEqual(result.status, 500);
    assert.strictEqual(result.ttfb, 200);
    assert.strictEqual(result.duration, 5000);
  });
});

describe('calculatePercentile', () => {
  it('should calculate p95 correctly', () => {
    const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.ok(Math.abs(calculatePercentile(arr, 95) - 95.5) < 0.001);
  });

  it('should calculate p99 correctly', () => {
    const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.strictEqual(calculatePercentile(arr, 99), 99.1);
  });

  it('should calculate p50 (median)', () => {
    const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.strictEqual(calculatePercentile(arr, 50), 55);
  });

  it('should return 0 for empty array', () => {
    assert.strictEqual(calculatePercentile([], 95), 0);
  });

  it('should return the only element for single-element array', () => {
    assert.strictEqual(calculatePercentile([42], 95), 42);
    assert.strictEqual(calculatePercentile([42], 50), 42);
    assert.strictEqual(calculatePercentile([42], 99), 42);
  });

  it('should handle two-element array', () => {
    assert.strictEqual(calculatePercentile([10, 20], 50), 15);
    assert.strictEqual(calculatePercentile([10, 20], 0), 10);
    assert.strictEqual(calculatePercentile([10, 20], 100), 20);
  });

  it('should work with ttfb-like values', () => {
    const ttfbValues = [20, 25, 30, 35, 40, 50, 60, 80, 100, 200];
    const p95 = calculatePercentile(ttfbValues, 95);
    const p99 = calculatePercentile(ttfbValues, 99);

    assert.ok(p95 > 100, `p95 (${p95}) should be > 100`);
    assert.ok(p99 > p95, `p99 (${p99}) should be > p95 (${p95})`);
  });
});

describe('generateStats – ttfb fields', () => {
  let testHome;
  let logPath;

  function logLine(ts, provider, model, virtualModel, status, ttfb, duration) {
    return `[${ts}] session=- provider=${provider} model=${model} virtualModel=${virtualModel} status=${status} ttfb=${ttfb}ms duration=${duration}ms`;
  }

  before(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
    logPath = getLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  });

  after(async () => {
    await cleanupTestHome(testHome);
  });

  it('should include ttfb stats (avgTtfb, ttfbP95, ttfbP99) in output', async () => {
    const lines = [
      logLine('2024-06-01T10:00:00.000', 'ali', 'glm-4', 'lb', 200, 30, 500),
      logLine('2024-06-01T10:00:01.000', 'ali', 'glm-4', 'lb', 200, 50, 600),
      logLine('2024-06-01T10:00:02.000', 'ali', 'glm-4', 'lb', 200, 80, 700),
      logLine('2024-06-01T10:00:03.000', 'ali', 'glm-4', 'lb', 200, 120, 800),
      logLine('2024-06-01T10:00:04.000', 'ali', 'glm-4', 'lb', 200, 200, 900),
    ];

    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');

    const startTime = new Date('2024-06-01T09:00:00.000');
    const endTime = new Date('2024-06-01T11:00:00.000');
    const results = await generateStats({ startTime, endTime });

    assert.ok(results.length >= 1, 'should produce at least one stats group');

    const aliGroup = results.find((r) => r.provider === 'ali' && r.model === 'glm-4');
    assert.ok(aliGroup, 'should have stats for ali/glm-4');

    assert.ok(
      'avgTtfb' in aliGroup || 'ttfbP95' in aliGroup,
      'output should include ttfb stats fields (avgTtfb, ttfbP95, ttfbP99)'
    );

    assert.strictEqual(aliGroup.requests, 5);
    assert.strictEqual(aliGroup.success, 5);
    assert.strictEqual(aliGroup.failure, 0);
  });

  it('should calculate correct ttfb avg/p95/p99 values', async () => {
    const ttfbValues = [20, 30, 40, 50, 60, 70, 80, 90, 100, 500];
    const lines = ttfbValues.map((ttfb, i) => {
      const ts = `2024-06-01T12:00:${String(i).padStart(2, '0')}.000`;
      return logLine(ts, 'baidu', 'qwen-3', 'rr', 200, ttfb, ttfb * 10);
    });

    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');

    const startTime = new Date('2024-06-01T11:00:00.000');
    const endTime = new Date('2024-06-01T13:00:00.000');
    const results = await generateStats({ startTime, endTime });

    const group = results.find((r) => r.provider === 'baidu' && r.model === 'qwen-3');
    assert.ok(group, 'should have stats for baidu/qwen-3');

    // sum=1040, avg=104
    assert.strictEqual(group.avgTtfb, 104, 'avgTtfb should be 104');

    const expectedP95 = Math.round(calculatePercentile(ttfbValues, 95));
    assert.strictEqual(group.ttfbP95, expectedP95, `ttfbP95 should be ${expectedP95}`);

    const expectedP99 = Math.round(calculatePercentile(ttfbValues, 99));
    assert.strictEqual(group.ttfbP99, expectedP99, `ttfbP99 should be ${expectedP99}`);
  });

  it('should handle mixed logs (some with ttfb, some without)', async () => {
    const oldFormatLine =
      '[2024-06-01T14:00:01.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 duration=600ms';

    const lines = [
      logLine('2024-06-01T14:00:00.000', 'ali', 'glm-4', 'lb', 200, 50, 500),
      oldFormatLine,
      logLine('2024-06-01T14:00:02.000', 'ali', 'glm-4', 'lb', 200, 100, 700),
    ];

    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');

    const startTime = new Date('2024-06-01T13:00:00.000');
    const endTime = new Date('2024-06-01T15:00:00.000');
    const results = await generateStats({ startTime, endTime });

    const group = results.find((r) => r.provider === 'ali' && r.model === 'glm-4');
    assert.ok(group);
    assert.strictEqual(group.requests, 3, 'should count all 3 requests');

    if ('avgTtfb' in group) {
      assert.ok(typeof group.avgTtfb === 'number', 'avgTtfb should be a number');
    }
  });

  it('should return empty array when no log file exists', async () => {
    try {
      fs.unlinkSync(logPath);
    } catch {
      // already gone
    }

    const results = await generateStats();
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('should handle logs without ttfb field (backward compatible, avgTtfb=0)', async () => {
    // Old format logs - no ttfb field at all
    const lines = [
      '[2024-06-01T16:00:00.000] session=- provider=tencent model=hunyuan virtualModel=lb status=200 duration=500ms',
      '[2024-06-01T16:00:01.000] session=- provider=tencent model=hunyuan virtualModel=lb status=200 duration=600ms',
      '[2024-06-01T16:00:02.000] session=- provider=tencent model=hunyuan virtualModel=lb status=200 duration=700ms',
    ];

    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');

    const startTime = new Date('2024-06-01T15:00:00.000');
    const endTime = new Date('2024-06-01T17:00:00.000');
    const results = await generateStats({ startTime, endTime });

    const group = results.find((r) => r.provider === 'tencent' && r.model === 'hunyuan');
    assert.ok(group, 'should have stats for tencent/hunyuan');
    assert.strictEqual(group.requests, 3, 'should count all 3 requests');
    assert.strictEqual(group.success, 3);
    assert.strictEqual(group.failure, 0);

    // When no ttfb data exists, avgTtfb should be 0
    assert.strictEqual(group.avgTtfb, 0, 'avgTtfb should be 0 for old format logs');
    assert.strictEqual(group.ttfbP95, 0, 'ttfbP95 should be 0 for old format logs');
    assert.strictEqual(group.ttfbP99, 0, 'ttfbP99 should be 0 for old format logs');
  });
});

describe('parseLogLine – token fields', () => {
  it('should parse log line with compact token field', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=50ms duration=1000ms tok=i100/o50/c30/r0/t150';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.tokens.input, 100);
    assert.strictEqual(result.tokens.output, 50);
    assert.strictEqual(result.tokens.cache, 30);
    assert.strictEqual(result.tokens.reasoning, 0);
    assert.strictEqual(result.tokens.total, 150);
  });

  it('should parse log line with k/m suffixes', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=50ms duration=1000ms tok=i1.1m/o500k/c200k/r30k/t1.95m';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.tokens.input, 1100000);
    assert.strictEqual(result.tokens.output, 500000);
    assert.strictEqual(result.tokens.cache, 200000);
    assert.strictEqual(result.tokens.reasoning, 30000);
    assert.strictEqual(result.tokens.total, 1950000);
  });

  it('should parse old log line without token field (backward compatible)', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=50ms duration=1000ms';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.tokens.input, 0);
    assert.strictEqual(result.tokens.output, 0);
    assert.strictEqual(result.tokens.cache, 0);
    assert.strictEqual(result.tokens.reasoning, 0);
    assert.strictEqual(result.tokens.total, 0);
  });

  it('should parse log line with zero token values', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=50ms duration=1000ms tok=i0/o0/c0/r0/t0';
    const result = parseLogLine(line);

    assert.ok(result, 'should parse the line');
    assert.strictEqual(result.tokens.input, 0);
    assert.strictEqual(result.tokens.output, 0);
    assert.strictEqual(result.tokens.cache, 0);
    assert.strictEqual(result.tokens.reasoning, 0);
    assert.strictEqual(result.tokens.total, 0);
  });

  it('should parse log line with token field and session id', () => {
    const line =
      '[2024-01-01T00:00:00.000] session=abc-123 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=120ms duration=800ms tok=i500/o250/c100/r50/t900';
    const result = parseLogLine(line);

    assert.ok(result);
    assert.strictEqual(result.sessionId, 'abc-123');
    assert.strictEqual(result.tokens.input, 500);
    assert.strictEqual(result.tokens.output, 250);
    assert.strictEqual(result.tokens.cache, 100);
    assert.strictEqual(result.tokens.reasoning, 50);
    assert.strictEqual(result.tokens.total, 900);
  });
});

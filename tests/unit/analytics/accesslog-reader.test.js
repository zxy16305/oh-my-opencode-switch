import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readAccesslog } from '../../../src/analytics/reader/accesslog-reader.js';

let testHome;
let originalTestHome;

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oos-analytics-test-'));
  originalTestHome = process.env.OOS_TEST_HOME;
  process.env.OOS_TEST_HOME = testHome;

  const logDir = path.join(testHome, '.config', 'opencode', '.oos', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
});

afterEach(() => {
  if (originalTestHome !== undefined) {
    process.env.OOS_TEST_HOME = originalTestHome;
  } else {
    delete process.env.OOS_TEST_HOME;
  }

  fs.rmSync(testHome, { recursive: true, force: true });
});

function getTestLogPath() {
  return path.join(testHome, '.config', 'opencode', '.oos', 'logs', 'proxy-access.log');
}

function writeTestLog(lines) {
  fs.writeFileSync(getTestLogPath(), lines.join('\n') + '\n', 'utf8');
}

describe('readAccesslog', () => {
  it('should return empty array when log file does not exist', async () => {
    const result = await readAccesslog();
    assert.deepEqual(result, []);
  });

  it('should return empty array for empty log file', async () => {
    fs.writeFileSync(getTestLogPath(), '', 'utf8');
    const result = await readAccesslog();
    assert.deepEqual(result, []);
  });

  it('should parse valid log entries', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
      '[2026-04-08T10:01:00.000] session=sess2 provider=baidu model=qwen-plus virtualModel=lb-mixed status=200 ttfb=150ms duration=1500ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 2);
    assert.equal(result[0].sessionId, 'sess1');
    assert.equal(result[0].provider, 'ali');
    assert.equal(result[0].model, 'glm-4');
    assert.equal(result[0].virtualModel, 'lb-mixed');
    assert.equal(result[0].status, 200);
    assert.equal(result[0].ttfb, 100);
    assert.equal(result[0].duration, 1000);
    assert.equal(result[1].sessionId, 'sess2');
    assert.equal(result[1].provider, 'baidu');
  });

  it('should parse entries with category field', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 category=chat provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'chat');
  });

  it('should parse entries with agent field', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 agent=explore category=quick provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].agent, 'explore');
    assert.equal(result[0].category, 'quick');
  });

  it('should parse entries with agent but no category', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 agent=build provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].agent, 'build');
    assert.equal(result[0].category, null);
  });

  it('should handle null agent when not present', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 category=chat provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].agent, null);
    assert.equal(result[0].category, 'chat');
  });

  it('should parse entries with all agent types', async () => {
    const agentTypes = ['build', 'oracle', 'librarian', 'explore', 'metis', 'momus', 'hephaestus'];

    const logLines = agentTypes.map(
      (agent, i) =>
        `[2026-04-08T10:0${i}:00.000] session=sess${i} agent=${agent} provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms`
    );

    writeTestLog(logLines);

    const result = await readAccesslog();

    assert.equal(result.length, agentTypes.length);
    agentTypes.forEach((agent, i) => {
      assert.equal(result[i].agent, agent, `Agent should be ${agent}`);
    });
  });

  it('should skip invalid log lines', async () => {
    writeTestLog([
      'this is not a valid log line',
      '[2026-04-08T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb-mixed status=200 ttfb=100ms duration=1000ms',
      'another invalid line',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, 'sess1');
  });

  it('should filter by startTime', async () => {
    writeTestLog([
      '[2026-04-07T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-08T10:00:00.000] session=sess2 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-08T11:00:00.000] session=sess3 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog({
      startTime: new Date('2026-04-08T09:00:00.000'),
    });

    assert.equal(result.length, 2);
    assert.equal(result[0].sessionId, 'sess2');
    assert.equal(result[1].sessionId, 'sess3');
  });

  it('should filter by endTime', async () => {
    writeTestLog([
      '[2026-04-07T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-08T10:00:00.000] session=sess2 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-09T10:00:00.000] session=sess3 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog({
      endTime: new Date('2026-04-08T12:00:00.000'),
    });

    assert.equal(result.length, 2);
    assert.equal(result[0].sessionId, 'sess1');
    assert.equal(result[1].sessionId, 'sess2');
  });

  it('should filter by both startTime and endTime', async () => {
    writeTestLog([
      '[2026-04-07T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-08T10:00:00.000] session=sess2 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
      '[2026-04-09T10:00:00.000] session=sess3 provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog({
      startTime: new Date('2026-04-08T00:00:00.000'),
      endTime: new Date('2026-04-08T23:59:59.999'),
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, 'sess2');
  });

  it('should convert dash sessionId to null', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=- provider=ali model=glm-4 virtualModel=lb status=200 ttfb=100ms duration=1000ms',
    ]);

    const result = await readAccesslog();

    assert.equal(result.length, 1);
    assert.equal(result[0].sessionId, null);
  });

  it('should handle entries without ttfb and duration', async () => {
    writeTestLog([
      '[2026-04-08T10:00:00.000] session=sess1 provider=ali model=glm-4 virtualModel=lb status=200',
    ]);

    const result = await readAccesslog();

    assert.equal(result[0].ttfb, 0);
    assert.equal(result[0].duration, 0);
  });
});

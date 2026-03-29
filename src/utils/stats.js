import fs from 'node:fs';
import readline from 'node:readline';
import { getLogPath } from './access-log.js';

const TIME_RANGE_PATTERN = /^(\d+)(h|d)$/;

export function parseTimeRange(last) {
  const match = TIME_RANGE_PATTERN.exec(last);
  if (!match) {
    throw new Error(
      `Invalid time range format: "${last}". Expected format like "1h", "24h", "7d", "30d".`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const endTime = new Date();
  const startTime = new Date();

  if (unit === 'h') {
    startTime.setHours(startTime.getHours() - value);
  } else if (unit === 'd') {
    startTime.setDate(startTime.getDate() - value);
  }

  return { startTime, endTime };
}

const LOG_LINE_PATTERN =
  /^\[([^\]]+)\]\s+session=(\S+)\s+provider=(\S+)\s+model=(\S+)\s+virtualModel=(\S+)\s+status=(\d+)(?:\s+duration=(\d+)ms)?/;

export function parseLogLine(line) {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const [, timestamp, sessionId, provider, model, virtualModel, status, duration] = match;

  return {
    timestamp: new Date(timestamp),
    sessionId: sessionId === '-' ? null : sessionId,
    provider,
    model,
    virtualModel,
    status: parseInt(status, 10),
    duration: duration ? parseInt(duration, 10) : 0,
  };
}

export function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) {
    return 0;
  }

  if (sortedArray.length === 1) {
    return sortedArray[0];
  }

  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) {
    return sortedArray[lower];
  }

  return sortedArray[lower] + fraction * (sortedArray[upper] - sortedArray[lower]);
}

export async function generateStats(options = {}) {
  const { startTime, endTime } = options;
  const logPath = getLogPath();

  const groups = new Map();

  try {
    await fs.promises.access(logPath, fs.constants.R_OK);
  } catch {
    return [];
  }

  const stream = fs.createReadStream(logPath, 'utf8');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const entry = parseLogLine(line);
    if (!entry) {
      continue;
    }

    if (startTime && entry.timestamp < startTime) {
      continue;
    }
    if (endTime && entry.timestamp > endTime) {
      continue;
    }

    const key = `${entry.provider}|${entry.model}`;
    if (!groups.has(key)) {
      groups.set(key, {
        provider: entry.provider,
        model: entry.model,
        requests: 0,
        success: 0,
        failure: 0,
        durations: [],
      });
    }

    const group = groups.get(key);
    group.requests++;
    group.durations.push(entry.duration);

    if (entry.status >= 200 && entry.status < 400) {
      group.success++;
    } else if (entry.status >= 400) {
      group.failure++;
    }
  }

  const results = [];
  for (const group of groups.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b);
    const totalDuration = sorted.reduce((sum, d) => sum + d, 0);

    results.push({
      provider: group.provider,
      model: group.model,
      requests: group.requests,
      success: group.success,
      failure: group.failure,
      successRate:
        group.requests > 0 ? ((group.success / group.requests) * 100).toFixed(2) + '%' : '0.00%',
      avgDuration: group.requests > 0 ? Math.round(totalDuration / group.requests) : 0,
      p95: Math.round(calculatePercentile(sorted, 95)),
      p99: Math.round(calculatePercentile(sorted, 99)),
    });
  }

  results.sort((a, b) => {
    if (b.requests !== a.requests) {
      return b.requests - a.requests;
    }
    return a.provider.localeCompare(b.provider);
  });

  return results;
}

import fs from 'node:fs';
import readline from 'node:readline';
import { getLogPath } from '../../utils/access-log.js';

/**
 * Regex pattern to parse accesslog lines.
 * Format: [timestamp] session=xxx category=xxx provider=xxx model=xxx virtualModel=xxx status=xxx ttfb=xxxms duration=xxxms
 * Category is optional for backward compatibility with old logs.
 */
const LOG_LINE_PATTERN =
  /^\[([^\]]+)\]\s+session=(\S+)(?:\s+category=(\S+))?\s+provider=(\S+)\s+model=(\S+)\s+virtualModel=(\S+)\s+status=(\d+)(?:\s+ttfb=(\d+)ms)?(?:\s+duration=(\d+)ms)?/;

function parseLogLine(line) {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const [, timestamp, sessionId, category, provider, model, virtualModel, status, ttfb, duration] =
    match;

  return {
    timestamp: new Date(timestamp),
    sessionId: sessionId === '-' ? null : sessionId,
    category: category || 'unknown',
    provider,
    model,
    virtualModel,
    status: parseInt(status, 10),
    ttfb: ttfb ? parseInt(ttfb, 10) : 0,
    duration: duration ? parseInt(duration, 10) : 0,
  };
}

function matchesFilters(entry, filters) {
  const { startTime, endTime, sessionId, category, provider } = filters;

  if (startTime && entry.timestamp < startTime) {
    return false;
  }
  if (endTime && entry.timestamp > endTime) {
    return false;
  }
  if (sessionId && entry.sessionId !== sessionId) {
    return false;
  }
  if (category && entry.category !== category) {
    return false;
  }
  if (provider && entry.provider !== provider) {
    return false;
  }

  return true;
}

/**
 * Read and parse proxy accesslog with streaming support.
 * @param {Object} options - Filter options
 * @param {Date} [options.startTime] - Filter logs after this time
 * @param {Date} [options.endTime] - Filter logs before this time
 * @param {string} [options.sessionId] - Filter by session ID
 * @param {string} [options.category] - Filter by category
 * @param {string} [options.provider] - Filter by provider
 * @param {number} [options.limit] - Maximum number of entries to return
 * @param {string} [options.logPath] - Custom log file path (for testing)
 * @returns {Promise<Array<Object>>} Array of parsed log entries
 */
export async function readAccesslog(options = {}) {
  const { startTime, endTime, sessionId, category, provider, limit, logPath } = options;

  const filePath = logPath || getLogPath();
  const entries = [];
  const filters = { startTime, endTime, sessionId, category, provider };

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      resolve([]);
      return;
    }

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let limitReached = false;

    rl.on('line', (line) => {
      if (limitReached) {
        return;
      }

      if (!line.trim()) {
        return;
      }

      const entry = parseLogLine(line);
      if (!entry) {
        return;
      }

      if (matchesFilters(entry, filters)) {
        entries.push(entry);

        if (limit && entries.length >= limit) {
          limitReached = true;
          rl.close();
          fileStream.destroy();
        }
      }
    });

    rl.on('close', () => {
      resolve(entries);
    });

    rl.on('error', (err) => {
      reject(err);
    });

    fileStream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Count log entries matching filters without loading all into memory.
 * @param {Object} options - Filter options (same as readAccesslog)
 * @returns {Promise<number>} Count of matching entries
 */
export async function countAccesslog(options = {}) {
  const { startTime, endTime, sessionId, category, provider, logPath } = options;

  const filePath = logPath || getLogPath();
  const filters = { startTime, endTime, sessionId, category, provider };
  let count = 0;

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      resolve(0);
      return;
    }

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      const entry = parseLogLine(line);
      if (entry && matchesFilters(entry, filters)) {
        count++;
      }
    });

    rl.on('close', () => {
      resolve(count);
    });

    rl.on('error', (err) => {
      reject(err);
    });

    fileStream.on('error', (err) => {
      reject(err);
    });
  });
}

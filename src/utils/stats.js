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
  /^\[([^\]]+)\]\s+session=(\S+)\s+provider=(\S+)\s+model=(\S+)\s+virtualModel=(\S+)\s+status=(\d+)(?:\s+ttfb=(\d+)ms)?(?:\s+duration=(\d+)ms)?/;

export function parseLogLine(line) {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const [, timestamp, sessionId, provider, model, virtualModel, status, ttfb, duration] = match;

  return {
    timestamp: new Date(timestamp),
    sessionId: sessionId === '-' ? null : sessionId,
    provider,
    model,
    virtualModel,
    status: parseInt(status, 10),
    ttfb: ttfb ? parseInt(ttfb, 10) : 0,
    duration: duration ? parseInt(duration, 10) : 0,
  };
}

/**
 * Extract timestamp from a log line without full parsing
 * @param {string} line - Log line
 * @returns {Date|null} - Parsed timestamp or null
 */
function extractTimestamp(line) {
  const match = /^\[([^\]]+)\]/.exec(line);
  if (!match) return null;
  return new Date(match[1]);
}

/**
 * Read a complete line starting from offset
 * Handles the case where offset might be in the middle of a line
 * @param {number} fd - File descriptor
 * @param {number} offset - Starting offset
 * @param {number} fileSize - Total file size
 * @returns {{line: string, nextOffset: number}} - Line content and offset for next line
 */
function readLineAtOffset(fd, offset, fileSize) {
  const CHUNK_SIZE = 4096;
  let buffer = Buffer.alloc(CHUNK_SIZE);
  let lineStart = offset;
  let content = '';

  // If not at start of file, find the start of current line (search backward for \n)
  if (offset > 0) {
    let searchOffset = offset - 1;
    const searchBuffer = Buffer.alloc(1);

    while (searchOffset >= 0) {
      fs.readSync(fd, searchBuffer, 0, 1, searchOffset);
      if (searchBuffer[0] === 0x0a) {
        // newline found, line starts after this
        lineStart = searchOffset + 1;
        break;
      }
      searchOffset--;
      if (searchOffset < 0) {
        lineStart = 0;
      }
    }
  }

  // Read forward until we find end of line or EOF
  let readOffset = lineStart;
  let foundNewline = false;

  while (readOffset < fileSize && !foundNewline) {
    const toRead = Math.min(CHUNK_SIZE, fileSize - readOffset);
    const bytesRead = fs.readSync(fd, buffer, 0, toRead, readOffset);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0x0a) {
        // newline found
        content += buffer.toString('utf8', 0, i);
        foundNewline = true;
        break;
      }
    }

    if (!foundNewline) {
      content += buffer.toString('utf8', 0, bytesRead);
    }

    readOffset += bytesRead;
  }

  return {
    line: content.trim(),
    nextOffset: readOffset,
  };
}

/**
 * Binary search to find the offset where startTime begins
 * Assumes log lines are sorted by timestamp (oldest first)
 * @param {number} fd - File descriptor
 * @param {number} fileSize - Total file size
 * @param {Date} startTime - Target start time
 * @returns {number} - File offset where startTime entries begin
 */
function findStartOffset(fd, fileSize, startTime) {
  if (fileSize === 0) return 0;

  let low = 0;
  let high = fileSize;
  let result = 0;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const { line } = readLineAtOffset(fd, mid, fileSize);

    if (!line) {
      high = mid;
      continue;
    }

    const timestamp = extractTimestamp(line);
    if (!timestamp) {
      // Invalid line, search forward
      low = mid + 1;
      continue;
    }

    if (timestamp < startTime) {
      // This line is before startTime, search right half
      low = mid + 1;
    } else {
      // This line is at or after startTime, record and search left half
      result = mid;
      high = mid;
    }
  }

  return result;
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

  const stats = await fs.promises.stat(logPath);
  const fileSize = stats.size;

  // Open file for binary search
  const fd = fs.openSync(logPath, 'r');

  try {
    // Determine starting offset
    let startOffset = 0;

    if (startTime) {
      // Use binary search to find starting position
      startOffset = findStartOffset(fd, fileSize, startTime);
    }

    // Close the file used for binary search
    fs.closeSync(fd);

    // Use readline to stream from the start offset
    const stream = fs.createReadStream(logPath, {
      encoding: 'utf8',
      start: startOffset,
    });

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const entry = parseLogLine(line);
      if (!entry) {
        continue;
      }

      // Skip entries before startTime (binary search may be slightly off)
      if (startTime && entry.timestamp < startTime) {
        continue;
      }

      // Stop if past endTime
      if (endTime && entry.timestamp > endTime) {
        break;
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
          ttfbs: [],
        });
      }

      const group = groups.get(key);
      group.requests++;
      group.ttfbs.push(entry.ttfb);
      group.durations.push(entry.duration);

      if (entry.status >= 200 && entry.status < 400) {
        group.success++;
      } else if (entry.status >= 400) {
        group.failure++;
      }
    }
  } catch (error) {
    // Ensure fd is closed on error
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
    throw error;
  }

  const results = [];
  for (const group of groups.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b);
    const totalDuration = sorted.reduce((sum, d) => sum + d, 0);

    const ttfbSorted = [...group.ttfbs].sort((a, b) => a - b);
    const ttfbTotal = ttfbSorted.reduce((sum, t) => sum + t, 0);

    results.push({
      provider: group.provider,
      model: group.model,
      requests: group.requests,
      success: group.success,
      failure: group.failure,
      successRate:
        group.requests > 0 ? ((group.success / group.requests) * 100).toFixed(2) + '%' : '0.00%',
      avgTtfb: group.requests > 0 ? Math.round(ttfbTotal / group.requests) : 0,
      ttfbP95: Math.round(calculatePercentile(ttfbSorted, 95)),
      ttfbP99: Math.round(calculatePercentile(ttfbSorted, 99)),
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

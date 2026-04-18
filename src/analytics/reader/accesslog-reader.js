import fs from 'node:fs';
import readline from 'node:readline';
import { getLogPath } from '../../utils/access-log.js';

/**
 * Accesslog entry format:
 * { timestamp, sessionId, category, provider, model, virtualModel, status, ttfb, duration, tokens }
 */

function desuffix(valStr) {
  const lower = valStr.toLowerCase();
  if (lower.endsWith('k')) {
    return parseFloat(lower) * 1000;
  }
  if (lower.endsWith('m')) {
    return parseFloat(lower) * 1000000;
  }
  return parseFloat(lower) || 0;
}

const LOG_LINE_PATTERN =
  /^\[([^\]]+)\]\s+session=(\S+)(?:\s+agent=(\S+))?(?:\s+category=(\S+))?\s+provider=(\S+)\s+model=(\S+)\s+virtualModel=(\S+)\s+status=(\d+)(?:\s+ttfb=(\d+)ms)?(?:\s+duration=(\d+)ms)?(?:\s+tok=i([0-9.]+[kKmM]?)\/o([0-9.]+[kKmM]?)\/c([0-9.]+[kKmM]?)\/r([0-9.]+[kKmM]?)\/t([0-9.]+[kKmM]?))?/;

/**
 * Parse a single log line into an entry object
 * @param {string} line - Log line
 * @returns {object|null} - Parsed entry or null
 */
function parseLogLine(line) {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const [
    ,
    timestamp,
    sessionId,
    agent,
    category,
    provider,
    model,
    virtualModel,
    status,
    ttfb,
    duration,
    tokenInput,
    tokenOutput,
    tokenCache,
    tokenReasoning,
    tokenTotal,
  ] = match;

  return {
    timestamp: new Date(timestamp),
    sessionId: sessionId === '-' ? null : sessionId,
    agent: agent || null,
    provider,
    model,
    virtualModel,
    status: parseInt(status, 10),
    ttfb: ttfb ? parseInt(ttfb, 10) : 0,
    duration: duration ? parseInt(duration, 10) : 0,
    category: category || null,
    tokens: {
      input: tokenInput ? desuffix(tokenInput) : 0,
      output: tokenOutput ? desuffix(tokenOutput) : 0,
      cache: tokenCache ? desuffix(tokenCache) : 0,
      reasoning: tokenReasoning ? desuffix(tokenReasoning) : 0,
      total: tokenTotal ? desuffix(tokenTotal) : 0,
    },
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

  // If not at start of file, find the start of current line
  if (offset > 0) {
    let searchOffset = offset - 1;
    const searchBuffer = Buffer.alloc(1);

    while (searchOffset >= 0) {
      fs.readSync(fd, searchBuffer, 0, 1, searchOffset);
      if (searchBuffer[0] === 0x0a) {
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
      low = mid + 1;
      continue;
    }

    if (timestamp < startTime) {
      low = mid + 1;
    } else {
      result = mid;
      high = mid;
    }
  }

  return result;
}

/**
 * Read accesslog entries with optional time filtering
 * @param {object} options - Options
 * @param {Date} [options.startTime] - Start time filter
 * @param {Date} [options.endTime] - End time filter
 * @returns {Promise<Array>} - Array of accesslog entries
 */
export async function readAccesslog(options = {}) {
  const { startTime, endTime } = options;
  const logPath = getLogPath();

  const entries = [];

  try {
    await fs.promises.access(logPath, fs.constants.R_OK);
  } catch {
    return entries;
  }

  const stats = await fs.promises.stat(logPath);
  const fileSize = stats.size;

  if (fileSize === 0) {
    return entries;
  }

  const fd = fs.openSync(logPath, 'r');

  try {
    let startOffset = 0;

    if (startTime) {
      startOffset = findStartOffset(fd, fileSize, startTime);
    }

    fs.closeSync(fd);

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

      // Skip entries before startTime
      if (startTime && entry.timestamp < startTime) {
        continue;
      }

      // Stop if past endTime
      if (endTime && entry.timestamp > endTime) {
        break;
      }

      entries.push(entry);
    }
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
    throw error;
  }

  return entries;
}

/**
 * Get unique session IDs from accesslog within time range
 * @param {object} options - Options
 * @param {Date} [options.startTime] - Start time filter
 * @param {Date} [options.endTime] - End time filter
 * @returns {Promise<Array<string>>} - Array of unique session IDs
 */
export async function getUniqueSessionIds(options = {}) {
  const entries = await readAccesslog(options);
  const sessionIds = new Set();

  for (const entry of entries) {
    if (entry.sessionId) {
      sessionIds.add(entry.sessionId);
    }
  }

  return Array.from(sessionIds);
}

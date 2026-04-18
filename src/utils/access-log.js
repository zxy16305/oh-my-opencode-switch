import fs from 'node:fs/promises';
import path from 'node:path';
import { logBuffer } from './log-buffer.js';
import { getOosDir } from './paths.js';

const getLogDir = () => path.join(getOosDir(), 'logs');
const getLogFilePath = () => path.join(getLogDir(), 'proxy-access.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_QUEUE_SIZE = 100;

let logInitialized = false;
const logCallbacks = [];

/**
 * Bounded write queue: max MAX_QUEUE_SIZE pending entries, drop-oldest when full.
 * Writes are sequential to prevent file interleaving and control I/O pressure.
 */
const writeQueue = (() => {
  const entries = [];
  let processing = false;
  let drainTimer = null;

  function enqueue(entry) {
    if (entries.length >= MAX_QUEUE_SIZE) {
      entries.shift();
    }
    entries.push(entry);
    if (drainTimer === null) {
      drainTimer = setImmediate(processQueue);
    }
  }

  async function processQueue() {
    drainTimer = null;
    if (processing) return;

    processing = true;

    while (entries.length > 0) {
      const entry = entries.shift();
      try {
        const dir = path.dirname(entry.logPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(entry.logPath, entry.logLine, 'utf8');
      } catch {
        // Silently ignore write errors (fire-and-forget semantics)
      }
    }

    processing = false;
  }

  return {
    enqueue,
    get size() {
      return entries.length;
    },
    get isProcessing() {
      return processing;
    },
    reset() {
      entries.length = 0;
      processing = false;
      if (drainTimer !== null) {
        clearImmediate(drainTimer);
        drainTimer = null;
      }
    },
    flush() {
      return new Promise((resolve) => {
        if (entries.length === 0 && !processing) {
          resolve();
          return;
        }
        const check = () => {
          if (entries.length === 0 && !processing) {
            resolve();
          } else {
            setTimeout(check, 20);
          }
        };
        check();
      });
    },
  };
})();

async function ensureLogDir() {
  if (!logInitialized) {
    await fs.mkdir(getLogDir(), { recursive: true });
    logInitialized = true;
  }
}

function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function formatLogEntry(entry) {
  const parts = [
    `[${entry.timestamp}]`,
    entry.sessionId ? `session=${entry.sessionId}` : 'session=-',
    entry.agent ? `agent=${entry.agent.replace(/[() ]/g, '_')}` : '',
    entry.category ? `category=${entry.category}` : '',
    `provider=${entry.provider}`,
    `model=${entry.model}`,
    `virtualModel=${entry.virtualModel}`,
    `status=${entry.status}`,
    entry.ttfb ? `ttfb=${entry.ttfb}ms` : '',
    entry.duration ? `duration=${entry.duration}ms` : '',
    entry.error ? `error=${entry.error}` : '',
  ];
  if (entry.tokens) {
    const tokenStr = typeof entry.tokens === 'string' ? entry.tokens : formatTokenCompact(entry.tokens);
    parts.push(tokenStr);
  }
  return parts.filter(Boolean).join(' ') + '\n';
}

export function formatTokenCompact(parsed) {
  const input = parsed.input_tokens ?? 0;
  const output = parsed.output_tokens ?? 0;
  const cacheRead = parsed.cache_read ?? 0;
  const cacheWrite = parsed.cache_write ?? 0;
  const reasoning = parsed.reasoning_tokens ?? 0;
  const total = parsed.total_tokens ?? 0;

  const cache = cacheRead + cacheWrite;

  const formatNum = (n) => {
    if (n >= 1000000) {
      const mVal = n / 1000000;
      const str = mVal.toString();
      return str.includes('.') && str.split('.')[1].length > 2
        ? `${mVal.toFixed(2)}m`
        : `${str}m`;
    }
    if (n >= 1000) {
      const kVal = n / 1000;
      const str = kVal.toString();
      return str.includes('.') && str.split('.')[1].length > 2
        ? `${kVal.toFixed(2)}k`
        : `${str}k`;
    }
    return String(n);
  };

  return `tok=i${formatNum(input)}/o${formatNum(output)}/c${formatNum(cache)}/r${formatNum(reasoning)}/t${formatNum(total)}`;
}

async function rotateLogIfNeeded() {
  try {
    const LOG_FILE = getLogFilePath();
    const stats = await fs.stat(LOG_FILE).catch(() => null);
    if (stats && stats.size > MAX_LOG_SIZE) {
      const backup = LOG_FILE + '.' + new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(LOG_FILE, backup);
    }
  } catch {
    // ignore
  }
}

export function onLogAdded(callback) {
  logCallbacks.push(callback);

  return () => {
    removeLogAdded(callback);
  };
}

export function removeLogAdded(callback) {
  const index = logCallbacks.indexOf(callback);
  if (index !== -1) {
    logCallbacks.splice(index, 1);
  }
}

export function logAccess(entry) {
  return ensureLogDir()
    .then(() => {
      rotateLogIfNeeded().catch(() => {
        /* intentionally silent: log rotation failure is non-critical */
      });
      const logPath = getLogFilePath();
      const logEntry = {
        timestamp: formatTimestamp(),
        ...entry,
      };
      const logLine = formatLogEntry(logEntry);

      logBuffer.add(logEntry);

      logCallbacks.forEach((callback) => {
        try {
          callback(logEntry);
        } catch {
          // ignore
        }
      });

      writeQueue.enqueue({ logPath, logLine });
    })
    .catch(() => {
      /* intentionally silent: best-effort log write, failures don't affect proxy */
    });
}

export function getQueueSize() {
  return writeQueue.size;
}

export function resetWriteQueue() {
  writeQueue.reset();
}

export function resetLogState() {
  logInitialized = false;
}

export async function flushLogs() {
  return writeQueue.flush();
}

export function getLogPath() {
  return getLogFilePath();
}

export async function readLogs(lines = 100) {
  try {
    const content = await fs.readFile(getLogFilePath(), 'utf8');
    const allLines = content.trim().split('\n').filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

export async function clearLogs() {
  try {
    await fs.unlink(getLogFilePath());
  } catch {
    // ignore
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { logBuffer } from './log-buffer.js';
import { getOosDir } from './paths.js';

const getLogDir = () => path.join(getOosDir(), 'logs');
const getLogFilePath = () => path.join(getLogDir(), 'proxy-access.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let logInitialized = false;
const logCallbacks = [];

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

function formatLogEntry(entry) {
  // Sanitize agent for log parsing: replace spaces and parens with underscores
  const safeAgent = entry.agent ? entry.agent.replace(/[() ]/g, '_') : 'unknown';
  const parts = [
    `[${entry.timestamp}]`,
    entry.sessionId ? `session=${entry.sessionId}` : 'session=-',
    `agent=${safeAgent}`,
    `category=${entry.category || 'unknown'}`,
    `provider=${entry.provider}`,
    `model=${entry.model}`,
    `virtualModel=${entry.virtualModel}`,
    `status=${entry.status}`,
    entry.ttfb ? `ttfb=${entry.ttfb}ms` : '',
    entry.duration ? `duration=${entry.duration}ms` : '',
    entry.error ? `error=${entry.error}` : '',
  ];
  return parts.filter(Boolean).join(' ') + '\n';
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
}

export async function logAccess(entry) {
  await ensureLogDir();
  await rotateLogIfNeeded();

  const logEntry = {
    timestamp: formatTimestamp(),
    ...entry,
  };
  const logLine = formatLogEntry(logEntry);

  await fs.appendFile(getLogFilePath(), logLine, 'utf8');

  // Add to in-memory buffer for SSE streaming
  logBuffer.add(logEntry);

  logCallbacks.forEach((callback) => {
    try {
      callback(logEntry);
    } catch {
      // ignore
    }
  });
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

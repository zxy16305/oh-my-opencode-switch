import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logBuffer } from './log-buffer.js';

const LOG_DIR = path.join(os.homedir(), '.config', 'opencode', '.oos', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'proxy-access.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let logInitialized = false;
const logCallbacks = [];

async function ensureLogDir() {
  if (!logInitialized) {
    await fs.mkdir(LOG_DIR, { recursive: true });
    logInitialized = true;
  }
}

function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatLogEntry(entry) {
  const parts = [
    `[${entry.timestamp}]`,
    entry.sessionId ? `session=${entry.sessionId}` : 'session=-',
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

  await fs.appendFile(LOG_FILE, logLine, 'utf8');

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
  return LOG_FILE;
}

export async function readLogs(lines = 100) {
  try {
    const content = await fs.readFile(LOG_FILE, 'utf8');
    const allLines = content.trim().split('\n').filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

export async function clearLogs() {
  try {
    await fs.unlink(LOG_FILE);
  } catch {
    // ignore
  }
}

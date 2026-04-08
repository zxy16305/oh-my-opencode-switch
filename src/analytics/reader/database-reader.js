import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Get the default OpenCode database path
 */
export function getDatabasePath() {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

function parseMessageData(rawData) {
  try {
    const parsed = JSON.parse(rawData);
    const tokens = parsed.tokens || {};
    const cache = tokens.cache || {};

    return {
      role: parsed.role || 'unknown',
      modelID: parsed.modelID,
      providerID: parsed.providerID,
      agent: parsed.agent,
      tokens: {
        input: tokens.input || 0,
        output: tokens.output || 0,
        reasoning: tokens.reasoning || 0,
        cache: {
          read: cache.read || 0,
          write: cache.write || 0,
        },
      },
      cost: parsed.cost,
      finish: parsed.finish,
    };
  } catch {
    return {
      role: 'unknown',
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    };
  }
}

/**
 * Calculate success rate from messages
 * Success = messages with finish='stop' or 'end_turn'
 */
export function calculateSuccessRate(messages) {
  if (!messages || messages.length === 0) {
    return 0;
  }

  const successCount = messages.filter((msg) => {
    const finish = msg.data?.finish;
    return finish === 'stop' || finish === 'end_turn';
  }).length;

  return successCount / messages.length;
}

/**
 * Get session by ID with duration calculation
 */
export function getSessionById(sessionId, customPath = null) {
  const dbPath = customPath || getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');

    const stmt = db.prepare(`
      SELECT id, project_id, parent_id, title, directory, time_created, time_updated
      FROM session
      WHERE id = ?
    `);

    const row = stmt.get(sessionId);

    db.close();

    if (!row) {
      return null;
    }

    const timeCreated = row.time_created;
    const timeUpdated = row.time_updated || timeCreated;
    const durationMs = timeUpdated - timeCreated;
    const durationSeconds = Math.floor(durationMs / 1000);

    return {
      id: row.id,
      projectId: row.project_id,
      parentId: row.parent_id,
      title: row.title,
      directory: row.directory,
      timeCreated: timeCreated,
      timeUpdated: timeUpdated,
      durationSeconds,
    };
  } catch (error) {
    if (
      error.code === 'SQLITE_BUSY' ||
      error.message?.includes('locked') ||
      error.message?.includes('database is locked')
    ) {
      console.warn('Database is locked - OpenCode may be running');
      return null;
    }

    console.error('Error reading session:', error.message);
    return null;
  }
}

/**
 * Get all messages for a session with agent and token data
 */
export function getSessionMessages(sessionId, customPath = null) {
  const dbPath = customPath || getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');

    const stmt = db.prepare(`
      SELECT id, session_id, time_created, data
      FROM message
      WHERE session_id = ?
      ORDER BY time_created ASC
    `);

    const rows = stmt.all(sessionId);

    db.close();

    if (!rows || rows.length === 0) {
      return [];
    }

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timeCreated: row.time_created,
      data: parseMessageData(row.data),
    }));
  } catch (error) {
    if (
      error.code === 'SQLITE_BUSY' ||
      error.message?.includes('locked') ||
      error.message?.includes('database is locked')
    ) {
      console.warn('Database is locked - OpenCode may be running');
      return null;
    }

    console.error('Error reading messages:', error.message);
    return null;
  }
}

/**
 * Get complete session data with messages and analytics
 */
export function getSessionWithAnalytics(sessionId, customPath = null) {
  const session = getSessionById(sessionId, customPath);

  if (!session) {
    return null;
  }

  const messages = getSessionMessages(sessionId, customPath);

  if (messages === null) {
    return null;
  }

  const successRate = calculateSuccessRate(messages);

  const totalTokens = messages.reduce(
    (acc, msg) => {
      const tokens = msg.data?.tokens || {};
      return {
        input: acc.input + (tokens.input || 0),
        output: acc.output + (tokens.output || 0),
        reasoning: acc.reasoning + (tokens.reasoning || 0),
        cache: {
          read: acc.cache.read + (tokens.cache?.read || 0),
          write: acc.cache.write + (tokens.cache?.write || 0),
        },
      };
    },
    {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    }
  );

  const agents = messages
    .map((msg) => msg.data?.agent)
    .filter((agent) => agent)
    .filter((agent, index, arr) => arr.indexOf(agent) === index);

  return {
    session,
    messages,
    analytics: {
      successRate,
      messageCount: messages.length,
      totalTokens,
      agents,
    },
  };
}

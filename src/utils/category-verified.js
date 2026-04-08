import path from 'path';
import os from 'os';
import fs from 'fs';

const VERIFIED_PATH = path.join(
  os.homedir(),
  '.config',
  'opencode',
  '.oos',
  'category-verified.ndjson'
);

/**
 * 追加校验记录到 ndjson 文件
 */
export function appendVerifiedRecord(record) {
  const line =
    JSON.stringify({
      sessionId: record.sessionId,
      category: record.category,
      agent: record.agent,
      parentSessionId: record.parentSessionId,
      callID: record.callID,
      timestamp: Date.now(),
    }) + '\n';

  const dir = path.dirname(VERIFIED_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(VERIFIED_PATH, line);
}

/**
 * 读取所有校验记录
 */
export function readVerifiedRecords() {
  if (!fs.existsSync(VERIFIED_PATH)) {
    return [];
  }

  const content = fs.readFileSync(VERIFIED_PATH, 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * 获取 sessionId → {category, agent} 映射
 */
export function getVerifiedMap() {
  const records = readVerifiedRecords();
  const map = new Map();

  records.forEach((r) => {
    map.set(r.sessionId, { category: r.category, agent: r.agent });
  });

  return map;
}

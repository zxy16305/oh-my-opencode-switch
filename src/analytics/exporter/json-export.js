import fs from 'node:fs/promises';
import path from 'node:path';

export async function exportToJson(data, outputPath) {
  const jsonString = JSON.stringify(data, null, 2);

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(outputPath, jsonString, 'utf8');

  const stats = await fs.stat(outputPath);

  return {
    filePath: outputPath,
    recordCount: Array.isArray(data) ? data.length : 1,
    fileSize: stats.size,
  };
}

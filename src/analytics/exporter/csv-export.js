import fs from 'node:fs/promises';
import path from 'node:path';

function flattenObject(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}_${key}` : key;

    if (value === null || value === undefined) {
      result[newKey] = '';
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

function escapeCsvValue(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportToCsv(data, outputPath) {
  if (!data || data.length === 0) {
    throw new Error('Data array cannot be empty');
  }

  const flattenedData = data.map((record) => flattenObject(record));

  const headers = Object.keys(flattenedData[0]);
  const headerRow = headers.map(escapeCsvValue).join(',');

  const dataRows = flattenedData.map((record) => {
    return headers.map((header) => escapeCsvValue(record[header])).join(',');
  });

  const csvContent = [headerRow, ...dataRows].join('\n');

  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(outputPath, csvContent, 'utf8');

  const stats = await fs.stat(outputPath);

  return {
    filePath: outputPath,
    recordCount: data.length,
    fileSize: stats.size,
  };
}

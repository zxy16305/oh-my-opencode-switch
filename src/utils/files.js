import fs from 'fs/promises';
import path from 'path';
import { writeFile } from 'atomically';
import JSON5 from 'json5';
import commentJson from 'comment-json';
import { FileSystemError } from './errors.js';

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    throw new FileSystemError(`Failed to create directory: ${dirPath} - ${error.message}`);
  }
}

/**
 * Read JSON file with relaxed parsing (JSON5)
 * Supports: comments, trailing commas, single quotes, unquoted keys, etc.
 */
export async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON5.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new FileSystemError(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new FileSystemError(`Invalid JSON in file: ${filePath} - ${error.message}`);
    }
    throw new FileSystemError(`Failed to read file: ${filePath} - ${error.message}`);
  }
}

/**
 * @deprecated Use readJson instead - now supports comments and trailing commas
 */
export async function readJsonWithComments(filePath) {
  return readJson(filePath);
}

export async function writeJson(filePath, data, options = {}) {
  const { pretty = true } = options;

  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);

    await writeFile(filePath, content, { encoding: 'utf8', backup: false });
  } catch (error) {
    throw new FileSystemError(`Failed to write file: ${filePath} - ${error.message}`);
  }
}

/**
 * Write JSON with comment preservation (JSONC support)
 * Preserves comments from original file if it exists
 * Uses 2-space indentation for formatting
 */
export async function writeJsonWithComments(filePath, data) {
  try {
    let existingContent = null;
    try {
      existingContent = await fs.readFile(filePath, 'utf8');
    } catch {
      // File doesn't exist or can't be read - will create new
    }

    let content;
    if (existingContent) {
      commentJson.parse(existingContent, null, true);
      content = commentJson.stringify(data, null, 2);
    } else {
      content = commentJson.stringify(data, null, 2);
    }

    await writeFile(filePath, content, { encoding: 'utf8', backup: false });
  } catch (error) {
    throw new FileSystemError(`Failed to write JSONC file: ${filePath} - ${error.message}`);
  }
}

export async function copyFile(sourcePath, destPath) {
  try {
    await ensureDir(path.dirname(destPath));
    await fs.copyFile(sourcePath, destPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new FileSystemError(`Source file not found: ${sourcePath}`);
    }
    throw new FileSystemError(`Failed to copy file: ${error.message}`);
  }
}

export async function remove(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new FileSystemError(`Failed to remove: ${filePath} - ${error.message}`);
    }
  }
}

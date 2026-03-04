import fs from 'fs/promises';
import path from 'path';
import { writeFile } from 'atomically';
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

export async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new FileSystemError(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new FileSystemError(`Invalid JSON in file: ${filePath}`);
    }
    throw new FileSystemError(`Failed to read file: ${filePath} - ${error.message}`);
  }
}

/**
 * Strip JSON comments from content while preserving strings
 * Handles single-line comments (// ...) and multi-line comments
 */
function stripJsonComments(content) {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle string boundaries
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }

    if (inString) {
      // Handle escape sequences
      if (char === '\\') {
        result += char + (nextChar || '');
        i += 2;
        continue;
      }
      // Check for end of string
      if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      result += char;
      i++;
      continue;
    }

    // Handle single-line comments
    if (char === '/' && nextChar === '/') {
      // Skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Handle multi-line comments
    if (char === '/' && nextChar === '*') {
      i += 2; // Skip /*
      while (i < content.length - 1) {
        if (content[i] === '*' && content[i + 1] === '/') {
          i += 2; // Skip */
          break;
        }
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Read JSON file with comment support (JSONC)
 */
export async function readJsonWithComments(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const stripped = stripJsonComments(content);
    return JSON.parse(stripped);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new FileSystemError(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new FileSystemError(`Invalid JSON in file: ${filePath}`);
    }
    throw new FileSystemError(`Failed to read file: ${filePath} - ${error.message}`);
  }
}

export async function writeJson(filePath, data, options = {}) {
  const { pretty = true } = options;

  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);

    await writeFile(filePath, content, { encoding: 'utf8' });
  } catch (error) {
    throw new FileSystemError(`Failed to write file: ${filePath} - ${error.message}`);
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

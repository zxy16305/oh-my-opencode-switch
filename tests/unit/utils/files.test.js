import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  exists,
  ensureDir,
  readJson,
  readJsonWithComments,
  writeJson,
  copyFile,
  remove,
} from '../../../src/utils/files.js';
import { FileSystemError } from '../../../src/utils/errors.js';

describe('files', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oos-files-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(tmpDir, 'exists.txt');
      await fs.writeFile(filePath, 'hello');
      assert.equal(await exists(filePath), true);
    });

    it('should return true for existing directory', async () => {
      const dirPath = path.join(tmpDir, 'subdir');
      await fs.mkdir(dirPath);
      assert.equal(await exists(dirPath), true);
    });

    it('should return false for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'nope.txt');
      assert.equal(await exists(filePath), false);
    });

    it('should return false for non-existent deep path', async () => {
      const filePath = path.join(tmpDir, 'a', 'b', 'c', 'nope.txt');
      assert.equal(await exists(filePath), false);
    });
  });

  describe('ensureDir', () => {
    it('should create a new directory', async () => {
      const dirPath = path.join(tmpDir, 'new-dir');
      await ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      assert.ok(stat.isDirectory());
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(tmpDir, 'a', 'b', 'c');
      await ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      assert.ok(stat.isDirectory());
    });

    it('should not throw if directory already exists', async () => {
      const dirPath = path.join(tmpDir, 'existing');
      await fs.mkdir(dirPath);
      // Should not throw
      await ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      assert.ok(stat.isDirectory());
    });
  });

  describe('readJson', () => {
    it('should read and parse a valid JSON file', async () => {
      const filePath = path.join(tmpDir, 'test.json');
      const data = { name: 'test', value: 42 };
      await fs.writeFile(filePath, JSON.stringify(data));
      const result = await readJson(filePath);
      assert.deepEqual(result, data);
    });

    it('should read JSON with comments (JSON5)', async () => {
      const filePath = path.join(tmpDir, 'commented.json');
      const content = `{
  // This is a comment
  "name": "test",
  "value": 42, // trailing comma
}`;
      await fs.writeFile(filePath, content);
      const result = await readJson(filePath);
      assert.equal(result.name, 'test');
      assert.equal(result.value, 42);
    });

    it('should read JSON with single-quoted strings (JSON5)', async () => {
      const filePath = path.join(tmpDir, 'single-quote.json');
      const content = `{ name: 'test' }`;
      await fs.writeFile(filePath, content);
      const result = await readJson(filePath);
      assert.equal(result.name, 'test');
    });

    it('should throw FileSystemError for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'missing.json');
      await assert.rejects(
        () => readJson(filePath),
        (err) => {
          assert.ok(err instanceof FileSystemError);
          assert.match(err.message, /not found/i);
          return true;
        }
      );
    });

    it('should throw FileSystemError for invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json');
      await fs.writeFile(filePath, '{ invalid json !!!');
      await assert.rejects(
        () => readJson(filePath),
        (err) => {
          assert.ok(err instanceof FileSystemError);
          assert.match(err.message, /invalid json/i);
          return true;
        }
      );
    });

    it('should read JSON arrays', async () => {
      const filePath = path.join(tmpDir, 'array.json');
      const data = [1, 'two', true, null];
      await fs.writeFile(filePath, JSON.stringify(data));
      const result = await readJson(filePath);
      assert.deepEqual(result, data);
    });

    it('should read empty object', async () => {
      const filePath = path.join(tmpDir, 'empty.json');
      await fs.writeFile(filePath, '{}');
      const result = await readJson(filePath);
      assert.deepEqual(result, {});
    });

    it('should handle deeply nested JSON', async () => {
      const filePath = path.join(tmpDir, 'nested.json');
      const data = { a: { b: { c: { d: { e: 'deep' } } } } };
      await fs.writeFile(filePath, JSON.stringify(data));
      const result = await readJson(filePath);
      assert.deepEqual(result, data);
    });
  });

  describe('readJsonWithComments', () => {
    it('should delegate to readJson', async () => {
      const filePath = path.join(tmpDir, 'comments.json');
      const data = { key: 'value' };
      await fs.writeFile(filePath, JSON.stringify(data));
      const result = await readJsonWithComments(filePath);
      assert.deepEqual(result, data);
    });
  });

  describe('writeJson', () => {
    it('should write JSON file with pretty formatting by default', async () => {
      const filePath = path.join(tmpDir, 'pretty.json');
      const data = { name: 'test', items: [1, 2, 3] };
      await writeJson(filePath, data);

      const content = await fs.readFile(filePath, 'utf8');
      assert.ok(content.includes('\n'));
      assert.ok(content.includes('  ')); // 2-space indent
      const parsed = JSON.parse(content);
      assert.deepEqual(parsed, data);
    });

    it('should write compact JSON when pretty=false', async () => {
      const filePath = path.join(tmpDir, 'compact.json');
      const data = { name: 'test' };
      await writeJson(filePath, data, { pretty: false });

      const content = await fs.readFile(filePath, 'utf8');
      assert.equal(content, '{"name":"test"}');
    });

    it('should overwrite existing file', async () => {
      const filePath = path.join(tmpDir, 'overwrite.json');
      await writeJson(filePath, { version: 1 });
      await writeJson(filePath, { version: 2 });

      const result = await readJson(filePath);
      assert.equal(result.version, 2);
    });

    it('should handle empty object', async () => {
      const filePath = path.join(tmpDir, 'empty.json');
      await writeJson(filePath, {});

      const content = await fs.readFile(filePath, 'utf8');
      assert.equal(content, '{}');
    });

    it('should handle arrays', async () => {
      const filePath = path.join(tmpDir, 'array.json');
      const data = [1, 2, 3];
      await writeJson(filePath, data);

      const result = await readJson(filePath);
      assert.deepEqual(result, data);
    });

    it('should handle null values in objects', async () => {
      const filePath = path.join(tmpDir, 'null.json');
      const data = { value: null };
      await writeJson(filePath, data);

      const result = await readJson(filePath);
      assert.equal(result.value, null);
    });

    it('should handle unicode values', async () => {
      const filePath = path.join(tmpDir, 'unicode.json');
      const data = { greeting: '你好世界' };
      await writeJson(filePath, data);

      const result = await readJson(filePath);
      assert.equal(result.greeting, '你好世界');
    });
  });

  describe('copyFile', () => {
    it('should copy a file to destination', async () => {
      const srcPath = path.join(tmpDir, 'source.txt');
      const destPath = path.join(tmpDir, 'dest.txt');
      await fs.writeFile(srcPath, 'hello world');
      await copyFile(srcPath, destPath);

      const content = await fs.readFile(destPath, 'utf8');
      assert.equal(content, 'hello world');
    });

    it('should create destination directory if needed', async () => {
      const srcPath = path.join(tmpDir, 'source.txt');
      const destPath = path.join(tmpDir, 'sub', 'dir', 'dest.txt');
      await fs.writeFile(srcPath, 'nested copy');
      await copyFile(srcPath, destPath);

      const content = await fs.readFile(destPath, 'utf8');
      assert.equal(content, 'nested copy');
    });

    it('should throw FileSystemError for non-existent source', async () => {
      const srcPath = path.join(tmpDir, 'nope.txt');
      const destPath = path.join(tmpDir, 'dest.txt');

      await assert.rejects(
        () => copyFile(srcPath, destPath),
        (err) => {
          assert.ok(err instanceof FileSystemError);
          assert.match(err.message, /not found/i);
          return true;
        }
      );
    });

    it('should overwrite existing destination file', async () => {
      const srcPath = path.join(tmpDir, 'source.txt');
      const destPath = path.join(tmpDir, 'dest.txt');
      await fs.writeFile(srcPath, 'new content');
      await fs.writeFile(destPath, 'old content');
      await copyFile(srcPath, destPath);

      const content = await fs.readFile(destPath, 'utf8');
      assert.equal(content, 'new content');
    });
  });

  describe('remove', () => {
    it('should remove a file', async () => {
      const filePath = path.join(tmpDir, 'to-remove.txt');
      await fs.writeFile(filePath, 'data');
      await remove(filePath);
      assert.equal(await exists(filePath), false);
    });

    it('should remove a directory recursively', async () => {
      const dirPath = path.join(tmpDir, 'dir-to-remove');
      await fs.mkdir(dirPath, { recursive: true });
      await fs.mkdir(path.join(dirPath, 'sub'), { recursive: true });
      await fs.writeFile(path.join(dirPath, 'sub', 'file.txt'), 'data');
      await remove(dirPath);
      assert.equal(await exists(dirPath), false);
    });

    it('should not throw for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'non-existent.txt');
      // Should silently succeed
      await remove(filePath);
    });

    it('should remove empty directory', async () => {
      const dirPath = path.join(tmpDir, 'empty-dir');
      await fs.mkdir(dirPath);
      await remove(dirPath);
      assert.equal(await exists(dirPath), false);
    });
  });
});

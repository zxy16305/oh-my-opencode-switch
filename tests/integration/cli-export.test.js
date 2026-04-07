import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { setupTestHome, cleanupTestHome, getTestEnv } from '../helpers/test-home.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../bin/oos.js');

describe('CLI Integration - profile export', () => {
  let testDir;
  let exportDir;
  let profileName;
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;

    const uniqueId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    profileName = 'test-export-' + uniqueId;
    testDir = join(testHome, 'exports');
    exportDir = testDir;
    await fs.mkdir(exportDir, { recursive: true });

    await execFileAsync(
      'node',
      [cliPath, 'profile', 'create', profileName, '-d', 'Integration test profile'],
      {
        env: getTestEnv(testHome),
      }
    );
  });

  afterEach(async () => {
    try {
      await execFileAsync('node', [cliPath, 'profile', 'delete', profileName, '-f'], {
        env: getTestEnv(testHome),
      });
    } catch {
      // Silently ignore - profile may not exist
    }

    await cleanupTestHome(testHome);
  });

  describe('basic export', () => {
    it('should export profile to current directory with .export.json suffix', async () => {
      const expectedPath = join(exportDir, `${profileName}.export.json`);

      const { stdout } = await execFileAsync('node', [cliPath, 'profile', 'export', profileName], {
        cwd: exportDir,
        env: getTestEnv(testHome),
      });

      assert.ok(stdout.includes('Exported profile') || stdout.includes(profileName));

      const stat = await fs.stat(expectedPath);
      assert.ok(stat.isFile(), 'Export file should exist');

      const content = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
      assert.equal(content.version, 1, 'Export should have version 1');
      assert.ok(content.exportedAt, 'Export should have exportedAt');
      assert.equal(content.profile, profileName, 'Export should have correct profile name');
      assert.ok(content.template, 'Export should have template object');
      assert.ok(content.variables !== undefined, 'Export should have variables');
    });

    it('should export file with correct structure: version, exportedAt, profile, template, variables', async () => {
      const exportPath = join(exportDir, `${profileName}.export.json`);

      await execFileAsync('node', [cliPath, 'profile', 'export', profileName], {
        cwd: exportDir,
      });

      const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));

      assert.equal(typeof data.version, 'number', 'version should be a number');
      assert.equal(data.version, 1, 'version should be 1');
      assert.equal(typeof data.exportedAt, 'string', 'exportedAt should be a string');
      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(data.exportedAt), 'exportedAt should be ISO date');
      assert.equal(typeof data.profile, 'string', 'profile should be a string');
      assert.equal(data.profile, profileName);
      assert.equal(typeof data.template, 'object', 'template should be an object');
      assert.ok(data.template !== null, 'template should not be null');
      assert.equal(typeof data.variables, 'object', 'variables should be an object');
    });
  });

  describe('custom output path (-o option)', () => {
    it('should export profile to custom path when -o is specified', async () => {
      const customPath = join(testDir, 'my-custom-export.json');

      await execFileAsync('node', [cliPath, 'profile', 'export', profileName, '-o', customPath], {
        cwd: exportDir,
        env: getTestEnv(testHome),
      });

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist at custom path');

      const data = JSON.parse(await fs.readFile(customPath, 'utf8'));
      assert.equal(data.profile, profileName);
    });

    it('should create parent directories for custom output path if needed', async () => {
      const customPath = join(testDir, 'nested', 'dirs', 'export.json');

      await execFileAsync('node', [cliPath, 'profile', 'export', profileName, '-o', customPath], {
        cwd: exportDir,
        env: getTestEnv(testHome),
      });

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist with nested dirs');
    });

    it('should support --output as alias for -o', async () => {
      const customPath = join(testDir, 'output-alias-test.json');

      await execFileAsync(
        'node',
        [cliPath, 'profile', 'export', profileName, '--output', customPath],
        {
          cwd: exportDir,
          env: getTestEnv(testHome),
        }
      );

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist with --output alias');
    });
  });

  describe('error cases', () => {
    it('should error when exporting non-existent profile', async () => {
      const nonExistentProfile = 'non-existent-profile-' + Date.now();

      try {
        await execFileAsync('node', [cliPath, 'profile', 'export', nonExistentProfile], {
          cwd: exportDir,
          env: getTestEnv(testHome),
        });
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(
          error.code !== 0 ||
            error.stderr?.includes('not found') ||
            error.stdout?.includes('not found'),
          'Should indicate profile not found'
        );
      }
    });

    it('should error when profile name is missing', async () => {
      try {
        await execFileAsync('node', [cliPath, 'profile', 'export'], {
          cwd: exportDir,
          env: getTestEnv(testHome),
        });
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.ok(error.code !== 0, 'Should exit with non-zero code');
      }
    });
  });

  describe('file content validation', () => {
    it('should preserve template object structure in export', async () => {
      const exportPath = join(exportDir, `${profileName}.export.json`);

      await execFileAsync('node', [cliPath, 'profile', 'export', profileName], {
        cwd: exportDir,
        env: getTestEnv(testHome),
      });

      const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));

      assert.ok(data.template, 'Template should exist');
      assert.equal(typeof data.template, 'object', 'Template should be an object');
    });

    it('should export valid JSON that can be parsed', async () => {
      const exportPath = join(exportDir, `${profileName}.export.json`);

      await execFileAsync('node', [cliPath, 'profile', 'export', profileName], {
        cwd: exportDir,
        env: getTestEnv(testHome),
      });

      const rawContent = await fs.readFile(exportPath, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch (e) {
        assert.fail(`Export file contains invalid JSON: ${e.message}`);
      }

      assert.ok(parsed, 'Parsed export should not be null');
    });
  });
});

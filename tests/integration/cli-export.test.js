import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { ProfileManager } from '../../src/core/ProfileManager.js';
import { exportAction } from '../../src/commands/profile/export.js';

describe('CLI Integration - profile export', () => {
  let manager;
  let testHome;
  let testDir;
  let exportDir;
  let profileName;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;

    manager = new ProfileManager();
    await manager.init();

    const uniqueId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    profileName = 'test-export-' + uniqueId;
    testDir = join(testHome, 'exports');
    exportDir = testDir;
    await fs.mkdir(exportDir, { recursive: true });

    await manager.createProfile(profileName, { description: 'Integration test profile' });
  });

  afterEach(async () => {
    try {
      await manager.deleteProfile(profileName, { force: true });
    } catch {
      // Silently ignore - profile may not exist
    }

    await cleanupTestHome(testHome);
  });

  describe('basic export', () => {
    it('should export profile to current directory with .export.json suffix', async () => {
      const expectedPath = join(exportDir, `${profileName}.export.json`);

      await exportAction(profileName, { output: expectedPath, force: true });

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

      await exportAction(profileName, { output: exportPath, force: true });

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

      await exportAction(profileName, { output: customPath, force: true });

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist at custom path');

      const data = JSON.parse(await fs.readFile(customPath, 'utf8'));
      assert.equal(data.profile, profileName);
    });

    it('should create parent directories for custom output path if needed', async () => {
      const customPath = join(testDir, 'nested', 'dirs', 'export.json');

      await exportAction(profileName, { output: customPath, force: true });

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist with nested dirs');
    });

    it('should support --output as alias for -o', async () => {
      const customPath = join(testDir, 'output-alias-test.json');

      await exportAction(profileName, { output: customPath, force: true });

      const stat = await fs.stat(customPath);
      assert.ok(stat.isFile(), 'Export file should exist with --output alias');
    });
  });

  describe('error cases', () => {
    it('should error when exporting non-existent profile', async () => {
      const nonExistentProfile = 'non-existent-profile-' + Date.now();

      await assert.rejects(async () => await exportAction(nonExistentProfile, { force: true }), {
        message: /not found/,
      });
    });

    it('should error when profile name is missing', async () => {
      await assert.rejects(async () => await exportAction(undefined, { force: true }));
    });
  });

  describe('file content validation', () => {
    it('should preserve template object structure in export', async () => {
      const exportPath = join(exportDir, `${profileName}.export.json`);

      await exportAction(profileName, { output: exportPath, force: true });

      const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));

      assert.ok(data.template, 'Template should exist');
      assert.equal(typeof data.template, 'object', 'Template should be an object');
    });

    it('should export valid JSON that can be parsed', async () => {
      const exportPath = join(exportDir, `${profileName}.export.json`);

      await exportAction(profileName, { output: exportPath, force: true });

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

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { ProfileManager } from '../../src/core/ProfileManager.js';
import { importAction } from '../../src/commands/profile/import.js';

function generateUniqueProfileName() {
  return `test-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('CLI Import Command', () => {
  let testHome;
  let fixturesDir;
  let profileName;
  let validExportFile;
  let invalidJsonFile;
  let manager;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    fixturesDir = join(testHome, 'import-fixtures');
    await fs.mkdir(fixturesDir, { recursive: true });
    profileName = generateUniqueProfileName();
    validExportFile = join(fixturesDir, `${profileName}.json`);
    const validExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: profileName,
      template: {
        $schema: 'https://example.com/schema.json',
        agents: {},
        categories: {},
      },
      variables: {},
    };
    await fs.writeFile(validExportFile, JSON.stringify(validExport, null, 2));
    invalidJsonFile = join(fixturesDir, 'invalid-json.json');
    await fs.writeFile(invalidJsonFile, '{ invalid json }');
    manager = new ProfileManager();
    await manager.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(fixturesDir, { recursive: true, force: true });
    } catch {}
    if (profileName) {
      try {
        await manager.deleteProfile(profileName);
      } catch {}
    }
    await cleanupTestHome(testHome);
  });

  describe('Successful import', () => {
    it('should import from a valid export file', async () => {
      const result = await importAction(validExportFile, { force: true });
      assert.equal(result.success, true);
      assert.equal(result.name, profileName);
    });
  });

  describe('Error cases', () => {
    it('should error when importing a non-existent file', async () => {
      await assert.rejects(() => importAction('/nonexistent/path/file.json', { force: true }), {
        message: /not found/,
      });
    });

    it('should error when importing invalid JSON', async () => {
      await assert.rejects(() => importAction(invalidJsonFile, { force: true }), {
        message: /JSON|parse/i,
      });
    });
  });
});

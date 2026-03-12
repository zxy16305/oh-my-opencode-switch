import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { ProfileManager } from '../../../src/core/ProfileManager.js';

describe('ProfileManager.importProfile', () => {
  let tmpDir;
  let pm;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), 'oos-import-test-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    pm = new ProfileManager({ basePath: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('imports valid export file and creates profile', async () => {
    const exportPath = path.join(tmpDir, 'valid-export.json');
    const payload = {
      version: 1,
      profile: 'importedProfile',
      config: { a: 1, b: 2 },
    };
    await fs.writeFile(exportPath, JSON.stringify(payload), 'utf8');

    const result = await pm.importProfile(exportPath);

    assert.equal(result.name, 'importedProfile');
    assert.ok(result.createdAt);
    assert.equal(result.isDefault, false);

    const configPath = path.join(tmpDir, 'profiles', 'importedProfile', 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.deepEqual(config, { a: 1, b: 2 });
  });

  it('throws FileSystemError for non-existent file', async () => {
    const fakePath = path.join(tmpDir, 'not-exist.export.json');
    await assert.rejects(
      async () => {
        await pm.importProfile(fakePath);
      },
      { name: 'FileSystemError' }
    );
  });

  it('throws ProfileError for invalid JSON', async () => {
    const exportPath = path.join(tmpDir, 'bad.json');
    await fs.writeFile(exportPath, 'not-json', 'utf8');
    await assert.rejects(
      async () => {
        await pm.importProfile(exportPath);
      },
      { name: 'ProfileError' }
    );
  });

  it('throws ProfileError for missing version', async () => {
    const exportPath = path.join(tmpDir, 'missing-version.json');
    await fs.writeFile(exportPath, JSON.stringify({ profile: 'missing', config: {} }), 'utf8');
    await assert.rejects(
      async () => {
        await pm.importProfile(exportPath);
      },
      { name: 'ProfileError' }
    );
  });

  it('throws ProfileError for invalid profile name in export', async () => {
    const exportPath = path.join(tmpDir, 'invalid-name.json');
    await fs.writeFile(
      exportPath,
      JSON.stringify({ version: 1, profile: 'Invalid Name!', config: {} }),
      'utf8'
    );
    await assert.rejects(
      async () => {
        await pm.importProfile(exportPath);
      },
      { name: 'ProfileError' }
    );
  });

  it('resets metadata on import (createdAt=now, isDefault=false)', async () => {
    const exportPath = path.join(tmpDir, 'metadata-test.json');
    const payload = { version: 1, profile: 'metadataProfile', config: { test: true } };
    await fs.writeFile(exportPath, JSON.stringify(payload), 'utf8');

    const beforeImport = new Date();
    const result = await pm.importProfile(exportPath);
    const afterImport = new Date();

    const createdAt = new Date(result.createdAt);
    assert.ok(createdAt >= beforeImport && createdAt <= afterImport, 'createdAt should be recent');
    assert.equal(result.isDefault, false, 'isDefault should be false');
  });
});

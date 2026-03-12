import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { ProfileManager } from '../../../src/core/ProfileManager.js';

describe('ProfileManager.exportProfile - RED phase (unit tests)', () => {
  let tmpDir;
  let pm;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), 'oos-export-test-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    const legacyDir = path.join(tmpDir, 'profiles', 'legacyName');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'config.json'),
      JSON.stringify({ some: 'value', other: 123 }),
      'utf8'
    );
    await fs.mkdir(path.join(tmpDir, 'exports'), { recursive: true });
    pm = new ProfileManager({ basePath: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('exports legacy profile (config.json only) to default export location', async () => {
    const profileName = 'legacyName';
    await pm.exportProfile(profileName);
    const exportPath = path.join(tmpDir, 'exports', `${profileName}.export.json`);
    let stat;
    try {
      stat = await fs.stat(exportPath);
    } catch {
      stat = null;
    }
    assert.ok(stat, 'export file should exist at default location');

    const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.equal(data.version, 1);
    assert.equal(data.profile, profileName);
    assert.ok(data.config);
    assert.deepEqual(data.config, { some: 'value', other: 123 });
  });

  it('exports to a custom path when outputPath option is provided', async () => {
    const profileName = 'legacyName';
    const customPath = path.join(tmpDir, 'custom_exports', 'myProfile.export.json');
    await pm.exportProfile(profileName, { outputPath: customPath });
    const stat = await fs.stat(customPath);
    assert.ok(stat);
    const data = JSON.parse(await fs.readFile(customPath, 'utf8'));
    assert.equal(data.profile, profileName);
    assert.equal(data.version, 1);
  });

  it('throws ProfileError for non-existent profile', async () => {
    await assert.rejects(
      async () => {
        await pm.exportProfile('non-existent');
      },
      { name: 'ProfileError' }
    );
  });

  it('exports file contains expected structure: version, exportedAt, profile, config', async () => {
    const profileName = 'legacyName';
    const exportPath = path.join(tmpDir, 'exports', 'structure_check.export.json');
    await pm.exportProfile(profileName, { outputPath: exportPath });
    const data = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.equal(data.version, 1);
    assert.ok(typeof data.exportedAt === 'string');
    assert.equal(data.profile, profileName);
    assert.ok(data.config);
  });
});

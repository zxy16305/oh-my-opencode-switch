import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { promises as fs } from 'node:fs';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';
import { initAction } from '../../src/commands/init.js';

describe('init command integration tests', () => {
  const profileName = 'default-template';
  let testHome;
  let oosDir;
  let profilesMetadataPath;
  let templatePath;
  let variablesPath;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;

    oosDir = path.join(testHome, '.config', 'opencode', '.oos');
    profilesMetadataPath = path.join(oosDir, 'profiles.json');
    templatePath = path.join(oosDir, 'profiles', profileName, 'template.json');
    variablesPath = path.join(oosDir, 'profiles', profileName, 'variables.json');
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  it('should create default-template profile on first initialization', async () => {
    await initAction();

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    assert.ok(metadata.profiles[profileName], 'default-template should exist in profiles');
    assert.equal(metadata.profiles[profileName].name, profileName);
    assert.equal(metadata.profiles[profileName].description, 'Default template profile');
  });

  it('should not overwrite existing default-template profile on repeated initialization', async () => {
    await initAction();

    const originalMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const originalMetadata = JSON.parse(originalMetadataContent);
    const originalCreatedAt = originalMetadata.profiles[profileName].createdAt;

    originalMetadata.profiles[profileName].description = 'Modified description';
    await fs.writeFile(profilesMetadataPath, JSON.stringify(originalMetadata, null, 2));

    await initAction();

    const newMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const newMetadata = JSON.parse(newMetadataContent);
    assert.equal(
      newMetadata.profiles[profileName].createdAt,
      originalCreatedAt,
      'createdAt should not change'
    );
  });

  it('should keep activeProfile as null after initialization', async () => {
    await initAction();

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);
    assert.equal(metadata.activeProfile, null, 'activeProfile should remain null after init');
  });

  it('should create correct template.json and variables.json for default-template', async () => {
    await initAction();

    const templateContent = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(templateContent);
    assert.ok(template.oosVersionTag, 'template should have oosVersionTag');
    assert.equal(template.oosVersionTag, 'default:1.1');

    const variablesContent = await fs.readFile(variablesPath, 'utf8');
    const variables = JSON.parse(variablesContent);
    assert.ok(Object.keys(variables).length > 0, 'variables should not be empty');
  });
});

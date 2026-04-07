import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setupTestHome, cleanupTestHome, getTestEnv } from '../helpers/test-home.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '../../bin/oos.js');

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
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    assert.ok(metadata.profiles[profileName], 'default-template should exist in profiles');
    assert.equal(metadata.profiles[profileName].name, profileName);
    assert.equal(metadata.profiles[profileName].description, 'Default template profile');
  });

  it('should not overwrite existing default-template profile on repeated initialization', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const originalMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const originalMetadata = JSON.parse(originalMetadataContent);
    const originalCreatedAt = originalMetadata.profiles[profileName].createdAt;

    originalMetadata.profiles[profileName].description = 'Modified description';
    await fs.writeFile(profilesMetadataPath, JSON.stringify(originalMetadata, null, 2));

    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const newMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const newMetadata = JSON.parse(newMetadataContent);
    assert.equal(
      newMetadata.profiles[profileName].createdAt,
      originalCreatedAt,
      'createdAt should not change'
    );
  });

  it('should keep activeProfile as null after initialization', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);
    assert.equal(metadata.activeProfile, null, 'activeProfile should remain null after init');
  });

  it('should create correct template.json and variables.json for default-template', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const templateContent = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(templateContent);
    assert.ok(template.oosVersionTag, 'template should have oosVersionTag');
    assert.equal(template.oosVersionTag, 'default:1.1');

    const variablesContent = await fs.readFile(variablesPath, 'utf8');
    const variables = JSON.parse(variablesContent);
    assert.ok(Object.keys(variables).length > 0, 'variables should not be empty');
  });
  it('should not overwrite existing default-template profile on repeated initialization', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const originalMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const originalMetadata = JSON.parse(originalMetadataContent);
    const originalCreatedAt = originalMetadata.profiles[profileName].createdAt;

    originalMetadata.profiles[profileName].description = 'Modified description';
    await fs.writeFile(profilesMetadataPath, JSON.stringify(originalMetadata, null, 2));

    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const newMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const newMetadata = JSON.parse(newMetadataContent);
    assert.equal(
      newMetadata.profiles[profileName].createdAt,
      originalCreatedAt,
      'createdAt should not change'
    );
  });

  it('should keep activeProfile as null after initialization', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);
    assert.equal(metadata.activeProfile, null, 'activeProfile should remain null after init');
  });

  it('should create correct template.json and variables.json for default-template', async () => {
    await execFileAsync('node', [cliPath, 'init'], {
      env: getTestEnv(testHome),
    });

    const templateContent = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(templateContent);
    assert.ok(template.oosVersionTag, 'template should have oosVersionTag');
    assert.equal(template.oosVersionTag, 'default:1.1');

    const variablesContent = await fs.readFile(variablesPath, 'utf8');
    const variables = JSON.parse(variablesContent);
    assert.ok(Object.keys(variables).length > 0, 'variables should not be empty');
  });
});

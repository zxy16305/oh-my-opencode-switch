import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '../../bin/oos.js');

import {
  getOosDir,
  getProfilesMetadataPath,
  getProfileDirPath,
  getTemplatePath,
  getVariablesPath,
} from '../../src/utils/paths.js';

describe('init command integration tests', () => {
  const profileName = 'default-template';
  let oosDir;
  let profilesMetadataPath;
  let profileDir;
  let templatePath;
  let variablesPath;

  beforeEach(async () => {
    oosDir = getOosDir();
    profilesMetadataPath = getProfilesMetadataPath();
    profileDir = getProfileDirPath(profileName);
    templatePath = getTemplatePath(profileName);
    variablesPath = getVariablesPath(profileName);

    try {
      await fs.rm(oosDir, { recursive: true, force: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      await fs.rm(oosDir, { recursive: true, force: true });
    } catch {}
  });

  it('should create default-template profile on first initialization', async () => {
    await execFileAsync('node', [cliPath, 'init']);

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    assert.ok(metadata.profiles[profileName], 'default-template should exist in profiles');
    assert.equal(metadata.profiles[profileName].name, profileName);
    assert.equal(metadata.profiles[profileName].description, 'Default template profile');
  });

  it('should not overwrite existing default-template profile on repeated initialization', async () => {
    await execFileAsync('node', [cliPath, 'init']);

    const originalMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const originalMetadata = JSON.parse(originalMetadataContent);
    const originalCreatedAt = originalMetadata.profiles[profileName].createdAt;

    originalMetadata.profiles[profileName].description = 'Modified description';
    await fs.writeFile(profilesMetadataPath, JSON.stringify(originalMetadata, null, 2));

    await execFileAsync('node', [cliPath, 'init']);

    const updatedMetadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const updatedMetadata = JSON.parse(updatedMetadataContent);

    assert.equal(
      updatedMetadata.profiles[profileName].description,
      'Modified description',
      'Profile description should remain modified'
    );
    assert.equal(
      updatedMetadata.profiles[profileName].createdAt,
      originalCreatedAt,
      'Profile creation time should remain the same'
    );
  });

  it('should keep activeProfile as null after initialization', async () => {
    await execFileAsync('node', [cliPath, 'init']);

    const metadataContent = await fs.readFile(profilesMetadataPath, 'utf8');
    const metadata = JSON.parse(metadataContent);

    assert.equal(metadata.activeProfile, null, 'activeProfile should be null');
  });

  it('should create correct template.json and variables.json for default-template', async () => {
    await execFileAsync('node', [cliPath, 'init']);

    const templateContent = await fs.readFile(templatePath, 'utf8');
    const template = JSON.parse(templateContent);

    assert.ok(template.agents, 'template should have agents');
    assert.ok(template.agents.Sisyphus, 'template should have Sisyphus agent');
    assert.ok(template.categories, 'template should have categories');
    assert.ok(template.experimental, 'template should have experimental config');
    assert.ok(template.background_task, 'template should have background_task config');

    const variablesContent = await fs.readFile(variablesPath, 'utf8');
    const variables = JSON.parse(variablesContent);

    assert.ok(variables.MODEL_ORCHESTRATOR, 'variables should have MODEL_ORCHESTRATOR');
    assert.ok(variables.MODEL_PLANNER, 'variables should have MODEL_PLANNER');
    assert.ok(variables.MODEL_REVIEWER, 'variables should have MODEL_REVIEWER');
    assert.ok(variables.MODEL_ORACLE, 'variables should have MODEL_ORACLE');
    assert.ok(variables.MODEL_EXECUTOR, 'variables should have MODEL_EXECUTOR');
  });
});

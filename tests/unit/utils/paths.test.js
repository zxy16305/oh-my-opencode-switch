import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import {
  getBaseConfigDir,
  getOosDir,
  getProfilesDir,
  getProfilesMetadataPath,
  getSourceConfigPath,
  getProfileConfigPath,
  getProfileDirPath,
  getTemplatePath,
  getVariablesPath,
  hasTemplate,
  hasVariables,
} from '../../../src/utils/paths.js';

const baseDir = path.join(os.homedir(), '.config', 'opencode');

describe('Paths utilities', () => {
  describe('getBaseConfigDir', () => {
    it('should return base config directory', () => {
      assert.equal(getBaseConfigDir(), baseDir);
    });
  });

  describe('getOosDir', () => {
    it('should return OOS storage directory', () => {
      assert.equal(getOosDir(), path.join(baseDir, '.oos'));
    });
  });

  describe('getProfilesDir', () => {
    it('should return profiles directory', () => {
      assert.equal(getProfilesDir(), path.join(baseDir, '.oos', 'profiles'));
    });
  });

  describe('getProfilesMetadataPath', () => {
    it('should return profiles metadata path', () => {
      assert.equal(getProfilesMetadataPath(), path.join(baseDir, '.oos', 'profiles.json'));
    });
  });

  describe('getSourceConfigPath', () => {
    it('should return source config path', () => {
      assert.equal(getSourceConfigPath(), path.join(baseDir, 'oh-my-opencode.json'));
    });
  });

  describe('getProfileConfigPath', () => {
    it('should return profile config path', () => {
      assert.equal(
        getProfileConfigPath('my-profile'),
        path.join(baseDir, '.oos', 'profiles', 'my-profile', 'config.json')
      );
    });
  });

  describe('getProfileDirPath', () => {
    it('should return profile directory path', () => {
      assert.equal(
        getProfileDirPath('my-profile'),
        path.join(baseDir, '.oos', 'profiles', 'my-profile')
      );
    });
  });

  describe('getTemplatePath', () => {
    it('should return template path for a profile', () => {
      assert.equal(
        getTemplatePath('my-profile'),
        path.join(baseDir, '.oos', 'profiles', 'my-profile', 'template.json')
      );
    });

    it('should handle different profile names', () => {
      assert.equal(
        getTemplatePath('work'),
        path.join(baseDir, '.oos', 'profiles', 'work', 'template.json')
      );
    });
  });

  describe('getVariablesPath', () => {
    it('should return variables path for a profile', () => {
      assert.equal(
        getVariablesPath('my-profile'),
        path.join(baseDir, '.oos', 'profiles', 'my-profile', 'variables.json')
      );
    });

    it('should handle different profile names', () => {
      assert.equal(
        getVariablesPath('personal'),
        path.join(baseDir, '.oos', 'profiles', 'personal', 'variables.json')
      );
    });
  });

  describe('hasTemplate', () => {
    const testProfileName = 'test-has-template-profile';
    const profileDir = path.join(baseDir, '.oos', 'profiles', testProfileName);
    const templatePath = path.join(profileDir, 'template.json');

    beforeEach(async () => {
      await fs.mkdir(profileDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(profileDir, { recursive: true, force: true });
    });

    it('should return true when template.json exists', async () => {
      await fs.writeFile(templatePath, '{}');
      const result = await hasTemplate(testProfileName);
      assert.equal(result, true);
    });

    it('should return false when template.json does not exist', async () => {
      const result = await hasTemplate(testProfileName);
      assert.equal(result, false);
    });
  });

  describe('hasVariables', () => {
    const testProfileName = 'test-has-variables-profile';
    const profileDir = path.join(baseDir, '.oos', 'profiles', testProfileName);
    const variablesPath = path.join(profileDir, 'variables.json');

    beforeEach(async () => {
      await fs.mkdir(profileDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(profileDir, { recursive: true, force: true });
    });

    it('should return true when variables.json exists', async () => {
      await fs.writeFile(variablesPath, '{}');
      const result = await hasVariables(testProfileName);
      assert.equal(result, true);
    });

    it('should return false when variables.json does not exist', async () => {
      const result = await hasVariables(testProfileName);
      assert.equal(result, false);
    });
  });
});

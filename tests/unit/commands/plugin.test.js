import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePluginMetadata } from '../../../src/commands/plugin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'plugins');

describe('parsePluginMetadata', () => {
  describe('when plugin has Purpose field', () => {
    it('should return correct description when Purpose field exists', async () => {
      const filePath = join(FIXTURES_DIR, 'with-purpose.js');
      const result = await parsePluginMetadata(filePath);

      assert.ok(result, 'Should return a result object');
      assert.equal(result.name, 'with-purpose.js', 'Should extract filename as name');
      assert.equal(
        result.description,
        'Test plugin for metadata parsing.',
        'Should extract Purpose value as description'
      );
    });
  });

  describe('when plugin has no Purpose field', () => {
    it('should return default description when Purpose field is missing', async () => {
      const filePath = join(FIXTURES_DIR, 'without-purpose.js');
      const result = await parsePluginMetadata(filePath);

      assert.ok(result, 'Should return a result object');
      assert.equal(result.name, 'without-purpose.js', 'Should extract filename as name');
      assert.equal(result.description, '—', 'Should return "—" as default description');
    });
  });

  describe('when file does not exist', () => {
    it('should return null for non-existent file', async () => {
      const filePath = join(FIXTURES_DIR, 'non-existent-plugin.js');
      const result = await parsePluginMetadata(filePath);

      assert.equal(result, null, 'Should return null for non-existent file');
    });
  });
});
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../../../src/core/ConfigManager.js';
import { setupTestHome, cleanupTestHome } from '../../helpers/test-home.js';

describe('ConfigManager', () => {
  let cm;
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
    cm = new ConfigManager();
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('init', () => {
    it('should create .oos and backup directories', async () => {
      await cm.init();
      const oosDir = path.join(testHome, '.config', 'opencode', '.oos');
      const backupDir = path.join(testHome, '.config', 'opencode', '.oos', 'backup');
      const oosStat = await fs.stat(oosDir);
      const backupStat = await fs.stat(backupDir);
      assert.ok(oosStat.isDirectory());
      assert.ok(backupStat.isDirectory());
    });

    it('should be idempotent', async () => {
      await cm.init();
      assert.equal(cm.initialized, true);
      await cm.init();
      assert.equal(cm.initialized, true);
    });
  });

  describe('writeConfig and readConfig round-trip', () => {
    it('should write and read back a valid config', async () => {
      const config = { agents: { build: { model: 'gpt-4' } } };
      await cm.init();
      await cm.writeConfig(config);
      const result = await cm.readConfig();
      assert.equal(result.agents.build.model, 'gpt-4');
    });

    it('should handle config with nested objects', async () => {
      const config = {
        agents: {
          Sisyphus: {
            model: 'model-a',
            ultrawork: { model: 'model-b' },
          },
        },
        categories: { deep: { model: 'model-c' } },
      };
      await cm.init();
      await cm.writeConfig(config);
      const result = await cm.readConfig();
      assert.equal(result.agents.Sisyphus.model, 'model-a');
      assert.equal(result.agents.Sisyphus.ultrawork.model, 'model-b');
      assert.equal(result.categories.deep.model, 'model-c');
    });

    it('should overwrite existing config', async () => {
      await cm.init();
      await cm.writeConfig({ version: 1 });
      await cm.writeConfig({ version: 2 });
      const result = await cm.readConfig();
      assert.equal(result.version, 2);
    });

    it('should handle empty object config', async () => {
      await cm.init();
      await cm.writeConfig({});
      const result = await cm.readConfig();
      assert.deepEqual(result, {});
    });

    it('should handle config with null and boolean values', async () => {
      const config = { enabled: true, count: 42, value: null, ratio: 3.14 };
      await cm.init();
      await cm.writeConfig(config);
      const result = await cm.readConfig();
      assert.equal(result.enabled, true);
      assert.equal(result.count, 42);
      assert.equal(result.value, null);
      assert.equal(result.ratio, 3.14);
    });

    it('should handle config with arrays', async () => {
      const config = {
        experimental: {
          dynamic_context_pruning: {
            protected_tools: ['task', 'todowrite', 'lsp_rename'],
          },
        },
      };
      await cm.init();
      await cm.writeConfig(config);
      const result = await cm.readConfig();
      assert.deepEqual(result.experimental.dynamic_context_pruning.protected_tools, [
        'task',
        'todowrite',
        'lsp_rename',
      ]);
    });
  });

  describe('_cleanupOldBackups', () => {
    it('should keep only the specified number of backup files', async () => {
      const backupDir = path.join(testHome, 'cleanup-test');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamps = [
        '2024-01-05T00-00-00-000Z',
        '2024-01-04T00-00-00-000Z',
        '2024-01-03T00-00-00-000Z',
        '2024-01-02T00-00-00-000Z',
        '2024-01-01T00-00-00-000Z',
      ];

      for (const ts of timestamps) {
        await fs.writeFile(path.join(backupDir, `oh-my-opencode.${ts}.json`), '{}');
      }

      await cm._cleanupOldBackups(backupDir, 3);

      const remaining = await fs.readdir(backupDir);
      const backupFiles = remaining.filter((f) => f.endsWith('.json'));
      assert.equal(backupFiles.length, 3);
    });

    it('should keep the latest files when cleaning up', async () => {
      const backupDir = path.join(testHome, 'cleanup-latest');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamps = [
        '2024-01-01T00-00-00-000Z',
        '2024-01-02T00-00-00-000Z',
        '2024-01-03T00-00-00-000Z',
      ];

      for (const ts of timestamps) {
        await fs.writeFile(path.join(backupDir, `oh-my-opencode.${ts}.json`), '{}');
      }

      await cm._cleanupOldBackups(backupDir, 1);

      const remaining = await fs.readdir(backupDir);
      const backupFiles = remaining.filter((f) => f.endsWith('.json'));
      assert.equal(backupFiles.length, 1);
      assert.ok(backupFiles[0].includes('2024-01-03'));
    });

    it('should not delete anything when count is within limit', async () => {
      const backupDir = path.join(testHome, 'cleanup-within');
      await fs.mkdir(backupDir, { recursive: true });

      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-01T00-00-00-000Z.json'),
        '{}'
      );
      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-02T00-00-00-000Z.json'),
        '{}'
      );

      await cm._cleanupOldBackups(backupDir, 5);

      const remaining = await fs.readdir(backupDir);
      assert.equal(remaining.length, 2);
    });

    it('should only clean files matching the backup filename pattern', async () => {
      const backupDir = path.join(testHome, 'cleanup-pattern');
      await fs.mkdir(backupDir, { recursive: true });

      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-01T00-00-00-000Z.json'),
        '{}'
      );
      await fs.writeFile(path.join(backupDir, 'other-file.json'), '{}');
      await fs.writeFile(path.join(backupDir, 'random.txt'), 'data');

      await cm._cleanupOldBackups(backupDir, 0);

      const remaining = await fs.readdir(backupDir);
      assert.ok(remaining.includes('other-file.json'));
      assert.ok(remaining.includes('random.txt'));
      assert.ok(!remaining.includes('oh-my-opencode.2024-01-01T00-00-00-000Z.json'));
    });

    it('should handle empty backup directory', async () => {
      const backupDir = path.join(testHome, 'cleanup-empty');
      await fs.mkdir(backupDir, { recursive: true });

      await cm._cleanupOldBackups(backupDir, 5);

      const remaining = await fs.readdir(backupDir);
      assert.equal(remaining.length, 0);
    });

    it('should delete all matching files when keepCount is 0', async () => {
      const backupDir = path.join(testHome, 'cleanup-zero');
      await fs.mkdir(backupDir, { recursive: true });

      for (let i = 1; i <= 3; i++) {
        await fs.writeFile(
          path.join(backupDir, `oh-my-opencode.2024-01-0${i}T00-00-00-000Z.json`),
          '{}'
        );
      }

      await cm._cleanupOldBackups(backupDir, 0);

      const remaining = await fs.readdir(backupDir);
      const backupFiles = remaining.filter((f) => f.endsWith('.json'));
      assert.equal(backupFiles.length, 0);
    });
  });

  describe('constructor', () => {
    it('should start as uninitialized', () => {
      const cm = new ConfigManager();
      assert.equal(cm.initialized, false);
    });
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigManager } from '../../../src/core/ConfigManager.js';
import { ensureDir } from '../../../src/utils/files.js';

function createTestableConfigManager(baseDir) {
  const sourceConfigPath = path.join(baseDir, 'oh-my-opencode.json');
  const oosDir = path.join(baseDir, '.oos');
  const backupDir = path.join(baseDir, '.oos', 'backup');

  const cm = new ConfigManager();

  cm.init = async function () {
    if (this.initialized) return;
    await ensureDir(oosDir);
    await ensureDir(backupDir);
    this.initialized = true;
  };

  return { cm, sourceConfigPath, oosDir, backupDir };
}

describe('ConfigManager', () => {
  let tmpDir;
  let testCtx;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oos-cfg-test-'));
    testCtx = createTestableConfigManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should create .oos and backup directories', async () => {
      await testCtx.cm.init();
      const oosStat = await fs.stat(testCtx.oosDir);
      const backupStat = await fs.stat(testCtx.backupDir);
      assert.ok(oosStat.isDirectory());
      assert.ok(backupStat.isDirectory());
    });

    it('should be idempotent', async () => {
      await testCtx.cm.init();
      assert.equal(testCtx.cm.initialized, true);
      await testCtx.cm.init();
      assert.equal(testCtx.cm.initialized, true);
    });
  });

  describe('writeConfig and readConfig round-trip', () => {
    it('should write and read back a valid config', async () => {
      const config = { agents: { build: { model: 'gpt-4' } } };
      await testCtx.cm.init();
      await testCtx.cm.writeConfig(config);
      const result = await testCtx.cm.readConfig();
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
      await testCtx.cm.init();
      await testCtx.cm.writeConfig(config);
      const result = await testCtx.cm.readConfig();
      assert.equal(result.agents.Sisyphus.model, 'model-a');
      assert.equal(result.agents.Sisyphus.ultrawork.model, 'model-b');
      assert.equal(result.categories.deep.model, 'model-c');
    });

    it('should overwrite existing config', async () => {
      await testCtx.cm.init();
      await testCtx.cm.writeConfig({ version: 1 });
      await testCtx.cm.writeConfig({ version: 2 });
      const result = await testCtx.cm.readConfig();
      assert.equal(result.version, 2);
    });

    it('should handle empty object config', async () => {
      await testCtx.cm.init();
      await testCtx.cm.writeConfig({});
      const result = await testCtx.cm.readConfig();
      assert.deepEqual(result, {});
    });

    it('should handle config with null and boolean values', async () => {
      const config = { enabled: true, count: 42, value: null, ratio: 3.14 };
      await testCtx.cm.init();
      await testCtx.cm.writeConfig(config);
      const result = await testCtx.cm.readConfig();
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
      await testCtx.cm.init();
      await testCtx.cm.writeConfig(config);
      const result = await testCtx.cm.readConfig();
      assert.deepEqual(result.experimental.dynamic_context_pruning.protected_tools, [
        'task',
        'todowrite',
        'lsp_rename',
      ]);
    });
  });

  describe('_cleanupOldBackups', () => {
    it('should keep only the specified number of backup files', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-test');
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

      await testCtx.cm._cleanupOldBackups(backupDir, 3);

      const remaining = await fs.readdir(backupDir);
      const backupFiles = remaining.filter((f) => f.endsWith('.json'));
      assert.equal(backupFiles.length, 3);
    });

    it('should keep the latest files when cleaning up', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-latest');
      await fs.mkdir(backupDir, { recursive: true });

      const timestamps = [
        '2024-01-01T00-00-00-000Z',
        '2024-01-02T00-00-00-000Z',
        '2024-01-03T00-00-00-000Z',
      ];

      for (const ts of timestamps) {
        await fs.writeFile(path.join(backupDir, `oh-my-opencode.${ts}.json`), '{}');
      }

      await testCtx.cm._cleanupOldBackups(backupDir, 1);

      const remaining = await fs.readdir(backupDir);
      const backupFiles = remaining.filter((f) => f.endsWith('.json'));
      assert.equal(backupFiles.length, 1);
      assert.ok(backupFiles[0].includes('2024-01-03'));
    });

    it('should not delete anything when count is within limit', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-within');
      await fs.mkdir(backupDir, { recursive: true });

      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-01T00-00-00-000Z.json'),
        '{}'
      );
      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-02T00-00-00-000Z.json'),
        '{}'
      );

      await testCtx.cm._cleanupOldBackups(backupDir, 5);

      const remaining = await fs.readdir(backupDir);
      assert.equal(remaining.length, 2);
    });

    it('should only clean files matching the backup filename pattern', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-pattern');
      await fs.mkdir(backupDir, { recursive: true });

      await fs.writeFile(
        path.join(backupDir, 'oh-my-opencode.2024-01-01T00-00-00-000Z.json'),
        '{}'
      );
      await fs.writeFile(path.join(backupDir, 'other-file.json'), '{}');
      await fs.writeFile(path.join(backupDir, 'random.txt'), 'data');

      await testCtx.cm._cleanupOldBackups(backupDir, 0);

      const remaining = await fs.readdir(backupDir);
      assert.ok(remaining.includes('other-file.json'));
      assert.ok(remaining.includes('random.txt'));
      assert.ok(!remaining.includes('oh-my-opencode.2024-01-01T00-00-00-000Z.json'));
    });

    it('should handle empty backup directory', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-empty');
      await fs.mkdir(backupDir, { recursive: true });

      await testCtx.cm._cleanupOldBackups(backupDir, 5);

      const remaining = await fs.readdir(backupDir);
      assert.equal(remaining.length, 0);
    });

    it('should delete all matching files when keepCount is 0', async () => {
      const backupDir = path.join(tmpDir, 'cleanup-zero');
      await fs.mkdir(backupDir, { recursive: true });

      for (let i = 1; i <= 3; i++) {
        await fs.writeFile(
          path.join(backupDir, `oh-my-opencode.2024-01-0${i}T00-00-00-000Z.json`),
          '{}'
        );
      }

      await testCtx.cm._cleanupOldBackups(backupDir, 0);

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

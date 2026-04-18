import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { setupTestHome, cleanupTestHome, getTestEnv } from '../helpers/test-home.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../bin/oos.js');

describe('oos plugin list command', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('oos plugin list (without --all)', () => {
    it('should show "No plugins installed." when no plugins are installed', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, 'plugin', 'list'], {
        env: getTestEnv(testHome),
      });

      assert(stdout.includes('No plugins installed'));
    });

    it('should show installed plugins when plugins exist', async () => {
      const pluginDir = join(testHome, '.config', 'opencode', 'plugin');
      await mkdir(pluginDir, { recursive: true });

      await writeFile(
        join(pluginDir, 'transform-keys.js'),
        'export default async function() { return {}; }'
      );

      const { stdout } = await execFileAsync('node', [cliPath, 'plugin', 'list'], {
        env: getTestEnv(testHome),
      });

      assert(stdout.includes('transform-keys'));
    });
  });

  describe('oos plugin list --all', () => {
    it('should show all built-in plugins in table format', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, 'plugin', 'list', '--all'], {
        env: getTestEnv(testHome),
      });

      assert(stdout.includes('transform-keys'), 'Should list transform-keys plugin');
      assert(stdout.includes('test-minimal'), 'Should list test-minimal plugin');
    });

    it('should show [installed] marker for installed plugins', async () => {
      const pluginDir = join(testHome, '.config', 'opencode', 'plugin');
      await mkdir(pluginDir, { recursive: true });

      const projectPluginsDir = join(__dirname, '..', '..', 'plugins');
      await cp(
        join(projectPluginsDir, 'transform-keys.js'),
        join(pluginDir, 'transform-keys.js')
      );

      const { stdout } = await execFileAsync('node', [cliPath, 'plugin', 'list', '--all'], {
        env: getTestEnv(testHome),
      });

      assert(stdout.includes('transform-keys'), 'Should list transform-keys plugin');
      assert(stdout.includes('[installed]'), 'Should show [installed] marker');
    });

    it('should show multiple plugins with correct status', async () => {
      const pluginDir = join(testHome, '.config', 'opencode', 'plugin');
      await mkdir(pluginDir, { recursive: true });

      const projectPluginsDir = join(__dirname, '..', '..', 'plugins');
      await cp(
        join(projectPluginsDir, 'transform-keys.js'),
        join(pluginDir, 'transform-keys.js')
      );

      const { stdout } = await execFileAsync('node', [cliPath, 'plugin', 'list', '--all'], {
        env: getTestEnv(testHome),
      });

      assert(stdout.includes('transform-keys'), 'Should list transform-keys');
      assert(stdout.includes('[installed]'), 'Should show [installed] marker');
      assert(stdout.includes('test-minimal'), 'Should list test-minimal');
    });
  });
});

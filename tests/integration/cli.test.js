import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { setupTestHome, cleanupTestHome, getTestEnv } from '../helpers/test-home.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../bin/oos.js');

describe('CLI Integration', () => {
  let testHome;

  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  describe('Help commands', () => {
    it('should display help when --help is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, '--help'], {
        env: getTestEnv(testHome),
      });
      assert(stdout.includes('Usage:'));
      assert(stdout.includes('Commands:'));
    });

    it('should display version when --version is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, '--version'], {
        env: getTestEnv(testHome),
      });
      assert(stdout.match(/\d+\.\d+\.\d+/));
    });

    it('should display profile help when profile --help is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, 'profile', '--help'], {
        env: getTestEnv(testHome),
      });
      assert(stdout.includes('profile'));
    });
  });
});

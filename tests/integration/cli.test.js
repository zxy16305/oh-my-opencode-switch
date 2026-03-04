import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../bin/oos.js');

describe('CLI Integration', () => {
  describe('Help commands', () => {
    it('should display help when --help is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, '--help']);
      assert(stdout.includes('Usage:'));
      assert(stdout.includes('Commands:'));
    });

    it('should display version when --version is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, '--version']);
      assert(stdout.match(/\d+\.\d+\.\d+/));
    });

    it('should display profile help when profile --help is used', async () => {
      const { stdout } = await execFileAsync('node', [cliPath, 'profile', '--help']);
      assert(stdout.includes('profile'));
    });
  });
});

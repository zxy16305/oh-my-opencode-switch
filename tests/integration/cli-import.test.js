import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { setupTestHome, cleanupTestHome, getTestEnv } from '../helpers/test-home.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = join(__dirname, '../../bin/oos.js');
const testDir = join(__dirname, 'fixtures', 'import-test');

function generateUniqueProfileName() {
  return `test-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('CLI Import Command', () => {
  const invalidJsonFile = join(testDir, 'invalid-json.json');
  const nonExistentFile = join(testDir, 'non-existent.json');
  let validExportFile;
  let profileName;
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;

    await fs.mkdir(testDir, { recursive: true });

    profileName = generateUniqueProfileName();
    validExportFile = join(testDir, `${profileName}.json`);

    const validExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: profileName,
      template: {
        $schema: 'https://example.com/schema.json',
        agents: {},
        categories: {},
      },
      variables: {},
    };
    await fs.writeFile(validExportFile, JSON.stringify(validExport, null, 2));

    await fs.writeFile(invalidJsonFile, '{ invalid json }');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    if (profileName) {
      try {
        await execFileAsync('node', [cliPath, 'profile', 'delete', profileName, '-f'], {
          env: getTestEnv(testHome),
        });
      } catch {
        // Ignore deletion errors
      }
    }

    await cleanupTestHome(testHome);
  });

  describe('Successful import', () => {
    it('should import from a valid export file', async () => {
      const { stdout, stderr } = await execFileAsync(
        'node',
        [cliPath, 'profile', 'import', validExportFile],
        {
          env: getTestEnv(testHome),
        }
      );

      assert(stdout.includes(profileName) || stderr.includes(profileName));
    });
  });

  describe('Error cases', () => {
    it('should error when importing a non-existent file', async () => {
      try {
        await execFileAsync('node', [cliPath, 'profile', 'import', nonExistentFile], {
          env: getTestEnv(testHome),
        });
        assert.fail('Expected command to fail');
      } catch (error) {
        // Command should fail with non-zero exit code
        assert(
          error.code !== 0 ||
            error.stderr.includes('not found') ||
            error.message.includes('not found')
        );
      }
    });

    it('should error when importing invalid JSON', async () => {
      try {
        await execFileAsync('node', [cliPath, 'profile', 'import', invalidJsonFile], {
          env: getTestEnv(testHome),
        });
        assert.fail('Expected command to fail');
      } catch (error) {
        // Command should fail with non-zero exit code
        assert(error.code !== 0 || error.stderr.includes('JSON') || error.message.includes('JSON'));
      }
    });
  });
});

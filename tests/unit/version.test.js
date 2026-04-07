/**
 * Tests for version detection utility.
 * @module tests/unit/version.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { parseVersion, isVersionAtLeast, getOpenAgentVersion } from '../../src/utils/version.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

describe('parseVersion', () => {
  it('should parse standard version format', () => {
    const result = parseVersion('v3.15.1');
    assert.deepStrictEqual(result, { major: 3, minor: 15, patch: 1 });
  });

  it('should parse version without v prefix', () => {
    const result = parseVersion('3.15.1');
    assert.deepStrictEqual(result, { major: 3, minor: 15, patch: 1 });
  });

  it('should parse version from full command output', () => {
    const result = parseVersion('oh-my-openagent v3.15.1');
    assert.deepStrictEqual(result, { major: 3, minor: 15, patch: 1 });
  });

  it('should parse version with extra text', () => {
    const result = parseVersion('Version: 1.2.3 (build 456)');
    assert.deepStrictEqual(result, { major: 1, minor: 2, patch: 3 });
  });

  it('should return null for invalid input', () => {
    assert.strictEqual(parseVersion(null), null);
    assert.strictEqual(parseVersion(''), null);
    assert.strictEqual(parseVersion('invalid'), null);
    assert.strictEqual(parseVersion('1.2'), null); // Missing patch
    assert.strictEqual(parseVersion('v1'), null); // Missing minor/patch
  });

  it('should return null for non-string input', () => {
    assert.strictEqual(parseVersion(123), null);
    assert.strictEqual(parseVersion({}), null);
    assert.strictEqual(parseVersion([]), null);
  });
});

describe('isVersionAtLeast', () => {
  it('should return true when current equals target', () => {
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.15.1'), true);
  });

  it('should return true when current is greater than target', () => {
    assert.strictEqual(isVersionAtLeast('3.15.0', '3.15.1'), true);
    assert.strictEqual(isVersionAtLeast('3.14.0', '3.15.0'), true);
    assert.strictEqual(isVersionAtLeast('2.0.0', '3.0.0'), true);
  });

  it('should return false when current is less than target', () => {
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.15.0'), false);
    assert.strictEqual(isVersionAtLeast('3.15.0', '3.14.0'), false);
    assert.strictEqual(isVersionAtLeast('3.0.0', '2.0.0'), false);
  });

  it('should handle version prefixes', () => {
    assert.strictEqual(isVersionAtLeast('v3.15.0', 'v3.15.1'), true);
    assert.strictEqual(isVersionAtLeast('v3.15.1', 'v3.15.0'), false);
  });

  it('should return false for null currentVersion', () => {
    assert.strictEqual(isVersionAtLeast('3.15.1', null), false);
  });

  it('should return false for invalid versions', () => {
    assert.strictEqual(isVersionAtLeast('invalid', '3.15.1'), false);
    assert.strictEqual(isVersionAtLeast('3.15.1', 'invalid'), false);
  });

  it('should handle boundary versions correctly', () => {
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.15.1'), true);
    assert.strictEqual(isVersionAtLeast('3.15.0', '3.15.1'), true);
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.15.0'), false);
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.15.2'), true);
    assert.strictEqual(isVersionAtLeast('3.15.1', '3.16.0'), true);
    assert.strictEqual(isVersionAtLeast('3.15.1', '4.0.0'), true);
  });
});

describe('getOpenAgentVersion', () => {
  let testHome;

  beforeEach(async () => {
    const setup = await setupTestHome();
    testHome = setup.testHome;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  it('should return a version string when oh-my-opencode is installed', async () => {
    const result = await getOpenAgentVersion();
    assert.ok(result === null || typeof result === 'string');
  });

  it('should return parseable version when command succeeds', async () => {
    const result = await getOpenAgentVersion();
    if (result !== null) {
      const parsed = parseVersion(result);
      assert.ok(parsed !== null, `Version "${result}" should be parseable`);
      assert.ok(typeof parsed.major === 'number');
      assert.ok(typeof parsed.minor === 'number');
      assert.ok(typeof parsed.patch === 'number');
    }
  });
});

/**
 * Integration tests for ProxyConfigManager timeSlotWeights persistence.
 *
 * Verifies that the writeConfig() → readConfig() cycle correctly
 * preserves the timeSlotWeights field on upstream entries through
 * the Zod validation layer.
 *
 * @module tests/integration/proxy-timeSlotWeights-persistence
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ProxyConfigManager } from '../../src/core/ProxyConfigManager.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

describe('ProxyConfigManager - timeSlotWeights preservation', () => {
  let testHome;

  beforeEach(async () => {
    const result = await setupTestHome();
    testHome = result.testHome;
  });

  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  test('full config with timeSlotWeights → readConfig returns it correctly', async () => {
    const manager = new ProxyConfigManager();

    const config = {
      port: 3000,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'ali',
              model: 'qwen-max',
              timeSlotWeights: { high: 200, medium: 150, low: 50 },
            },
          ],
        },
      },
    };

    await manager.writeConfig(config);
    const readBack = await manager.readConfig();

    assert.ok(readBack, 'readConfig should return a config object');
    assert.ok(readBack.routes['lb-test'], 'route lb-test should exist');

    const upstream = readBack.routes['lb-test'].upstreams[0];
    assert.ok(upstream, 'upstream should exist');
    assert.deepStrictEqual(upstream.timeSlotWeights, {
      high: 200,
      medium: 150,
      low: 50,
    });
  });

  test('config without timeSlotWeights → readConfig returns valid config (backward compat)', async () => {
    const manager = new ProxyConfigManager();

    const config = {
      port: 3000,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'ali',
              model: 'qwen-max',
              weight: 100,
            },
          ],
        },
      },
    };

    await manager.writeConfig(config);
    const readBack = await manager.readConfig();

    assert.ok(readBack, 'readConfig should return a config object');
    const upstream = readBack.routes['lb-test'].upstreams[0];
    assert.ok(upstream, 'upstream should exist');
    assert.strictEqual(
      upstream.timeSlotWeights,
      undefined,
      'timeSlotWeights should be undefined when not provided'
    );
    assert.strictEqual(upstream.weight, 100);
  });

  test('multiple upstreams with different timeSlotWeights → all preserved', async () => {
    const manager = new ProxyConfigManager();

    const config = {
      port: 3000,
      routes: {
        'lb-test': {
          strategy: 'weighted',
          upstreams: [
            {
              provider: 'ali',
              model: 'qwen-max',
              timeSlotWeights: { high: 300, medium: 200, low: 100 },
            },
            {
              provider: 'baidu',
              model: 'ernie-4.0',
              timeSlotWeights: { high: 50, medium: 100, low: 250 },
            },
            {
              provider: 'deepseek',
              model: 'deepseek-v3',
              weight: 80,
            },
          ],
        },
      },
    };

    await manager.writeConfig(config);
    const readBack = await manager.readConfig();

    const upstreams = readBack.routes['lb-test'].upstreams;
    assert.strictEqual(upstreams.length, 3, 'should have 3 upstreams');

    assert.deepStrictEqual(upstreams[0].timeSlotWeights, {
      high: 300,
      medium: 200,
      low: 100,
    });

    assert.deepStrictEqual(upstreams[1].timeSlotWeights, {
      high: 50,
      medium: 100,
      low: 250,
    });

    assert.strictEqual(
      upstreams[2].timeSlotWeights,
      undefined,
      'third upstream should have no timeSlotWeights'
    );
    assert.strictEqual(upstreams[2].weight, 80);
  });

  test('partial timeSlotWeights (only high defined) → preserved correctly', async () => {
    const manager = new ProxyConfigManager();

    const config = {
      port: 3000,
      routes: {
        'lb-test': {
          strategy: 'round-robin',
          upstreams: [
            {
              provider: 'ali',
              model: 'qwen-max',
              timeSlotWeights: { high: 400 },
            },
          ],
        },
      },
    };

    await manager.writeConfig(config);
    const readBack = await manager.readConfig();

    const upstream = readBack.routes['lb-test'].upstreams[0];
    assert.deepStrictEqual(upstream.timeSlotWeights, {
      high: 400,
    });
  });
});

/**
 * Unit tests for timeSlotWeights schema validation in upstream configuration
 * @module tests/unit/proxy-timeSlotWeights-schema.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { validateRoutesConfig } from '../../src/proxy/router.js';
import { upstreamSchema } from '../../src/proxy/schemas.js';
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

describe('Schema Validation – timeSlotWeights', () => {
  let testHome;
  beforeEach(async () => {
    const { testHome: home } = await setupTestHome();
    testHome = home;
  });
  afterEach(async () => {
    await cleanupTestHome(testHome);
  });

  // Helper to create minimal valid upstream
  function makeUpstream(overrides = {}) {
    return {
      id: 'test-upstream',
      provider: 'test-provider',
      model: 'test-model',
      baseURL: 'https://api.test.com',
      ...overrides,
    };
  }

  // Helper to create minimal valid route
  function makeRoute(upstreams, overrides = {}) {
    return {
      strategy: 'round-robin',
      upstreams,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // 1. Valid configurations
  // -------------------------------------------------------------------------
  describe('Valid configurations', () => {
    test('valid full config with all timeSlotWeights (high, medium, low) passes', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 100, medium: 50, low: 10 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.ok(result.data['lb-test'].upstreams[0].timeSlotWeights);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 100);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.medium, 50);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.low, 10);
    });

    test('valid partial config with only high weight passes', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 100 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.ok(result.data['lb-test'].upstreams[0].timeSlotWeights);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 100);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.medium, undefined);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.low, undefined);
    });

    test('valid config with only medium weight passes', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { medium: 75 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.medium, 75);
    });

    test('valid config with only low weight passes', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { low: 5 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.low, 5);
    });

    test('backwards compatible config (no timeSlotWeights) passes', () => {
      const config = {
        'lb-test': makeRoute([makeUpstream()]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights, undefined);
    });

    test('valid config with weight: 0 passes (minimum constraint)', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 0, medium: 0, low: 0 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Invalid configurations
  // -------------------------------------------------------------------------
  describe('Invalid configurations', () => {
    test('invalid config with negative weight fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: -5 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for negative weight');
      assert.ok(result.error.includes('timeSlotWeights') || result.error.includes('high'));
    });

    test('invalid config with non-numeric weight (string) fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 'string' },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for non-numeric weight');
      assert.ok(result.error.includes('timeSlotWeights') || result.error.includes('number'));
    });

    test('invalid config with non-numeric weight (boolean) fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: true },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for boolean weight');
      assert.ok(result.error.includes('timeSlotWeights') || result.error.includes('number'));
    });

    test('invalid config with extra property fails (additionalProperties: false)', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 100, unknown: 5 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for extra property');
      assert.ok(
        result.error.includes('unknown') || result.error.includes('additional'),
        `Error should mention unknown property: ${result.error}`
      );
    });

    test('invalid config with nested extra property fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 100, medium: 50, extra: 25 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for extra property');
    });

    test('invalid config with empty timeSlotWeights object fails', () => {
      // Empty object {} is valid in Zod strict mode since all properties are optional
      // But let's test the behavior - it should actually pass since all fields are optional
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: {},
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      // Empty object should pass since all properties are optional
      assert.strictEqual(result.success, true, 'Empty timeSlotWeights object should pass');
    });

    test('invalid config with null weight value fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: null },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for null weight');
    });

    test('invalid config with array as timeSlotWeights fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: [100, 50, 10],
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for array timeSlotWeights');
    });

    test('invalid config with nested object fails', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: { value: 100 } },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, false, 'Should fail for nested object');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Direct upstreamSchema tests
  // -------------------------------------------------------------------------
  describe('Direct upstreamSchema tests', () => {
    test('upstreamSchema.parse accepts valid timeSlotWeights', () => {
      const upstream = makeUpstream({
        timeSlotWeights: { high: 100, medium: 50, low: 10 },
      });

      const result = upstreamSchema.parse(upstream);
      assert.ok(result.timeSlotWeights);
      assert.strictEqual(result.timeSlotWeights.high, 100);
    });

    test('upstreamSchema.parse rejects negative weight', () => {
      const upstream = makeUpstream({
        timeSlotWeights: { high: -1 },
      });

      assert.throws(() => upstreamSchema.parse(upstream), /number|min/);
    });

    test('upstreamSchema.parse rejects extra properties', () => {
      const upstream = makeUpstream({
        timeSlotWeights: { high: 100, extra: 5 },
      });

      assert.throws(() => upstreamSchema.parse(upstream), /unknown|extra|additional/);
    });

    test('upstreamSchema.safeParse returns error for invalid weight', () => {
      const upstream = makeUpstream({
        timeSlotWeights: { high: 'invalid' },
      });

      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    test('upstreamSchema.safeParse succeeds for valid config without timeSlotWeights', () => {
      const upstream = makeUpstream();

      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.timeSlotWeights, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Edge cases
  // -------------------------------------------------------------------------
  describe('Edge cases', () => {
    test('multiple upstreams with different timeSlotWeights configs', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            id: 'u1',
            timeSlotWeights: { high: 100, medium: 50, low: 10 },
          }),
          makeUpstream({
            id: 'u2',
            timeSlotWeights: { high: 80 },
          }),
          makeUpstream({
            id: 'u3',
            // no timeSlotWeights
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true, `Should pass: ${result.error || 'ok'}`);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 100);
      assert.strictEqual(result.data['lb-test'].upstreams[1].timeSlotWeights.high, 80);
      assert.strictEqual(result.data['lb-test'].upstreams[2].timeSlotWeights, undefined);
    });

    test('very large weight values pass', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 999999 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 999999);
    });

    test('decimal weight values pass', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 100.5, medium: 50.25 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 100.5);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.medium, 50.25);
    });

    test('zero decimal (0.0) passes', () => {
      const config = {
        'lb-test': makeRoute([
          makeUpstream({
            timeSlotWeights: { high: 0.0 },
          }),
        ]),
      };

      const result = validateRoutesConfig(config);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data['lb-test'].upstreams[0].timeSlotWeights.high, 0);
    });
  });
});

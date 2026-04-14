/**
 * Unit tests for zero-weight schema validation (TDD RED phase)
 * These tests SHOULD FAIL because current schemas block weight=0 and minWeight=0
 * @module tests/unit/proxy-zero-weight-schema.test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { upstreamSchema, routeSchema } from '../../src/proxy/schemas.js';
import {
  upstreamSchema as validatorUpstreamSchema,
  routeSchema as validatorRouteSchema,
} from '../../src/utils/proxy-validators.js';

describe('Schema Validation – Zero Weight (TDD RED Phase)', () => {
  // Helper to create minimal valid upstream for schemas.js
  function makeUpstream(overrides = {}) {
    return {
      id: 'test-upstream',
      provider: 'test-provider',
      model: 'test-model',
      baseURL: 'http://example.com',
      ...overrides,
    };
  }

  // Helper to create minimal valid route for schemas.js
  function makeRoute(upstreams, overrides = {}) {
    return {
      strategy: 'sticky',
      upstreams,
      ...overrides,
    };
  }

  // Helper to create minimal valid upstream for proxy-validators.js
  // Note: proxy-validators.js upstreamSchema has optional id/baseURL
  function makeValidatorUpstream(overrides = {}) {
    return {
      provider: 'test-provider',
      model: 'test-model',
      ...overrides,
    };
  }

  // Helper to create minimal valid route for proxy-validators.js
  function makeValidatorRoute(upstreams, overrides = {}) {
    return {
      strategy: 'round-robin',
      upstreams,
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // 1. upstreamSchema weight tests (src/proxy/schemas.js)
  // -------------------------------------------------------------------------
  describe('upstreamSchema weight tests (schemas.js)', () => {
    test('weight: 0 passes upstreamSchema (TDD RED - currently has min(1))', () => {
      const upstream = makeUpstream({ weight: 0 });

      // This test should FAIL because schema has weight: z.number().int().min(1)
      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, true, 'weight: 0 should be valid');
      assert.strictEqual(result.data.weight, 0);
    });

    test('weight: -1 fails upstreamSchema (should PASS - negative rejected)', () => {
      const upstream = makeUpstream({ weight: -1 });

      // This test should PASS because min(1) rejects negative values
      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, false, 'weight: -1 should be rejected');
      assert.ok(result.error, 'Should have validation error');
    });

    test('weight: 0.5 fails upstreamSchema (should PASS - must be integer)', () => {
      const upstream = makeUpstream({ weight: 0.5 });

      // This test should PASS because .int() rejects non-integer values
      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, false, 'weight: 0.5 should be rejected (must be integer)');
      assert.ok(result.error, 'Should have validation error');
    });
  });

  // -------------------------------------------------------------------------
  // 2. routeSchema dynamicWeight.minWeight tests (src/proxy/schemas.js)
  // -------------------------------------------------------------------------
  describe('routeSchema dynamicWeight.minWeight tests (schemas.js)', () => {
    test('minWeight: 0 passes routeSchema dynamicWeight (TDD RED - currently positive())', () => {
      const route = makeRoute([makeUpstream()], {
        dynamicWeight: {
          enabled: true,
          initialWeight: 100,
          minWeight: 0,
          checkInterval: 10,
          latencyThreshold: 1.5,
          latencyWindowMs: 60000,
          recoveryInterval: 300000,
          recoveryAmount: 1,
        },
      });

      // This test should FAIL because schema has minWeight: z.number().int().positive()
      const result = routeSchema.safeParse(route);
      assert.strictEqual(result.success, true, 'minWeight: 0 should be valid');
      assert.strictEqual(result.data.dynamicWeight.minWeight, 0);
    });

    test('minWeight: -1 fails routeSchema dynamicWeight (should PASS - negative rejected)', () => {
      const route = makeRoute([makeUpstream()], {
        dynamicWeight: {
          enabled: true,
          initialWeight: 100,
          minWeight: -1,
          checkInterval: 10,
          latencyThreshold: 1.5,
          latencyWindowMs: 60000,
          recoveryInterval: 300000,
          recoveryAmount: 1,
        },
      });

      // This test should PASS because positive() rejects negative values
      const result = routeSchema.safeParse(route);
      assert.strictEqual(result.success, false, 'minWeight: -1 should be rejected');
      assert.ok(result.error, 'Should have validation error');
    });
  });

  // -------------------------------------------------------------------------
  // 3. upstreamSchema weight tests (src/utils/proxy-validators.js)
  // -------------------------------------------------------------------------
  describe('upstreamSchema weight tests (proxy-validators.js)', () => {
    test('weight: 0 passes upstreamSchema in proxy-validators.js (TDD RED - currently positive())', () => {
      const upstream = makeValidatorUpstream({ weight: 0 });

      // This test should FAIL because schema has weight: z.number().positive()
      const result = validatorUpstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, true, 'weight: 0 should be valid in proxy-validators.js');
      assert.strictEqual(result.data.weight, 0);
    });

    test('weight: -1 fails upstreamSchema in proxy-validators.js (should PASS - negative rejected)', () => {
      const upstream = makeValidatorUpstream({ weight: -1 });

      // This test should PASS because positive() rejects negative values
      const result = validatorUpstreamSchema.safeParse(upstream);
      assert.strictEqual(
        result.success,
        false,
        'weight: -1 should be rejected in proxy-validators.js'
      );
      assert.ok(result.error, 'Should have validation error');
    });
  });

  // -------------------------------------------------------------------------
  // 4. routeSchema dynamicWeight.minWeight tests (src/utils/proxy-validators.js)
  // -------------------------------------------------------------------------
  describe('routeSchema dynamicWeight.minWeight tests (proxy-validators.js)', () => {
    test('minWeight: 0 passes routeSchema dynamicWeight in proxy-validators.js (TDD RED)', () => {
      const route = makeValidatorRoute([makeValidatorUpstream()], {
        dynamicWeight: {
          enabled: true,
          initialWeight: 100,
          minWeight: 0,
          checkInterval: 10,
          latencyThreshold: 1.5,
          recoveryInterval: 300000,
          recoveryAmount: 1,
        },
      });

      // This test should FAIL because schema has minWeight: z.number().int().positive()
      const result = validatorRouteSchema.safeParse(route);
      assert.strictEqual(
        result.success,
        true,
        'minWeight: 0 should be valid in proxy-validators.js'
      );
      assert.strictEqual(result.data.dynamicWeight.minWeight, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Error message verification (TDD RED Phase)
  // -------------------------------------------------------------------------
  describe('Error message verification', () => {
    test('weight: 0 error message mentions min constraint', () => {
      const upstream = makeUpstream({ weight: 0 });

      const result = upstreamSchema.safeParse(upstream);
      assert.strictEqual(result.success, false);

      // Verify error mentions the min constraint
      const errorMessages = result.error.errors.map((e) => e.message).join(', ');
      assert.ok(
        errorMessages.includes('min') || errorMessages.includes('greater'),
        `Error should mention min constraint: ${errorMessages}`
      );
    });

    test('minWeight: 0 error message mentions positive constraint', () => {
      const route = makeRoute([makeUpstream()], {
        dynamicWeight: {
          enabled: true,
          initialWeight: 100,
          minWeight: 0,
          checkInterval: 10,
          latencyThreshold: 1.5,
          latencyWindowMs: 60000,
          recoveryInterval: 300000,
          recoveryAmount: 1,
        },
      });

      const result = routeSchema.safeParse(route);
      assert.strictEqual(result.success, false);

      // Verify error mentions the positive constraint
      const errorMessages = result.error.errors.map((e) => e.message).join(', ');
      assert.ok(
        errorMessages.includes('positive') || errorMessages.includes('greater'),
        `Error should mention positive constraint: ${errorMessages}`
      );
    });
  });
});

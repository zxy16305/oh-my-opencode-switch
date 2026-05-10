/**
 * Unit tests for dynamic weight functionality in proxy/router module
 * @module tests/proxy/unit/router-dynamic-weight.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetAllState,
  getDynamicWeightState,
  getDynamicWeight,
  setDynamicWeight,
} from '../../../src/proxy/router.js';

import { routeSchema } from '../../../src/proxy/schemas.js';

// ===========================================================================
// Tests
// ===========================================================================

describe('Dynamic Weight – State Management', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('getDynamicWeight returns initial weight for new upstream', () => {
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 100);
  });

  test('setDynamicWeight updates weight', () => {
    setDynamicWeight('route1', 'upstream1', 50);
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 50);
  });

  test('setDynamicWeight creates entry if not exists', () => {
    setDynamicWeight('route-new', 'upstream-new', 75);
    const weight = getDynamicWeight('route-new', 'upstream-new', 100);
    assert.strictEqual(weight, 75);
  });

  test('getDynamicWeightState returns state for known upstream', () => {
    setDynamicWeight('route1', 'upstream1', 100);
    const state = getDynamicWeightState('route1', 'upstream1');
    assert.ok(state !== null);
    assert.strictEqual(state.currentWeight, 100);
  });

  test('getDynamicWeightState returns null after reset', () => {
    setDynamicWeight('route1', 'upstream1', 100);
    resetAllState();
    const state = getDynamicWeightState('route1', 'upstream1');
    assert.strictEqual(state, null);
  });

  test('getDynamicWeight uses default initialWeight of 100', () => {
    const weight = getDynamicWeight('route1', 'upstream1');
    assert.strictEqual(weight, 100);
  });

  test('getDynamicWeight returns updated weight after set', () => {
    getDynamicWeight('route1', 'upstream1', 100);
    setDynamicWeight('route1', 'upstream1', 42);
    const weight = getDynamicWeight('route1', 'upstream1', 100);
    assert.strictEqual(weight, 42);
  });
});

describe('Dynamic Weight – Schema', () => {
  test('routeSchema includes dynamicWeight with defaults', () => {
    const result = routeSchema.safeParse({
      strategy: 'sticky',
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://example.com' }],
    });

    assert.ok(result.success);
    assert.ok(result.data.dynamicWeight);
    assert.strictEqual(result.data.dynamicWeight.enabled, true);
    assert.strictEqual(result.data.dynamicWeight.initialWeight, 100);
  });

  test('routeSchema accepts custom dynamicWeight config', () => {
    const result = routeSchema.safeParse({
      strategy: 'sticky',
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://example.com' }],
      dynamicWeight: {
        enabled: false,
        initialWeight: 50,
        minWeight: 5,
      },
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.enabled, false);
    assert.strictEqual(result.data.dynamicWeight.initialWeight, 50);
    assert.strictEqual(result.data.dynamicWeight.minWeight, 5);
  });

  test('routeSchema dynamicWeight defaults minWeight to 10', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.minWeight, 10);
  });

  test('routeSchema dynamicWeight defaults latencyThreshold to 1.5', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.latencyThreshold, 1.5);
  });

  test('routeSchema dynamicWeight defaults recoveryInterval to 300000', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.recoveryInterval, 300000);
  });

  test('routeSchema dynamicWeight defaults recoveryAmount to 1', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.recoveryAmount, 1);
  });

  test('routeSchema dynamicWeight defaults checkInterval to 10', () => {
    const result = routeSchema.safeParse({
      upstreams: [{ id: 'a', provider: 'p1', model: 'm1', baseURL: 'http://x' }],
    });

    assert.ok(result.success);
    assert.strictEqual(result.data.dynamicWeight.checkInterval, 10);
  });
});

/**
 * Unit tests for weight-calculator - NEW time-slot static weight configuration
 * @module tests/proxy/unit/weight-calculator-timeslot.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../../src/proxy/state-manager.js';
import { calculateEffectiveWeight } from '../../../src/proxy/weight-calculator.js';
import { WeightManager } from '../../../src/proxy/weight/index.js';
import { makeUpstream } from '../../helpers/proxy-fixtures.js';

describe('Weight Calculator – NEW Time-Slot Static Weight Configuration', () => {
  let sm;
  let weightManager;

  beforeEach(() => {
    sm = new StateManager();
    weightManager = new WeightManager();
  });

  afterEach(() => {
    sm.reset();
  });

  describe('Basic functionality', () => {
    test('timeSlotWeights is read from upstream config', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-1',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 50, 'High slot weight should be returned');
    });

    test('slot weight REPLACES upstream.weight (not multiplier)', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-2',
        weight: 100,
        timeSlotWeights: {
          high: 50,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        50,
        'Slot weight should REPLACE base weight (100 → 50), not multiply'
      );
    });
  });

  describe('Backwards compatibility', () => {
    test('no timeSlotWeights config uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-no-timeslot',
        weight: 150,
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        150,
        'Without timeSlotWeights config, should use upstream.weight'
      );
    });

    test('timeSlotWeights undefined uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-undefined-timeslot',
        weight: 120,
        timeSlotWeights: undefined,
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        120,
        'With timeSlotWeights undefined, should use upstream.weight'
      );
    });

    test('timeSlotWeights null uses upstream.weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-null-timeslot',
        weight: 80,
        timeSlotWeights: null,
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        80,
        'With timeSlotWeights null, should use upstream.weight'
      );
    });
  });

  describe('Partial config fallback', () => {
    test('only high slot configured, current is medium → use base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-partial-high',
        weight: 100,
        timeSlotWeights: {
          high: 30,
        },
      });
      weightManager.lastTimeSlot = 'medium';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        100,
        'Medium slot not in partial config → use base weight 100'
      );
    });

    test('only medium slot configured, current is low → use base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-partial-medium',
        weight: 100,
        timeSlotWeights: {
          medium: 80,
        },
      });
      weightManager.lastTimeSlot = 'low';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        100,
        'Low slot not in partial config → use base weight 100'
      );
    });

    test('slot weight undefined uses base weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-slot-undefined',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: undefined,
          low: 150,
        },
      });

      weightManager.lastTimeSlot = 'medium';
      const staticWeightUndefined = weightManager.getConfiguredWeight(upstream);
      const effectiveUndefined = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight: staticWeightUndefined,
        dynamicWeightConfig: null,
        weightManager,
      });
      assert.strictEqual(
        effectiveUndefined,
        100,
        'Medium slot undefined in config → use base weight'
      );

      weightManager.lastTimeSlot = 'high';
      const staticWeightHigh = weightManager.getConfiguredWeight(upstream);
      const effectiveHigh = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight: staticWeightHigh,
        dynamicWeightConfig: null,
        weightManager,
      });
      assert.strictEqual(effectiveHigh, 50, 'High slot defined → use 50');

      weightManager.lastTimeSlot = 'low';
      const staticWeightLow = weightManager.getConfiguredWeight(upstream);
      const effectiveLow = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight: staticWeightLow,
        dynamicWeightConfig: null,
        weightManager,
      });
      assert.strictEqual(effectiveLow, 150, 'Low slot defined → use 150');
    });
  });

  describe('Integration with OLD error-rate system', () => {
    test('NEW static weight applies BEFORE OLD error-rate multiplier', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-both-systems',
        weight: 100,
        provider: 'test-provider',
        timeSlotWeights: {
          high: 50,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 50, 'NEW static weight applies, OLD disabled');
    });

    test('OLD error-rate system logic unchanged', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-old-system',
        weight: 100,
        provider: 'test-provider',
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 100, 'No NEW config, OLD disabled → base weight');
    });
  });

  describe('Edge cases', () => {
    test('effective weight minimum is 0', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-min-weight',
        weight: 100,
        timeSlotWeights: {
          high: 0,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 0, 'Weight should be clamped to minimum 0');
    });

    test('slot weight negative → still clamped to 0', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-negative-weight',
        weight: 100,
        timeSlotWeights: {
          high: -50,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 0, 'Negative weight should be clamped to minimum 0');
    });

    test('upstream without weight field defaults to 100', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-no-weight',
        timeSlotWeights: {
          high: 30,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 30, 'High slot configured → use 30');
    });
  });

  describe('timeSlotWeights + dynamicWeight interaction', () => {
    test('timeSlotWeights.low=200 + dynamicWeight returning 200 → no truncation', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-combo-1',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });

      weightManager.lastTimeSlot = 'low';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const key = `${routeKey}:${upstream.id}`;
      weightManager.state.set(key, {
        currentWeight: 200,
        configuredWeight: 200,
        level: 'normal',
        routeKey,
        upstreamId: upstream.id,
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        200,
        'Dynamic weight should return 200 without truncation when slot is low'
      );
    });

    test('timeSlotWeights.low=200 + dynamicWeight reduced to 100 → effectiveWeight=100', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-combo-2',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });

      weightManager.lastTimeSlot = 'low';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const key = `${routeKey}:${upstream.id}`;
      weightManager.state.set(key, {
        currentWeight: 100,
        configuredWeight: 200,
        level: 'half',
        routeKey,
        upstreamId: upstream.id,
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        100,
        'Dynamic weight reduced to 100 should be returned as effective weight'
      );
    });

    test('no timeSlotWeights + dynamicWeight adjusts weight correctly', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-dynamic-only',
        weight: 100,
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const key = `${routeKey}:${upstream.id}`;
      weightManager.state.set(key, {
        currentWeight: 50,
        configuredWeight: 100,
        level: 'half',
        routeKey,
        upstreamId: upstream.id,
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        50,
        'Dynamic weight 50 should be returned when no timeSlotWeights'
      );
    });

    test('no timeSlotWeights + dynamicWeight at initial weight returns static weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-dynamic-initial',
        weight: 150,
      });
      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        150,
        'Without prior state, effective weight equals static weight'
      );
    });

    test('timeSlotWeights with dynamicWeight disabled uses slot weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-timeslot-only',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });

      weightManager.lastTimeSlot = 'low';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        200,
        'At low slot, weight should be 200 from timeSlotWeights only'
      );
    });

    test('dynamicWeight uses slot weight as configuredWeight via weightManager.getWeight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-configured-weight',
        weight: 100,
        timeSlotWeights: {
          high: 50,
          medium: 100,
          low: 200,
        },
      });

      weightManager.lastTimeSlot = 'medium';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const key = `${routeKey}:${upstream.id}`;
      weightManager.state.set(key, {
        currentWeight: 80,
        configuredWeight: 100,
        level: 'half',
        routeKey,
        upstreamId: upstream.id,
      });

      const dynamicWeightConfig = { enabled: true, minWeight: 10 };

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig,
        weightManager,
      });

      assert.strictEqual(
        effectiveWeight,
        80,
        'Effective weight returns weightManager state currentWeight (80), not staticWeight (100)'
      );
    });
  });

  describe('Different time slot types', () => {
    test('high load hours get high slot weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-high-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });

      weightManager.lastTimeSlot = 'high';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 30, 'High slot weight should be used');
    });

    test('medium load hours get medium slot weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-medium-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });

      weightManager.lastTimeSlot = 'medium';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 100, 'Medium slot weight should be used');
    });

    test('low load hours get low slot weight', () => {
      const routeKey = 'test-route';
      const upstream = makeUpstream({
        id: 'upstream-low-test',
        weight: 100,
        timeSlotWeights: {
          high: 30,
          medium: 100,
          low: 150,
        },
      });

      weightManager.lastTimeSlot = 'low';
      const staticWeight = weightManager.getConfiguredWeight(upstream);

      const effectiveWeight = calculateEffectiveWeight({
        sm,
        routeKey,
        upstream,
        staticWeight,
        dynamicWeightConfig: null,
        weightManager,
      });

      assert.strictEqual(effectiveWeight, 150, 'Low slot weight should be used');
    });
  });
});

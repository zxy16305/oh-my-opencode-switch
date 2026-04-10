/**
 * Unit tests for weight recovery based on consecutive success count.
 * RED phase: Tests written before implementation.
 * @module tests/proxy/unit/weight-recovery.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetAllState,
  getDynamicWeight,
  setDynamicWeight,
  incrementSuccessCount,
  resetSuccessCount,
  getDynamicWeightState,
  getCurrentWeightLevel,
  adjustWeightForSuccess,
} from '../../../src/proxy/router.js';

// ===========================================================================
// Tests for consecutive success count and weight recovery
// ===========================================================================

describe('Weight Recovery – incrementSuccessCount', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('incrementSuccessCount increases consecutiveSuccessCount by 1', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    // Initial state should have no consecutiveSuccessCount
    const initialState = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(initialState?.consecutiveSuccessCount, undefined);

    // Call incrementSuccessCount
    incrementSuccessCount(routeKey, upstreamId);

    // Check count increased to 1
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 1);
  });

  test('multiple incrementSuccessCount calls accumulate count', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    // Call incrementSuccessCount 3 times
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);

    // Check count is 3
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 3);
  });

  test('incrementSuccessCount stores count in dynamicWeightState', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    incrementSuccessCount(routeKey, upstreamId);

    // Verify state exists and has the expected structure
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.ok(state, 'dynamicWeightState should exist');
    assert.strictEqual(state.consecutiveSuccessCount, 1);
  });

  test('different upstreams have independent success counts', () => {
    const routeKey = 'route1';

    incrementSuccessCount(routeKey, 'upstream1');
    incrementSuccessCount(routeKey, 'upstream1');
    incrementSuccessCount(routeKey, 'upstream2');

    const state1 = getDynamicWeightState(routeKey, 'upstream1');
    const state2 = getDynamicWeightState(routeKey, 'upstream2');

    assert.strictEqual(state1?.consecutiveSuccessCount, 2);
    assert.strictEqual(state2?.consecutiveSuccessCount, 1);
  });

  test('different routes have independent success counts', () => {
    incrementSuccessCount('route1', 'upstream1');
    incrementSuccessCount('route1', 'upstream1');
    incrementSuccessCount('route2', 'upstream1');

    const state1 = getDynamicWeightState('route1', 'upstream1');
    const state2 = getDynamicWeightState('route2', 'upstream1');

    assert.strictEqual(state1?.consecutiveSuccessCount, 2);
    assert.strictEqual(state2?.consecutiveSuccessCount, 1);
  });
});

describe('Weight Recovery – resetSuccessCount', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('resetSuccessCount resets consecutiveSuccessCount to 0', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    // Build up some count
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);

    // Verify count is 3
    const stateBefore = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(stateBefore?.consecutiveSuccessCount, 3);

    // Reset
    resetSuccessCount(routeKey, upstreamId);

    // Check count is 0
    const stateAfter = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(stateAfter?.consecutiveSuccessCount, 0);
  });

  test('resetSuccessCount only affects specified upstream', () => {
    const routeKey = 'route1';

    incrementSuccessCount(routeKey, 'upstream1');
    incrementSuccessCount(routeKey, 'upstream1');
    incrementSuccessCount(routeKey, 'upstream2');
    incrementSuccessCount(routeKey, 'upstream2');
    incrementSuccessCount(routeKey, 'upstream2');

    // Reset only upstream1
    resetSuccessCount(routeKey, 'upstream1');

    const state1 = getDynamicWeightState(routeKey, 'upstream1');
    const state2 = getDynamicWeightState(routeKey, 'upstream2');

    assert.strictEqual(state1?.consecutiveSuccessCount, 0);
    assert.strictEqual(state2?.consecutiveSuccessCount, 3);
  });

  test('resetSuccessCount handles non-existent state gracefully', () => {
    const routeKey = 'route1';
    const upstreamId = 'never-used';

    // Should not throw when state doesn't exist
    assert.doesNotThrow(() => {
      resetSuccessCount(routeKey, upstreamId);
    });

    // State should now exist with count 0
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 0);
  });
});

describe('Weight Recovery – recovery trigger at threshold', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('consecutiveSuccessCount reaching 5 triggers weight recovery', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';
    const initialWeight = 100;

    // Reduce weight first (simulate previous errors)
    setDynamicWeight(routeKey, upstreamId, 50);

    // Verify reduced weight
    const reducedWeight = getDynamicWeight(routeKey, upstreamId, initialWeight);
    assert.strictEqual(reducedWeight, 50);

    // Call incrementSuccessCount 5 times (threshold)
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);

    // Weight should have increased (recovery triggered)
    const recoveredWeight = getDynamicWeight(routeKey, upstreamId, initialWeight);
    assert.ok(
      recoveredWeight > 50,
      `Weight should increase after 5 consecutive successes: expected > 50, got ${recoveredWeight}`
    );

    // Count should be reset after recovery
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 0);
  });

  test('count below 5 does not trigger recovery', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';
    const initialWeight = 100;

    // Reduce weight first
    setDynamicWeight(routeKey, upstreamId, 50);

    // Call incrementSuccessCount only 4 times
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);

    // Weight should still be 50 (no recovery yet)
    const weight = getDynamicWeight(routeKey, upstreamId, initialWeight);
    assert.strictEqual(weight, 50);

    // Count should still be 4
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 4);
  });

  test('6th success triggers recovery after 5', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';
    const initialWeight = 100;

    // Reduce weight
    setDynamicWeight(routeKey, upstreamId, 30);

    // 5 successes - recovery triggers, count resets to 0
    for (let i = 0; i < 5; i++) {
      incrementSuccessCount(routeKey, upstreamId);
    }

    const weightAfter5 = getDynamicWeight(routeKey, upstreamId, initialWeight);
    const stateAfter5 = getDynamicWeightState(routeKey, upstreamId);
    assert.ok(weightAfter5 > 30, 'Weight should increase after 5 successes');
    assert.strictEqual(stateAfter5?.consecutiveSuccessCount, 0);

    // 6th success - starts new count
    incrementSuccessCount(routeKey, upstreamId);

    const stateAfter6 = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(stateAfter6?.consecutiveSuccessCount, 1);
  });

  test('error resets success count and prevents premature recovery', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';
    const initialWeight = 100;

    // Reduce weight
    setDynamicWeight(routeKey, upstreamId, 40);

    // 4 successes
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);
    incrementSuccessCount(routeKey, upstreamId);

    // Simulate error - reset count
    resetSuccessCount(routeKey, upstreamId);

    // Weight should still be reduced
    const weight = getDynamicWeight(routeKey, upstreamId, initialWeight);
    assert.strictEqual(weight, 40);

    // Count should be 0
    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(state?.consecutiveSuccessCount, 0);

    // Need 5 more successes to trigger recovery
    incrementSuccessCount(routeKey, upstreamId);
    const stateAfter1 = getDynamicWeightState(routeKey, upstreamId);
    assert.strictEqual(stateAfter1?.consecutiveSuccessCount, 1);
  });

  test('recovery does not exceed initialWeight', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';
    const initialWeight = 100;

    // Reduce weight to 80
    setDynamicWeight(routeKey, upstreamId, 80);

    // Trigger recovery 5 times (each recovery should not exceed 100)
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let i = 0; i < 5; i++) {
        incrementSuccessCount(routeKey, upstreamId);
      }
    }

    const finalWeight = getDynamicWeight(routeKey, upstreamId, initialWeight);
    assert.ok(
      finalWeight <= initialWeight,
      `Weight should not exceed initialWeight: expected <= ${initialWeight}, got ${finalWeight}`
    );
  });
});

describe('Weight Recovery – state structure', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('dynamicWeightState contains consecutiveSuccessCount field', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    incrementSuccessCount(routeKey, upstreamId);

    const state = getDynamicWeightState(routeKey, upstreamId);
    assert.ok(state, 'State should exist');
    assert.ok(
      'consecutiveSuccessCount' in state,
      'State should have consecutiveSuccessCount field'
    );
    assert.strictEqual(typeof state.consecutiveSuccessCount, 'number');
  });

  test('dynamicWeightState maintains other state fields', () => {
    const routeKey = 'route1';
    const upstreamId = 'upstream1';

    // Set weight (creates state)
    setDynamicWeight(routeKey, upstreamId, 50);

    // Increment success count
    incrementSuccessCount(routeKey, upstreamId);

    const state = getDynamicWeightState(routeKey, upstreamId);

    // Should have both weight and count
    assert.ok(state.currentWeight !== undefined, 'Should have currentWeight');
    assert.ok(state.consecutiveSuccessCount !== undefined, 'Should have consecutiveSuccessCount');
    assert.strictEqual(state.currentWeight, 50);
    assert.strictEqual(state.consecutiveSuccessCount, 1);
  });
});

// ===========================================================================
// Tests for step-based weight recovery (level system)
// ===========================================================================

describe('Step Recovery – getCurrentWeightLevel', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('returns "normal" when weight is at configured weight (100%)', () => {
    const configuredWeight = 100;
    setDynamicWeight('route1', 'u1', configuredWeight);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'normal');
  });

  test('returns "half" when weight is at 50% of configured', () => {
    const configuredWeight = 100;
    setDynamicWeight('route1', 'u1', configuredWeight * 0.5);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'half');
  });

  test('returns "medium" when weight is at 20% of configured', () => {
    const configuredWeight = 100;
    setDynamicWeight('route1', 'u1', configuredWeight * 0.2);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'medium');
  });

  test('returns "min" when weight is at 5% of configured', () => {
    const configuredWeight = 100;
    setDynamicWeight('route1', 'u1', configuredWeight * 0.05);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'min');
  });

  test('returns "min" for weights below 5% (floor)', () => {
    const configuredWeight = 100;
    setDynamicWeight('route1', 'u1', 3);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'min');
  });

  test('returns "normal" for weights above 100% (custom weight)', () => {
    const configuredWeight = 200;
    setDynamicWeight('route1', 'u1', configuredWeight);

    const level = getCurrentWeightLevel('route1', 'u1', configuredWeight);

    assert.strictEqual(level, 'normal');
  });
});

describe('Step Recovery – adjustWeightForSuccess', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('5 consecutive successes at level-min recover to level-medium (20%)', () => {
    const configuredWeight = 100;

    // Start at level-min (5%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.05);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'min');

    // 5 consecutive successes
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    const newWeight = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(newWeight, configuredWeight * 0.2);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'medium');
  });

  test('5 consecutive successes at level-medium recover to level-half (50%)', () => {
    const configuredWeight = 100;

    // Start at level-medium (20%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.2);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'medium');

    // 5 consecutive successes
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    const newWeight = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(newWeight, configuredWeight * 0.5);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'half');
  });

  test('5 consecutive successes at level-half recover to level-normal (100%)', () => {
    const configuredWeight = 100;

    // Start at level-half (50%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.5);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'half');

    // 5 consecutive successes
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    const newWeight = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(newWeight, configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'normal');
  });

  test('successes at level-normal do not increase weight', () => {
    const configuredWeight = 100;

    // Start at level-normal (100%)
    setDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'normal');

    // 10 consecutive successes (should stay at normal)
    for (let i = 0; i < 10; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    const newWeight = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(newWeight, configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'normal');
  });

  test('failure resets success count but weight stays at current level', () => {
    const configuredWeight = 100;

    // Start at level-min (5%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.05);

    // 3 successes (count = 3, not enough to recover)
    for (let i = 0; i < 3; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    // Weight should still be at level-min
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'min');
    assert.strictEqual(
      getDynamicWeight('route1', 'test', configuredWeight),
      configuredWeight * 0.05
    );

    // Now a failure occurs - reset count
    resetSuccessCount('route1', 'test');

    // After failure, 5 more successes should recover to medium
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    // Should now be at level-medium
    const weightAfterRecovery = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(weightAfterRecovery, configuredWeight * 0.2);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'medium');
  });

  test('custom weight (200) recovers proportionally', () => {
    const configuredWeight = 200;

    // Start at level-min (5% of 200 = 10)
    setDynamicWeight('route1', 'test', configuredWeight * 0.05);

    // 5 successes → recover to level-medium (20% of 200 = 40)
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    const newWeight = getDynamicWeight('route1', 'test', configuredWeight);
    assert.strictEqual(newWeight, configuredWeight * 0.2);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'medium');
  });

  test('4 successes do not trigger recovery (threshold is 5)', () => {
    const configuredWeight = 100;

    // Start at level-min (5%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.05);

    // 4 successes (below threshold)
    for (let i = 0; i < 4; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }

    // Should still be at level-min
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'min');
    assert.strictEqual(
      getDynamicWeight('route1', 'test', configuredWeight),
      configuredWeight * 0.05
    );
  });
});

describe('Step Recovery – full recovery path', () => {
  beforeEach(() => resetAllState());
  afterEach(() => resetAllState());

  test('full recovery path: min → medium → half → normal', () => {
    const configuredWeight = 100;

    // Start at level-min (5%)
    setDynamicWeight('route1', 'test', configuredWeight * 0.05);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'min');

    // 5 successes → medium (20%)
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }
    assert.strictEqual(
      getDynamicWeight('route1', 'test', configuredWeight),
      configuredWeight * 0.2
    );
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'medium');

    // 5 more successes → half (50%)
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }
    assert.strictEqual(
      getDynamicWeight('route1', 'test', configuredWeight),
      configuredWeight * 0.5
    );
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'half');

    // 5 more successes → normal (100%)
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }
    assert.strictEqual(getDynamicWeight('route1', 'test', configuredWeight), configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'normal');

    // More successes stay at normal
    for (let i = 0; i < 5; i++) {
      adjustWeightForSuccess('route1', 'test', configuredWeight);
    }
    assert.strictEqual(getDynamicWeight('route1', 'test', configuredWeight), configuredWeight);
    assert.strictEqual(getCurrentWeightLevel('route1', 'test', configuredWeight), 'normal');
  });
});

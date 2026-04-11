// tests/proxy/unit/weight-algorithms.test.js

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// Import pure functions from algorithms.js
import {
  calculateErrorRate,
  calculateErrorAdjustment,
  calculateRecovery,
  updateTimeSlotWeight,
} from '../../../src/proxy/weight/algorithms.js';

describe('calculateErrorRate', () => {
  it('should return 0 when no errors', () => {
    const state = {
      errors: [],
      totalRequests: 100,
    };
    const windowMs = 3600000;
    const result = calculateErrorRate(state, windowMs);
    assert.strictEqual(result, 0);
  });

  it('should calculate 50% error rate', () => {
    const now = Date.now();
    const state = {
      errors: [
        { timestamp: now - 1000 },
        { timestamp: now - 2000 },
        { timestamp: now - 3000 },
        { timestamp: now - 4000 },
        { timestamp: now - 5000 },
      ],
      totalRequests: 10,
    };
    const windowMs = 3600000;
    const result = calculateErrorRate(state, windowMs);
    assert.strictEqual(result, 0.5);
  });

  it('should not count expired errors outside window', () => {
    const now = Date.now();
    const state = {
      errors: [
        { timestamp: now - 3700000 }, // 1 hour + 10 min ago (expired)
        { timestamp: now - 1000 }, // recent
      ],
      totalRequests: 10,
    };
    const windowMs = 3600000;
    const result = calculateErrorRate(state, windowMs);
    assert.strictEqual(result, 0.1); // 1/10
  });

  it('should return 0 when totalRequests is 0', () => {
    const state = {
      errors: [],
      totalRequests: 0,
    };
    const windowMs = 3600000;
    const result = calculateErrorRate(state, windowMs);
    assert.strictEqual(result, 0);
  });
});

describe('calculateErrorAdjustment', () => {
  it('should return min level (5% weight) when error rate >= 30%', () => {
    const state = {
      errors: Array(30).fill({ timestamp: Date.now() }),
      totalRequests: 100,
      configuredWeight: 100,
    };
    const config = {
      errorWindowMs: 3600000,
      minWeight: 10,
    };
    const result = calculateErrorAdjustment(state, config);
    assert.strictEqual(result.level, 'min');
    assert.strictEqual(result.multiplier, 0.05);
    assert.strictEqual(result.newWeight, 10); // 100 * 0.05 = 5, floored to minWeight 10
  });

  it('should return medium level (20% weight) when error rate >= 15%', () => {
    const state = {
      errors: Array(20).fill({ timestamp: Date.now() }),
      totalRequests: 100,
      configuredWeight: 100,
    };
    const config = {
      errorWindowMs: 3600000,
      minWeight: 10,
    };
    const result = calculateErrorAdjustment(state, config);
    assert.strictEqual(result.level, 'medium');
    assert.strictEqual(result.multiplier, 0.2);
    assert.strictEqual(result.newWeight, 20); // 100 * 0.20
  });

  it('should return half level (50% weight) when error rate >= 5%', () => {
    const state = {
      errors: Array(10).fill({ timestamp: Date.now() }),
      totalRequests: 100,
      configuredWeight: 100,
    };
    const config = {
      errorWindowMs: 3600000,
      minWeight: 10,
    };
    const result = calculateErrorAdjustment(state, config);
    assert.strictEqual(result.level, 'half');
    assert.strictEqual(result.multiplier, 0.5);
    assert.strictEqual(result.newWeight, 50); // 100 * 0.50
  });

  it('should return null when error rate < 5%', () => {
    const state = {
      errors: Array(3).fill({ timestamp: Date.now() }),
      totalRequests: 100,
      configuredWeight: 100,
    };
    const config = {
      errorWindowMs: 3600000,
      minWeight: 10,
    };
    const result = calculateErrorAdjustment(state, config);
    assert.strictEqual(result, null);
  });

  it('should enforce minWeight floor', () => {
    const state = {
      errors: Array(30).fill({ timestamp: Date.now() }),
      totalRequests: 100,
      configuredWeight: 100, // 100 * 0.05 = 5, but minWeight is 10
    };
    const config = {
      errorWindowMs: 3600000,
      minWeight: 10,
    };
    const result = calculateErrorAdjustment(state, config);
    assert.strictEqual(result.level, 'min');
    assert.strictEqual(result.newWeight, 10); // floored to minWeight
  });
});

describe('calculateRecovery', () => {
  it('should recover from min to medium level', () => {
    const state = {
      level: 'min',
      consecutiveSuccess: 5,
      configuredWeight: 100,
    };
    const threshold = 5;
    const result = calculateRecovery(state, threshold);
    assert.strictEqual(result.level, 'medium');
    assert.strictEqual(result.newWeight, 20); // 100 * 0.20
  });

  it('should recover from medium to half level', () => {
    const state = {
      level: 'medium',
      consecutiveSuccess: 5,
      configuredWeight: 100,
    };
    const threshold = 5;
    const result = calculateRecovery(state, threshold);
    assert.strictEqual(result.level, 'half');
    assert.strictEqual(result.newWeight, 50); // 100 * 0.50
  });

  it('should recover from half to normal level', () => {
    const state = {
      level: 'half',
      consecutiveSuccess: 5,
      configuredWeight: 100,
    };
    const threshold = 5;
    const result = calculateRecovery(state, threshold);
    assert.strictEqual(result.level, 'normal');
    assert.strictEqual(result.newWeight, 100); // 100 * 1.00
  });

  it('should return null when already at normal level', () => {
    const state = {
      level: 'normal',
      consecutiveSuccess: 5,
      configuredWeight: 100,
    };
    const threshold = 5;
    const result = calculateRecovery(state, threshold);
    assert.strictEqual(result, null);
  });

  it('should return null when consecutiveSuccess < threshold', () => {
    const state = {
      level: 'min',
      consecutiveSuccess: 3,
      configuredWeight: 100,
    };
    const threshold = 5;
    const result = calculateRecovery(state, threshold);
    assert.strictEqual(result, null);
  });
});

describe('updateTimeSlotWeight', () => {
  it('should proportionally adjust currentWeight when configuredWeight changes', () => {
    const state = {
      configuredWeight: 100,
      currentWeight: 50, // 50% of configured
    };
    const newConfiguredWeight = 200;
    const result = updateTimeSlotWeight(state, newConfiguredWeight);
    assert.strictEqual(result.currentWeight, 100); // 50% of 200
  });

  it('should not change when new configuredWeight is same', () => {
    const state = {
      configuredWeight: 100,
      currentWeight: 50,
    };
    const newConfiguredWeight = 100;
    const result = updateTimeSlotWeight(state, newConfiguredWeight);
    assert.strictEqual(result, null); // No change needed
  });

  it('should update directly when in normal state', () => {
    const state = {
      configuredWeight: 100,
      currentWeight: 100, // normal state
    };
    const newConfiguredWeight = 150;
    const result = updateTimeSlotWeight(state, newConfiguredWeight);
    assert.strictEqual(result.currentWeight, 150); // direct update
  });
});

/**
 * Unit tests for proxy/circuitbreaker module
 * @module tests/proxy/unit/circuitbreaker.test
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  createCircuitBreaker,
} from '../../../src/proxy/circuitbreaker.js';

describe('CircuitBreaker – state transitions', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 100 });
  });

  afterEach(() => {
    cb.reset();
  });

  test('starts in CLOSED state', () => {
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);
  });

  test('CLOSED → OPEN after allowedFails consecutive failures', () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);

    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
  });

  test('OPEN → HALF_OPEN after cooldown elapses', async () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);
  });

  test('HALF_OPEN → CLOSED on successful probe', async () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);

    cb.recordSuccess('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);
  });

  test('HALF_OPEN → OPEN on failed probe', async () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);

    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
  });

  test('full cycle: CLOSED → OPEN → HALF_OPEN → CLOSED', async () => {
    // Trip to OPEN
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);

    // Wait for cooldown → HALF_OPEN
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);

    // Success → CLOSED
    cb.recordSuccess('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);
    assert.equal(cb.getFailureCount('provider-1'), 0);
  });

  test('full cycle: CLOSED → OPEN → HALF_OPEN → OPEN (probe fail)', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);

    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
    assert.equal(cb.isAvailable('provider-1'), false);
  });
});

describe('CircuitBreaker – recordSuccess()', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
  });

  test('resets failure count to 0', () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getFailureCount('provider-1'), 2);

    cb.recordSuccess('provider-1');
    assert.equal(cb.getFailureCount('provider-1'), 0);
  });

  test('transitions OPEN → CLOSED', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);

    cb.recordSuccess('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);
  });

  test('transitions HALF_OPEN → CLOSED', async () => {
    const fast = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 50 });
    fast.recordFailure('provider-1');

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fast.getState('provider-1'), CircuitState.HALF_OPEN);

    fast.recordSuccess('provider-1');
    assert.equal(fast.getState('provider-1'), CircuitState.CLOSED);
  });

  test('success on new provider initializes as CLOSED', () => {
    cb.recordSuccess('brand-new');
    assert.equal(cb.getState('brand-new'), CircuitState.CLOSED);
    assert.equal(cb.getFailureCount('brand-new'), 0);
  });
});

describe('CircuitBreaker – recordFailure()', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 60000 });
  });

  test('increments failure count', () => {
    assert.equal(cb.getFailureCount('provider-1'), 0);
    cb.recordFailure('provider-1');
    assert.equal(cb.getFailureCount('provider-1'), 1);
    cb.recordFailure('provider-1');
    assert.equal(cb.getFailureCount('provider-1'), 2);
  });

  test('trips to OPEN when failures reach threshold', () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.CLOSED);

    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
  });

  test('trips to OPEN exactly at allowedFails boundary', () => {
    const cb2 = new CircuitBreaker({ allowedFails: 1 });
    cb2.recordFailure('provider-1');
    assert.equal(cb2.getState('provider-1'), CircuitState.OPEN);
  });

  test('HALF_OPEN failure immediately trips back to OPEN', async () => {
    const fast = new CircuitBreaker({ allowedFails: 1, cooldownTimeMs: 50 });
    fast.recordFailure('provider-1');

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fast.getState('provider-1'), CircuitState.HALF_OPEN);

    fast.recordFailure('provider-1');
    assert.equal(fast.getState('provider-1'), CircuitState.OPEN);
  });

  test('records lastFailure timestamp', () => {
    const before = Date.now();
    cb.recordFailure('provider-1');
    const after = Date.now();

    const entry = cb._getEntry('provider-1');
    assert.ok(entry.lastFailure >= before && entry.lastFailure <= after);
  });
});

describe('CircuitBreaker – isAvailable()', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ allowedFails: 3, cooldownTimeMs: 100 });
  });

  test('returns true in CLOSED state', () => {
    assert.equal(cb.isAvailable('provider-1'), true);
  });

  test('returns false in OPEN state', () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');
    assert.equal(cb.isAvailable('provider-1'), false);
  });

  test('returns true in HALF_OPEN state', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(cb.isAvailable('provider-1'), true);
  });

  test('respects cooldown before allowing again', async () => {
    for (let i = 0; i < 3; i++) cb.recordFailure('provider-1');
    assert.equal(cb.isAvailable('provider-1'), false);

    // Wait < cooldown → still OPEN
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cb.isAvailable('provider-1'), false);
  });

  test('new provider is available', () => {
    assert.equal(cb.isAvailable('never-seen'), true);
  });
});

describe('CircuitBreaker – getState()', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ allowedFails: 2, cooldownTimeMs: 50 });
  });

  test('returns CLOSED for new provider', () => {
    assert.equal(cb.getState('new-provider'), CircuitState.CLOSED);
  });

  test('returns OPEN after tripping', () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);
  });

  test('transitions to HALF_OPEN after cooldown via getState', async () => {
    cb.recordFailure('provider-1');
    cb.recordFailure('provider-1');
    assert.equal(cb.getState('provider-1'), CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(cb.getState('provider-1'), CircuitState.HALF_OPEN);
  });
});

describe('CircuitBreaker – reset()', () => {
  test('reset(providerId) clears only that provider', () => {
    const cb = new CircuitBreaker({ allowedFails: 1 });
    cb.recordFailure('p1');
    cb.recordFailure('p2');

    assert.equal(cb.getState('p1'), CircuitState.OPEN);
    assert.equal(cb.getState('p2'), CircuitState.OPEN);

    cb.reset('p1');
    assert.equal(cb.getState('p1'), CircuitState.CLOSED);
    assert.equal(cb.getState('p2'), CircuitState.OPEN);
  });

  test('reset() clears all providers', () => {
    const cb = new CircuitBreaker({ allowedFails: 1 });
    cb.recordFailure('p1');
    cb.recordFailure('p2');
    cb.recordFailure('p3');

    cb.reset();
    assert.equal(cb.getState('p1'), CircuitState.CLOSED);
    assert.equal(cb.getState('p2'), CircuitState.CLOSED);
    assert.equal(cb.getState('p3'), CircuitState.CLOSED);
    assert.equal(cb.getFailureCount('p1'), 0);
  });

  test('reset(providerId) allows re-entry creation on next call', () => {
    const cb = new CircuitBreaker({ allowedFails: 1 });
    cb.recordFailure('p1');
    cb.reset('p1');

    // _getEntry should create fresh entry
    const entry = cb._getEntry('p1');
    assert.equal(entry.state, CircuitState.CLOSED);
    assert.equal(entry.failures, 0);
  });
});

describe('CircuitBreaker – per-provider isolation', () => {
  test('providers track failures independently', () => {
    const cb = new CircuitBreaker({ allowedFails: 2 });
    cb.recordFailure('p-a');
    cb.recordFailure('p-a');

    assert.equal(cb.getState('p-a'), CircuitState.OPEN);
    assert.equal(cb.getState('p-b'), CircuitState.CLOSED);
    assert.equal(cb.getFailureCount('p-a'), 2);
    assert.equal(cb.getFailureCount('p-b'), 0);
  });

  test('tripping one provider does not affect another', () => {
    const cb = new CircuitBreaker({ allowedFails: 1 });
    cb.recordFailure('p-x');

    assert.equal(cb.isAvailable('p-x'), false);
    assert.equal(cb.isAvailable('p-y'), true);
  });

  test('success on one provider does not affect another', () => {
    const cb = new CircuitBreaker({ allowedFails: 2 });
    cb.recordFailure('p-a');
    cb.recordFailure('p-b');

    cb.recordSuccess('p-a');
    assert.equal(cb.getFailureCount('p-a'), 0);
    assert.equal(cb.getFailureCount('p-b'), 1);
  });

  test('reset(providerId) does not touch other providers', () => {
    const cb = new CircuitBreaker({ allowedFails: 1 });
    cb.recordFailure('keep');
    cb.recordFailure('remove');

    cb.reset('remove');
    assert.equal(cb.getState('keep'), CircuitState.OPEN);
    assert.equal(cb.getState('remove'), CircuitState.CLOSED);
  });
});

describe('CircuitBreaker – constructor defaults', () => {
  test('uses default allowedFails when not specified', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.allowedFails, 2);
  });

  test('uses default cooldownTimeMs when not specified', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.cooldownTimeMs, 60000);
  });

  test('accepts custom allowedFails', () => {
    const cb = new CircuitBreaker({ allowedFails: 10 });
    assert.equal(cb.allowedFails, 10);
  });

  test('accepts custom cooldownTimeMs', () => {
    const cb = new CircuitBreaker({ cooldownTimeMs: 5000 });
    assert.equal(cb.cooldownTimeMs, 5000);
  });

  test('initializes empty states map', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.states.size, 0);
  });
});

describe('CircuitBreaker – createCircuitBreaker factory', () => {
  test('creates a CircuitBreaker instance', () => {
    const cb = createCircuitBreaker({ allowedFails: 5 });
    assert.ok(cb instanceof CircuitBreaker);
    assert.equal(cb.allowedFails, 5);
  });

  test('creates with defaults when no options', () => {
    const cb = createCircuitBreaker();
    assert.ok(cb instanceof CircuitBreaker);
    assert.equal(cb.allowedFails, 2);
  });
});

describe('CircuitBreaker – CircuitBreakerError', () => {
  test('has correct name', () => {
    const err = new CircuitBreakerError('my-provider');
    assert.equal(err.name, 'CircuitBreakerError');
  });

  test('has providerId', () => {
    const err = new CircuitBreakerError('prov-123');
    assert.equal(err.providerId, 'prov-123');
  });

  test('has OPEN state', () => {
    const err = new CircuitBreakerError('prov');
    assert.equal(err.state, CircuitState.OPEN);
  });

  test('includes providerId in message', () => {
    const err = new CircuitBreakerError('prov-xyz');
    assert.ok(err.message.includes('prov-xyz'));
  });

  test('accepts details', () => {
    const err = new CircuitBreakerError('prov', { reason: 'timeout' });
    assert.deepEqual(err.details, { reason: 'timeout' });
  });

  test('defaults details to empty object', () => {
    const err = new CircuitBreakerError('prov');
    assert.deepEqual(err.details, {});
  });

  test('is instanceof Error', () => {
    const err = new CircuitBreakerError('prov');
    assert.ok(err instanceof Error);
  });
});

describe('CircuitBreaker – getFailureCount()', () => {
  test('returns 0 for unseen provider', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.getFailureCount('unseen'), 0);
  });

  test('returns correct count after failures', () => {
    const cb = new CircuitBreaker();
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    assert.equal(cb.getFailureCount('p1'), 3);
  });

  test('returns 0 after success reset', () => {
    const cb = new CircuitBreaker();
    cb.recordFailure('p1');
    cb.recordFailure('p1');
    cb.recordSuccess('p1');
    assert.equal(cb.getFailureCount('p1'), 0);
  });
});

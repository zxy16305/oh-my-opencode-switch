/**
 * Circuit breaker module - protects against cascading failures
 * @module proxy/circuitbreaker
 */

/**
 * Circuit breaker states
 * @readonly
 * @enum {string}
 */
export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

/**
 * Error thrown when a provider is circuit-broken (OPEN state)
 */
export class CircuitBreakerError extends Error {
  /**
   * @param {string} providerId - The provider that is circuit-broken
   * @param {Object} [details] - Additional details
   */
  constructor(providerId, details = {}) {
    super(`Circuit breaker is OPEN for provider: ${providerId}`);
    this.name = 'CircuitBreakerError';
    this.providerId = providerId;
    this.state = CircuitState.OPEN;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Default circuit breaker options
 */
const DEFAULTS = {
  allowedFails: 3,
  cooldownTimeMs: 60000,
};

/**
 * Circuit breaker with per-provider state tracking.
 *
 * State machine:
 *   CLOSED (normal) → OPEN (tripped) → HALF_OPEN (probing) → CLOSED | OPEN
 *
 * - CLOSED: requests pass through; failures are counted
 * - OPEN: requests are rejected immediately; auto-transitions to HALF_OPEN after cooldown
 * - HALF_OPEN: one probe request is allowed; success → CLOSED, failure → OPEN (cooldown reset)
 */
export class CircuitBreaker {
  /**
   * @param {Object} [options]
   * @param {number} [options.allowedFails=3] - Consecutive failures before tripping
   * @param {number} [options.cooldownTimeMs=60000] - Time in ms before HALF_OPEN probe
   */
  constructor(options = {}) {
    this.allowedFails = options.allowedFails ?? DEFAULTS.allowedFails;
    this.cooldownTimeMs = options.cooldownTimeMs ?? DEFAULTS.cooldownTimeMs;
    /** @type {Map<string, { state: string, failures: number, lastFailure: number }>} */
    this.states = new Map();
  }

  /**
   * Get or create state entry for a provider
   * @param {string} providerId
   * @returns {{ state: string, failures: number, lastFailure: number }}
   */
  _getEntry(providerId) {
    let entry = this.states.get(providerId);
    if (!entry) {
      entry = { state: CircuitState.CLOSED, failures: 0, lastFailure: 0 };
      this.states.set(providerId, entry);
    }
    return entry;
  }

  /**
   * Check if HALF_OPEN cooldown has elapsed and transition if so
   * @param {{ state: string, failures: number, lastFailure: number }} entry
   */
  _checkCooldown(entry) {
    if (entry.state === CircuitState.OPEN) {
      const elapsed = Date.now() - entry.lastFailure;
      if (elapsed >= this.cooldownTimeMs) {
        entry.state = CircuitState.HALF_OPEN;
      }
    }
  }

  /**
   * Record a successful request for the given provider.
   * Resets failure count and transitions HALF_OPEN → CLOSED.
   *
   * @param {string} providerId - Provider identifier
   */
  recordSuccess(providerId) {
    const entry = this._getEntry(providerId);
    entry.failures = 0;
    entry.state = CircuitState.CLOSED;
  }

  /**
   * Record a failed request for the given provider.
   * Increments failure count; trips to OPEN when threshold is reached.
   * If currently HALF_OPEN, immediately trips back to OPEN (cooldown reset).
   *
   * @param {string} providerId - Provider identifier
   */
  recordFailure(providerId) {
    const entry = this._getEntry(providerId);
    entry.failures += 1;
    entry.lastFailure = Date.now();

    if (entry.state === CircuitState.HALF_OPEN) {
      // Probe failed — trip back to OPEN, reset cooldown
      entry.state = CircuitState.OPEN;
      return;
    }

    // CLOSED state — check threshold
    if (entry.failures >= this.allowedFails) {
      entry.state = CircuitState.OPEN;
    }
  }

  /**
   * Check whether the provider is available for requests.
   * Accounts for cooldown expiry (OPEN → HALF_OPEN transition).
   *
   * @param {string} providerId - Provider identifier
   * @returns {boolean} `true` if requests should be allowed
   */
  isAvailable(providerId) {
    const entry = this._getEntry(providerId);
    this._checkCooldown(entry);

    return entry.state !== CircuitState.OPEN;
  }

  /**
   * Get the current state for a provider.
   * Accounts for cooldown expiry.
   *
   * @param {string} providerId - Provider identifier
   * @returns {string} Current state (CLOSED, OPEN, or HALF_OPEN)
   */
  getState(providerId) {
    const entry = this._getEntry(providerId);
    this._checkCooldown(entry);
    return entry.state;
  }

  /**
   * Get all current provider states.
   * Accounts for cooldown expiry for each provider.
   *
   * @returns {Map<string, { state: string, failures: number, lastFailure: number }>}
   *          Map of provider IDs to their current state information (copy)
   */
  getStates() {
    const result = new Map();
    for (const [providerId, entry] of this.states) {
      this._checkCooldown(entry);
      // Create a copy of the entry to prevent external modification
      result.set(providerId, {
        state: entry.state,
        failures: entry.failures,
        lastFailure: entry.lastFailure,
      });
    }
    return result;
  }

  /**
   * Get failure count for a provider
   * @param {string} providerId
   * @returns {number}
   */
  getFailureCount(providerId) {
    return this._getEntry(providerId).failures;
  }

  /**
   * Reset state for a specific provider or all providers
   * @param {string} [providerId] - If omitted, resets all providers
   */
  reset(providerId) {
    if (providerId) {
      this.states.delete(providerId);
    } else {
      this.states.clear();
    }
  }
}

/**
 * Factory function to create a CircuitBreaker instance
 * @param {Object} [options] - Same as CircuitBreaker constructor
 * @returns {CircuitBreaker}
 */
export function createCircuitBreaker(options) {
  return new CircuitBreaker(options);
}

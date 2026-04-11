/**
 * State manager module - manages all proxy instance-level state
 * @module proxy/state-manager
 */

/**
 * StateManager class that manages all instance-level state for the proxy.
 * Handles session tracking, load balancing counters, and statistics collection.
 */
export class StateManager {
  /**
   * Create a new StateManager instance
   */
  constructor() {
    // Session tracking
    /** @type {Map<string, { upstreamId: string, routeKey: string, timestamp: number }>} */
    this.sessionMap = new Map();

    // Upstream session counts per route
    /** @type {Map<string, Map<string, number>>} */
    this.upstreamSessionCounts = new Map();

    // Round-robin counters per route
    /** @type {Map<string, number>} */
    this.roundRobinCounters = new Map();

    // Statistics state per route:upstream
    /** @type {Map<string, { ttfbSamples: number[], durationSamples: number[], errorCount: number }>} */
    this.statsState = new Map();

    // Error state per route:upstream
    /** @type {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>} */
    this.errorState = new Map();

    // Latency state per route:upstream
    /** @type {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>} */
    this.latencyState = new Map();

    // Upstream request counts per route
    /** @type {Map<string, Map<string, number>>} */
    this.upstreamRequestCounts = new Map();

    // Upstream sliding window counts per route:upstream
    /** @type {Map<string, Array<{ timestamp: number }>>} */
    this.upstreamSlidingWindowCounts = new Map();

    // Time slot calculator (lazy loaded, singleton per instance)
    /** @type {Object|null} */
    this.timeSlotCalculator = null;

    // Cleanup interval
    /** @type {NodeJS.Timeout|null} */
    this.cleanupInterval = null;
  }

  /**
   * Get the session upstream map
   * @returns {Map<string, { upstreamId: string, routeKey: string, timestamp: number }>}
   */
  getSessionUpstreamMap() {
    return this.sessionMap;
  }

  /**
   * Get the upstream session counts map
   * @returns {Map<string, Map<string, number>>}
   */
  getUpstreamSessionCounts() {
    return this.upstreamSessionCounts;
  }

  /**
   * Get the round-robin counters map
   * @returns {Map<string, number>}
   */
  getRoundRobinCounters() {
    return this.roundRobinCounters;
  }

  /**
   * Get the stats state map
   * @returns {Map<string, { ttfbSamples: number[], durationSamples: number[], errorCount: number }>}
   */
  getStatsState() {
    return this.statsState;
  }

  /**
   * Get the error state map
   * @returns {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>}
   */
  getErrorState() {
    return this.errorState;
  }

  /**
   * Get the latency state map
   * @returns {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>}
   */
  getLatencyState() {
    return this.latencyState;
  }

  /**
   * Get the upstream request counts map
   * @returns {Map<string, Map<string, number>>}
   */
  getUpstreamRequestCounts() {
    return this.upstreamRequestCounts;
  }

  /**
   * Get the upstream sliding window counts map
   * @returns {Map<string, Array<{ timestamp: number }>>}
   */
  getUpstreamSlidingWindowCounts() {
    return this.upstreamSlidingWindowCounts;
  }

  /**
   * Get the time slot calculator
   * @returns {Object|null}
   */
  getTimeSlotCalculator() {
    return this.timeSlotCalculator;
  }

  /**
   * Set the time slot calculator
   * @param {Object|null} calculator
   */
  setTimeSlotCalculator(calculator) {
    this.timeSlotCalculator = calculator;
  }

  /**
   * Get the cleanup interval
   * @returns {NodeJS.Timeout|null}
   */
  getCleanupInterval() {
    return this.cleanupInterval;
  }

  /**
   * Set the cleanup interval
   * @param {NodeJS.Timeout} interval
   */
  setCleanupInterval(interval) {
    this.cleanupInterval = interval;
  }

  /**
   * Reset all state to initial values
   * Clears all maps and stops all timers/intervals
   */
  reset() {
    // Clear all maps
    this.sessionMap.clear();
    this.upstreamSessionCounts.clear();
    this.roundRobinCounters.clear();
    this.statsState.clear();
    this.errorState.clear();
    this.latencyState.clear();
    this.upstreamRequestCounts.clear();
    this.upstreamSlidingWindowCounts.clear();

    // Clear and stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear time slot calculator
    this.timeSlotCalculator = null;
  }
}

/**
 * Singleton instance of StateManager
 * @type {StateManager}
 */
export const stateManager = new StateManager();

/**
 * Factory function to create a new StateManager instance
 * @returns {StateManager}
 */
export function createStateManager() {
  return new StateManager();
}

/**
 * Get the time slot calculator from the singleton instance
 * @returns {Object|null}
 */
export function getTimeSlotCalculator() {
  return stateManager.getTimeSlotCalculator();
}

/**
 * Reset all state on the singleton instance
 */
export function resetAllState() {
  stateManager.reset();
}

// Module accessor functions that delegate to the singleton instance
export function getSessionUpstreamMap() {
  return stateManager.getSessionUpstreamMap();
}

export function getUpstreamSessionCounts() {
  return stateManager.getUpstreamSessionCounts();
}

export function getRoundRobinCounters() {
  return stateManager.getRoundRobinCounters();
}

export function getStatsState() {
  return stateManager.getStatsState();
}

export function getErrorState() {
  return stateManager.getErrorState();
}

export function getLatencyState() {
  return stateManager.getLatencyState();
}

export function getUpstreamRequestCounts() {
  return stateManager.getUpstreamRequestCounts();
}

export function getUpstreamSlidingWindowCounts() {
  return stateManager.getUpstreamSlidingWindowCounts();
}

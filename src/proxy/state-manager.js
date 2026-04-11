/**
 * State manager module - manages all proxy instance-level state
 * @module proxy/state-manager
 */

export class StateManager {
  constructor() {
    /** @type {Map<string, { upstreamId: string, routeKey: string, timestamp: number }>} */
    this.sessionMap = new Map();
    /** @type {Map<string, Map<string, number>>} */
    this.upstreamSessionCounts = new Map();
    /** @type {Map<string, number>} */
    this.roundRobinCounters = new Map();
    /** @type {Map<string, { ttfbSamples: number[], durationSamples: number[], errorCount: number }>} */
    this.statsState = new Map();
    /** @type {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>} */
    this.errorState = new Map();
    /** @type {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>} */
    this.latencyState = new Map();
    /** @type {Map<string, Map<string, number>>} */
    this.upstreamRequestCounts = new Map();
    /** @type {Map<string, Array<{ timestamp: number }>>} */
    this.upstreamSlidingWindowCounts = new Map();
    /** @type {Object|null} */
    this.timeSlotCalculator = null;
    /** @type {NodeJS.Timeout|null} */
    this.cleanupInterval = null;
  }

  reset() {
    this.sessionMap.clear();
    this.upstreamSessionCounts.clear();
    this.roundRobinCounters.clear();
    this.statsState.clear();
    this.errorState.clear();
    this.latencyState.clear();
    this.upstreamRequestCounts.clear();
    this.upstreamSlidingWindowCounts.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.timeSlotCalculator = null;
  }
}

/** @type {StateManager} */
export const stateManager = new StateManager();

/** @returns {StateManager} */
export function createStateManager() {
  return new StateManager();
}

export function resetAllState() {
  stateManager.reset();
}

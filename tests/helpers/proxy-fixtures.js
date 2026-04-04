/**
 * Shared test fixtures for proxy-related tests.
 * @module tests/helpers/proxy-fixtures
 */

// ---------------------------------------------------------------------------
// Upstream Fixtures
// ---------------------------------------------------------------------------

/**
 * Create a mock upstream object.
 * @param {Object} overrides - Properties to override defaults
 * @returns {Object} Upstream configuration object
 */
export function makeUpstream(overrides = {}) {
  return {
    id: overrides.id || 'u1',
    provider: overrides.provider || 'test-provider',
    model: overrides.model || 'test-model',
    baseURL: overrides.baseURL || 'http://localhost:8001',
    apiKey: overrides.apiKey || 'key-123',
    weight: overrides.weight ?? 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route Fixtures
// ---------------------------------------------------------------------------

/**
 * Default dynamic weight configuration.
 */
const defaultDynamicWeightConfig = {
  enabled: true,
  initialWeight: 100,
  minWeight: 10,
  checkInterval: 10,
  latencyThreshold: 1.5,
  recoveryInterval: 300000,
  recoveryAmount: 1,
  errorWeightReduction: {
    enabled: true,
    errorCodes: [429, 500, 502, 503, 504],
    reductionAmount: 10,
    minWeight: 5,
    errorWindowMs: 3600000,
  },
};

/**
 * Default time slot weight configuration.
 */
const defaultTimeSlotWeightConfig = {
  enabled: false,
  totalErrorThreshold: 0.01,
  dangerSlotThreshold: 0.05,
  dangerMultiplier: 0.5,
  normalMultiplier: 2.0,
  lookbackDays: 7,
};

/**
 * Create a route configuration object.
 * @param {Array} upstreams - Array of upstream objects
 * @param {Object|string} overridesOrStrategy - Properties to override or strategy name
 * @returns {Object} Route configuration object
 */
export function makeRoute(upstreams, overridesOrStrategy = {}) {
  const overrides =
    typeof overridesOrStrategy === 'string'
      ? { strategy: overridesOrStrategy }
      : overridesOrStrategy;
  const strategy = overrides.strategy || 'round-robin';

  const stickyDefaults =
    strategy === 'sticky'
      ? {
          stickyReassignThreshold: 10,
          stickyReassignMinGap: 2,
        }
      : {};

  return {
    strategy,
    upstreams,
    ...stickyDefaults,
    dynamicWeight: {
      ...defaultDynamicWeightConfig,
      ...(overrides.dynamicWeight || {}),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Config Fixtures
// ---------------------------------------------------------------------------

/**
 * Create a routes configuration object.
 * @param {string} routeKey - The route key (model name)
 * @param {Array} upstreams - Array of upstream objects
 * @param {string} strategy - Routing strategy
 * @returns {Object} Routes configuration object
 */
export function makeConfig(routeKey = 'test-model', upstreams, strategy) {
  return { [routeKey]: makeRoute(upstreams || [makeUpstream()], strategy) };
}

/**
 * Create a dynamic weight configuration object.
 * Used for testing weight adjustment functions.
 * @param {Object} overrides - Properties to override defaults
 * @returns {Object} Dynamic weight configuration object
 */
export function makeDynamicWeightConfig(overrides = {}) {
  return {
    enabled: true,
    initialWeight: 100,
    minWeight: 10,
    ...overrides,
    errorWeightReduction: {
      enabled: true,
      errorCodes: [429, 500, 502, 503, 504],
      reductionAmount: 5,
      minWeight: 5,
      errorWindowMs: 3600000,
      ...(overrides.errorWeightReduction || {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Request Fixtures
// ---------------------------------------------------------------------------

/**
 * Create a mock request object for testing.
 * @param {string} sessionId - Session ID for sticky routing
 * @returns {Object} Mock request object
 */
export function makeMockRequest(sessionId) {
  return {
    headers: {
      'x-opencode-session': sessionId,
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Calculate traffic distribution percentage.
 * @param {Map} requestCounts - Map of upstream ID to request count
 * @param {number} totalRequests - Total number of requests
 * @returns {Object} Distribution object with upstream ID as keys and percentages as values
 */
export function calculateDistribution(requestCounts, totalRequests) {
  const distribution = {};
  for (const [upstreamId, count] of requestCounts.entries()) {
    distribution[upstreamId] = (count / totalRequests) * 100;
  }
  return distribution;
}

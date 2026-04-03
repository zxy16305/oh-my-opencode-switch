/**
 * Statistics collection module - handles upstream performance tracking
 * @module proxy/stats-collector
 */

/**
 * Error state per upstream per route
 * Key: `${routeKey}:${upstreamId}`
 * Value: { errors: Array<{ timestamp: number, statusCode: number }> }
 * @type {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>}
 */
const errorState = new Map();

/**
 * Latency state per upstream per route
 * Key: `${routeKey}:${upstreamId}`
 * Value: { latencies: Array<{ timestamp: number, duration: number }> }
 * @type {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>}
 */
const latencyState = new Map();

/**
 * Statistics state per upstream per route
 * Key: `${routeKey}:${upstreamId}`
 * Value: { ttfbSamples: Array<number>, durationSamples: Array<number>, errorCount: number }
 * @type {Map<string, { ttfbSamples: Array<number>, durationSamples: Array<number>, errorCount: number }>}
 */
const statsState = new Map();

/**
 * Maximum number of samples to keep per upstream (sliding window)
 */
const MAX_SAMPLES = 1000;

/**
 * Upstream request counts
 * Key: routeKey (virtual model name)
 * Value: Map<upstreamId, requestCount>
 * @type {Map<string, Map<string, number>>}
 */
const upstreamRequestCounts = new Map();

/**
 * Upstream sliding window request counts
 * Key: `${routeKey}:${upstreamId}`
 * Value: Array of {timestamp: number}
 * @type {Map<string, Array<{timestamp: number}>>}
 */
const upstreamSlidingWindowCounts = new Map();

/**
 * Calculate percentile value from an array of numbers
 * @param {Array<number>} arr - Array of numeric values
 * @param {number} p - Percentile to calculate (0-100)
 * @returns {number} Calculated percentile value
 */
function calculatePercentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Record upstream performance statistics (TTFB, duration, errors)
 * @param {string} routeKey - Virtual model/route key
 * @param {string} upstreamId - Upstream identifier
 * @param {number} [ttfb] - Time to first byte in milliseconds
 * @param {number} [duration] - Total request duration in milliseconds
 * @param {boolean} [isError=false] - Whether this request resulted in an error
 */
function recordUpstreamStats(routeKey, upstreamId, ttfb, duration, isError = false) {
  const key = `${routeKey}:${upstreamId}`;
  if (!statsState.has(key)) {
    statsState.set(key, {
      ttfbSamples: [],
      durationSamples: [],
      errorCount: 0,
    });
  }

  const stats = statsState.get(key);

  // Ensure structure compatibility (merge may have created entries with different field names)
  if (!stats.ttfbSamples) stats.ttfbSamples = [];
  if (!stats.durationSamples) stats.durationSamples = [];
  if (stats.errorCount == null) stats.errorCount = 0;

  if (isError) {
    stats.errorCount++;
  } else {
    // Only record timing metrics for successful requests
    if (ttfb != null) {
      stats.ttfbSamples.push(ttfb);
      if (stats.ttfbSamples.length > 1000) {
        stats.ttfbSamples.shift(); // Maintain sliding window of 1000 samples
      }
    }
    if (duration != null) {
      stats.durationSamples.push(duration);
      if (stats.durationSamples.length > 1000) {
        stats.durationSamples.shift();
      }
    }
  }
}

/**
 * Get upstream performance statistics including TTFB and Duration percentiles
 * @param {string} routeKey - Virtual model/route key
 * @param {string} upstreamId - Upstream identifier
 * @returns {{ errorCount: number, avgTtfb: number, ttfbP95: number, ttfbP99: number, avgDuration: number, durationP95: number, durationP99: number, sampleCount: number }}
 */
function getUpstreamStats(routeKey, upstreamId) {
  const key = `${routeKey}:${upstreamId}`;
  const stats = statsState.get(key);

  if (!stats) {
    return {
      errorCount: 0,
      avgTtfb: 0,
      ttfbP95: 0,
      ttfbP99: 0,
      avgDuration: 0,
      durationP95: 0,
      durationP99: 0,
      sampleCount: 0,
    };
  }

  const ttfbSamples = stats.ttfbSamples;
  const durationSamples = stats.durationSamples;

  return {
    errorCount: stats.errorCount,
    avgTtfb:
      ttfbSamples.length > 0
        ? Math.round(ttfbSamples.reduce((a, b) => a + b, 0) / ttfbSamples.length)
        : 0,
    ttfbP95: calculatePercentile(ttfbSamples, 95),
    ttfbP99: calculatePercentile(ttfbSamples, 99),
    avgDuration:
      durationSamples.length > 0
        ? Math.round(durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length)
        : 0,
    durationP95: calculatePercentile(durationSamples, 95),
    durationP99: calculatePercentile(durationSamples, 99),
    sampleCount: ttfbSamples.length,
  };
}

/**
 * Record an error for an upstream
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} statusCode - HTTP status code of the error
 */
export function recordUpstreamError(routeKey, upstreamId, statusCode) {
  const key = `${routeKey}:${upstreamId}`;
  const entry = statsState.get(key) || { ttfbSamples: [], durationSamples: [], errorCount: 0 };
  entry.errorCount++;
  statsState.set(key, entry);

  if (!errorState.has(key)) {
    errorState.set(key, { errors: [] });
  }
  const state = errorState.get(key);
  state.errors.push({
    timestamp: Date.now(),
    statusCode,
  });
}

/**
 * Get error rate for an upstream within a sliding time window
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number|object} windowMsOrConfig - Time window in ms, or config with errorWeightReduction.errorWindowMs
 * @returns {number} Error rate as a number (count of errors in window)
 */
export function getErrorRate(routeKey, upstreamId, windowMsOrConfig) {
  const windowMs =
    typeof windowMsOrConfig === 'object'
      ? (windowMsOrConfig?.errorWeightReduction?.errorWindowMs ?? 600000)
      : windowMsOrConfig;

  const key = `${routeKey}:${upstreamId}`;
  const state = errorState.get(key);
  if (!state || state.errors.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  state.errors = state.errors.filter((error) => error.timestamp >= windowStart);

  return state.errors.length;
}

/**
 * Get current error state (useful for testing/monitoring)
 * @returns {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>}
 */
export function getErrorState() {
  return errorState;
}

/**
 * Record a latency measurement for an upstream
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} ttfb - Time to first byte in milliseconds
 * @param {number} duration - Request duration in milliseconds
 */
export function recordUpstreamLatency(routeKey, upstreamId, ttfb, duration) {
  const key = `${routeKey}:${upstreamId}`;
  const entry = statsState.get(key) || { ttfbSamples: [], durationSamples: [], errorCount: 0 };

  if (ttfb != null && duration != null) {
    entry.ttfbSamples.push(ttfb);
    entry.durationSamples.push(duration);

    if (entry.ttfbSamples.length > MAX_SAMPLES) {
      entry.ttfbSamples.shift();
      entry.durationSamples.shift();
    }
  }

  statsState.set(key, entry);

  if (!latencyState.has(key)) {
    latencyState.set(key, { latencies: [] });
  }
  const state = latencyState.get(key);
  state.latencies.push({
    timestamp: Date.now(),
    duration,
  });
}

/**
 * Get average latency for an upstream within a sliding time window
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} windowMs - Time window in milliseconds
 * @returns {number} Average latency in milliseconds, or 0 if no latencies in window
 */
export function getLatencyAvg(routeKey, upstreamId, windowMs = 600000) {
  const key = `${routeKey}:${upstreamId}`;
  const state = latencyState.get(key);
  if (!state || state.latencies.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  state.latencies = state.latencies.filter((latency) => latency.timestamp >= windowStart);

  if (state.latencies.length === 0) {
    return 0;
  }

  const sum = state.latencies.reduce((acc, latency) => acc + latency.duration, 0);
  return sum / state.latencies.length;
}

/**
 * Get request count for an upstream within a sliding time window
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream ID
 * @param {number} windowMs - Sliding window size in milliseconds (default: 10 minutes)
 * @returns {number} Number of requests within the window
 */
export function getUpstreamRequestCountInWindow(routeKey, upstreamId, windowMs = 600000) {
  const key = `${routeKey}:${upstreamId}`;
  const timestamps = upstreamSlidingWindowCounts.get(key);
  if (!timestamps || timestamps.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  const filtered = timestamps.filter((entry) => entry.timestamp >= windowStart);
  upstreamSlidingWindowCounts.set(key, filtered);

  return filtered.length;
}

/**
 * Get current latency state (useful for testing/monitoring)
 * @returns {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>}
 */
export function getLatencyState() {
  return latencyState;
}

/**
 * 获取或创建 routeKey 的上游请求计数映射
 * @param {string} routeKey
 * @returns {Map<string, number>}
 */
function getOrCreateRequestCountMap(routeKey) {
  if (!upstreamRequestCounts.has(routeKey)) {
    upstreamRequestCounts.set(routeKey, new Map());
  }
  return upstreamRequestCounts.get(routeKey);
}

/**
 * 增加上游请求计数
 * @param {string} routeKey
 * @param {string} upstreamId
 */
export function incrementUpstreamRequestCount(routeKey, upstreamId) {
  const countMap = getOrCreateRequestCountMap(routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);

  const key = `${routeKey}:${upstreamId}`;
  if (!upstreamSlidingWindowCounts.has(key)) {
    upstreamSlidingWindowCounts.set(key, []);
  }
  upstreamSlidingWindowCounts.get(key).push({ timestamp: Date.now() });
}

/**
 * Get current upstream request counts (useful for testing/monitoring)
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamRequestCounts() {
  return upstreamRequestCounts;
}

/**
 * Get current upstream sliding window request counts (useful for testing/monitoring)
 * @returns {Map<string, Array<{timestamp: number}>>}
 */
export function getUpstreamSlidingWindowCounts() {
  return upstreamSlidingWindowCounts;
}

// Export state for external access (testing/monitoring)
export {
  statsState,
  errorState,
  latencyState,
  upstreamRequestCounts,
  upstreamSlidingWindowCounts,
  MAX_SAMPLES,
};

// Export internal functions for router.js
export { recordUpstreamStats, getUpstreamStats, calculatePercentile };

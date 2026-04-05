/**
 * Statistics collection module - handles upstream performance tracking
 * @module proxy/stats-collector
 */

/**
 * Maximum number of samples to keep per upstream (sliding window)
 */
const MAX_SAMPLES = 1000;

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
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - Virtual model/route key
 * @param {string} upstreamId - Upstream identifier
 * @param {number} [ttfb] - Time to first byte in milliseconds
 * @param {number} [duration] - Total request duration in milliseconds
 * @param {boolean} [isError=false] - Whether this request resulted in an error
 */
function recordUpstreamStats(state, routeKey, upstreamId, ttfb, duration, isError = false) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.getStatsState();
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
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - Virtual model/route key
 * @param {string} upstreamId - Upstream identifier
 * @returns {{ errorCount: number, avgTtfb: number, ttfbP95: number, ttfbP99: number, avgDuration: number, durationP95: number, durationP99: number, sampleCount: number }}
 */
function getUpstreamStats(state, routeKey, upstreamId) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.getStatsState();
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
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} statusCode - HTTP status code of the error
 */
export function recordUpstreamError(state, routeKey, upstreamId, statusCode) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.getStatsState();
  const entry = statsState.get(key) || { ttfbSamples: [], durationSamples: [], errorCount: 0 };
  entry.errorCount++;
  statsState.set(key, entry);

  const errorState = state.getErrorState();
  if (!errorState.has(key)) {
    errorState.set(key, { errors: [] });
  }
  const errorEntry = errorState.get(key);
  errorEntry.errors.push({
    timestamp: Date.now(),
    statusCode,
  });
}

/**
 * Get error rate for an upstream within a sliding time window
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number|object} windowMsOrConfig - Time window in ms, or config with errorWeightReduction.errorWindowMs
 * @returns {number} Error rate as a number (count of errors in window)
 */
export function getErrorRate(state, routeKey, upstreamId, windowMsOrConfig) {
  const windowMs =
    typeof windowMsOrConfig === 'object'
      ? (windowMsOrConfig?.errorWeightReduction?.errorWindowMs ?? 3600000)
      : windowMsOrConfig;

  const key = `${routeKey}:${upstreamId}`;
  const errorState = state.getErrorState();
  const errorEntry = errorState.get(key);
  if (!errorEntry || errorEntry.errors.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  errorEntry.errors = errorEntry.errors.filter((error) => error.timestamp >= windowStart);

  return errorEntry.errors.length;
}

/**
 * Get current error state (useful for testing/monitoring)
 * @param {StateManager} state - StateManager instance
 * @returns {Map<string, { errors: Array<{ timestamp: number, statusCode: number }> }>}
 */
export function getErrorState(state) {
  return state.getErrorState();
}

/**
 * Record a latency measurement for an upstream
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} ttfb - Time to first byte in milliseconds
 * @param {number} duration - Request duration in milliseconds
 */
export function recordUpstreamLatency(state, routeKey, upstreamId, ttfb, duration) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.getStatsState();
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

  const latencyState = state.getLatencyState();
  if (!latencyState.has(key)) {
    latencyState.set(key, { latencies: [] });
  }
  const latencyEntry = latencyState.get(key);
  latencyEntry.latencies.push({
    timestamp: Date.now(),
    duration,
  });
}

/**
 * Get average latency for an upstream within a sliding time window
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream identifier
 * @param {number} windowMs - Time window in milliseconds
 * @returns {number} Average latency in milliseconds, or 0 if no latencies in window
 */
export function getLatencyAvg(state, routeKey, upstreamId, windowMs = 3600000) {
  const key = `${routeKey}:${upstreamId}`;
  const latencyState = state.getLatencyState();
  const latencyEntry = latencyState.get(key);
  if (!latencyEntry || latencyEntry.latencies.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;

  latencyEntry.latencies = latencyEntry.latencies.filter(
    (latency) => latency.timestamp >= windowStart
  );

  if (latencyEntry.latencies.length === 0) {
    return 0;
  }

  const sum = latencyEntry.latencies.reduce((acc, latency) => acc + latency.duration, 0);
  return sum / latencyEntry.latencies.length;
}

/**
 * Get request count for an upstream within a sliding time window
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey - The route key (virtual model name)
 * @param {string} upstreamId - The upstream ID
 * @param {number} windowMs - Sliding window size in milliseconds (default: 10 minutes)
 * @returns {number} Number of requests within the window
 */
export function getUpstreamRequestCountInWindow(state, routeKey, upstreamId, windowMs = 3600000) {
  const key = `${routeKey}:${upstreamId}`;
  const upstreamSlidingWindowCounts = state.getUpstreamSlidingWindowCounts();
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
 * @param {StateManager} state - StateManager instance
 * @returns {Map<string, { latencies: Array<{ timestamp: number, duration: number }> }>}
 */
export function getLatencyState(state) {
  return state.getLatencyState();
}

/**
 * 获取或创建 routeKey 的上游请求计数映射
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey
 * @returns {Map<string, number>}
 */
function getOrCreateRequestCountMap(state, routeKey) {
  const upstreamRequestCounts = state.getUpstreamRequestCounts();
  if (!upstreamRequestCounts.has(routeKey)) {
    upstreamRequestCounts.set(routeKey, new Map());
  }
  return upstreamRequestCounts.get(routeKey);
}

/**
 * 增加上游请求计数
 * @param {StateManager} state - StateManager instance
 * @param {string} routeKey
 * @param {string} upstreamId
 */
export function incrementUpstreamRequestCount(state, routeKey, upstreamId) {
  const countMap = getOrCreateRequestCountMap(state, routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);

  const key = `${routeKey}:${upstreamId}`;
  const upstreamSlidingWindowCounts = state.getUpstreamSlidingWindowCounts();
  if (!upstreamSlidingWindowCounts.has(key)) {
    upstreamSlidingWindowCounts.set(key, []);
  }
  upstreamSlidingWindowCounts.get(key).push({ timestamp: Date.now() });
}

/**
 * Get current upstream request counts (useful for testing/monitoring)
 * @param {StateManager} state - StateManager instance
 * @returns {Map<string, Map<string, number>>}
 */
export function getUpstreamRequestCounts(state) {
  return state.getUpstreamRequestCounts();
}

/**
 * Get current upstream sliding window request counts (useful for testing/monitoring)
 * @param {StateManager} state - StateManager instance
 * @returns {Map<string, Array<{timestamp: number}>>}
 */
export function getUpstreamSlidingWindowCounts(state) {
  return state.getUpstreamSlidingWindowCounts();
}

/**
 * Reset all statistics state (useful for testing)
 * @param {StateManager} state - StateManager instance
 */
export function resetStats(state) {
  state.getStatsState().clear();
  state.getErrorState().clear();
  state.getLatencyState().clear();
  state.getUpstreamRequestCounts().clear();
  state.getUpstreamSlidingWindowCounts().clear();
}

// Export constants and functions
export { MAX_SAMPLES };

// Export internal functions for router.js
export { recordUpstreamStats, getUpstreamStats, calculatePercentile };

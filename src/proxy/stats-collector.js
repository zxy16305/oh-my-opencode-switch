/**
 * Statistics collection module - handles upstream performance tracking
 * @module proxy/stats-collector
 */

const MAX_SAMPLES = 1000;
const TRIM_THRESHOLD = 2000;

function calculatePercentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = arr.toSorted ? arr.toSorted((a, b) => a - b) : [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function recordUpstreamStats(state, routeKey, upstreamId, ttfb, duration, isError = false) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.statsState;
  if (!statsState.has(key)) {
    statsState.set(key, { ttfbSamples: [], durationSamples: [], errorCount: 0 });
  }

  const stats = statsState.get(key);
  if (!stats.ttfbSamples) stats.ttfbSamples = [];
  if (!stats.durationSamples) stats.durationSamples = [];
  if (stats.errorCount == null) stats.errorCount = 0;

  if (isError) {
    stats.errorCount++;
  } else {
    if (ttfb != null) {
      stats.ttfbSamples.push(ttfb);
      if (stats.ttfbSamples.length > 1000) {
        stats.ttfbSamples.shift();
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

function getUpstreamStats(state, routeKey, upstreamId) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.statsState;
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

export function recordUpstreamError(state, routeKey, upstreamId, statusCode) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.statsState;
  const entry = statsState.get(key) || { ttfbSamples: [], durationSamples: [], errorCount: 0 };
  entry.errorCount++;
  statsState.set(key, entry);

  const errorState = state.errorState;
  if (!errorState.has(key)) {
    errorState.set(key, { errors: [] });
  }
  const errorEntry = errorState.get(key);
  errorEntry.errors.push({ timestamp: Date.now(), statusCode });
}

export function getErrorCountInWindow(state, routeKey, upstreamId, windowMsOrConfig) {
  const windowMs =
    typeof windowMsOrConfig === 'object'
      ? (windowMsOrConfig?.errorWeightReduction?.errorWindowMs ?? 3600000)
      : windowMsOrConfig;

  const key = `${routeKey}:${upstreamId}`;
  const errorState = state.errorState;
  const errorEntry = errorState.get(key);
  if (!errorEntry || errorEntry.errors.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const inWindow = errorEntry.errors.filter((error) => error.timestamp >= windowStart);

  if (errorEntry.errors.length > TRIM_THRESHOLD) {
    errorEntry.errors = inWindow;
  }

  return inWindow.length;
}

export function getErrorState(state) {
  return state.errorState;
}

export function recordUpstreamLatency(state, routeKey, upstreamId, ttfb, duration) {
  const key = `${routeKey}:${upstreamId}`;
  const statsState = state.statsState;
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

  const latencyState = state.latencyState;
  if (!latencyState.has(key)) {
    latencyState.set(key, { latencies: [] });
  }
  const latencyEntry = latencyState.get(key);
  latencyEntry.latencies.push({ timestamp: Date.now(), duration });
}

export function getLatencyAvg(state, routeKey, upstreamId, windowMs = 3600000) {
  const key = `${routeKey}:${upstreamId}`;
  const latencyState = state.latencyState;
  const latencyEntry = latencyState.get(key);
  if (!latencyEntry || latencyEntry.latencies.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const inWindow = latencyEntry.latencies.filter((latency) => latency.timestamp >= windowStart);

  if (inWindow.length === 0) {
    return 0;
  }

  if (latencyEntry.latencies.length > TRIM_THRESHOLD) {
    latencyEntry.latencies = inWindow;
  }

  const sum = inWindow.reduce((acc, latency) => acc + latency.duration, 0);
  return sum / inWindow.length;
}

export function getUpstreamRequestCountInWindow(state, routeKey, upstreamId, windowMs = 3600000) {
  const key = `${routeKey}:${upstreamId}`;
  const upstreamSlidingWindowCounts = state.upstreamSlidingWindowCounts;
  const timestamps = upstreamSlidingWindowCounts.get(key);
  if (!timestamps || timestamps.length === 0) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const inWindow = timestamps.filter((entry) => entry.timestamp >= windowStart);

  if (timestamps.length > TRIM_THRESHOLD) {
    upstreamSlidingWindowCounts.set(key, inWindow);
  }

  return inWindow.length;
}

export function getLatencyState(state) {
  return state.latencyState;
}

function getOrCreateRequestCountMap(state, routeKey) {
  const upstreamRequestCounts = state.upstreamRequestCounts;
  if (!upstreamRequestCounts.has(routeKey)) {
    upstreamRequestCounts.set(routeKey, new Map());
  }
  return upstreamRequestCounts.get(routeKey);
}

export function incrementUpstreamRequestCount(state, routeKey, upstreamId) {
  const countMap = getOrCreateRequestCountMap(state, routeKey);
  countMap.set(upstreamId, (countMap.get(upstreamId) ?? 0) + 1);

  const key = `${routeKey}:${upstreamId}`;
  const upstreamSlidingWindowCounts = state.upstreamSlidingWindowCounts;
  if (!upstreamSlidingWindowCounts.has(key)) {
    upstreamSlidingWindowCounts.set(key, []);
  }
  upstreamSlidingWindowCounts.get(key).push({ timestamp: Date.now() });
}

export function getUpstreamRequestCounts(state) {
  return state.upstreamRequestCounts;
}

export function getUpstreamSlidingWindowCounts(state) {
  return state.upstreamSlidingWindowCounts;
}

export function resetStats(state) {
  state.statsState.clear();
  state.errorState.clear();
  state.latencyState.clear();
  state.upstreamRequestCounts.clear();
  state.upstreamSlidingWindowCounts.clear();
}

export { MAX_SAMPLES };
export { recordUpstreamStats, getUpstreamStats, calculatePercentile };

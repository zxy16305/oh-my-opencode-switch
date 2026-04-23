function parseCompactTokenStr(tokenStr) {
  const result = { input: 0, output: 0 };
  if (!tokenStr || typeof tokenStr !== 'string' || !tokenStr.startsWith('tok=')) return result;

  const parts = tokenStr.slice(4).split('/');
  const parseNum = (s) => {
    if (!s || s.length < 2) return 0;
    const num = parseFloat(s.slice(1));
    const suffix = s.slice(-1);
    if (suffix === 'k') return Math.round(num * 1000);
    if (suffix === 'm') return Math.round(num * 1000000);
    return Math.round(num);
  };
  result.input = parseNum(parts[0]);
  result.output = parseNum(parts[1]);
  return result;
}

export function aggregateByModel(accesslogEntries) {
  const statsMap = new Map();

  for (const entry of accesslogEntries) {
    const key = `${entry.provider}|${entry.model}`;
    const existing = statsMap.get(key);
    const parsedTokens = parseCompactTokenStr(entry.tokens);

    if (existing) {
      existing.requests++;
      if (entry.status >= 200 && entry.status < 400) {
        existing.success++;
      } else if (entry.status >= 400) {
        existing.failure++;
      }
      existing.durations.push(entry.duration || 0);
      existing.ttfbs.push(entry.ttfb || 0);
      existing.inputTokens += parsedTokens.input;
      existing.outputTokens += parsedTokens.output;
    } else {
      statsMap.set(key, {
        provider: entry.provider,
        model: entry.model,
        requests: 1,
        success: entry.status >= 200 && entry.status < 400 ? 1 : 0,
        failure: entry.status >= 400 ? 1 : 0,
        durations: [entry.duration || 0],
        ttfbs: [entry.ttfb || 0],
        inputTokens: parsedTokens.input,
        outputTokens: parsedTokens.output,
      });
    }
  }

  const results = [];
  for (const group of statsMap.values()) {
    const sortedDurations = [...group.durations].sort((a, b) => a - b);
    const sortedTtfbs = [...group.ttfbs].sort((a, b) => a - b);

    const totalDuration = sortedDurations.reduce((sum, d) => sum + d, 0);
    const totalTtfb = sortedTtfbs.reduce((sum, t) => sum + t, 0);

    results.push({
      provider: group.provider,
      model: group.model,
      requests: group.requests,
      success: group.success,
      failure: group.failure,
      successRate:
        group.requests > 0 ? ((group.success / group.requests) * 100).toFixed(2) + '%' : '0.00%',
      avgTtfb: group.requests > 0 ? Math.round(totalTtfb / group.requests) : 0,
      ttfbP95: calculatePercentile(sortedTtfbs, 95),
      ttfbP99: calculatePercentile(sortedTtfbs, 99),
      avgDuration: group.requests > 0 ? Math.round(totalDuration / group.requests) : 0,
      durationP95: calculatePercentile(sortedDurations, 95),
      durationP99: calculatePercentile(sortedDurations, 99),
      totalInputTokens: group.inputTokens || 0,
      totalOutputTokens: group.outputTokens || 0,
      avgInputTokens:
        group.requests > 0 ? Math.round((group.inputTokens || 0) / group.requests) : 0,
      avgOutputTokens:
        group.requests > 0 ? Math.round((group.outputTokens || 0) / group.requests) : 0,
    });
  }

  results.sort((a, b) => b.requests - a.requests);
  return results;
}

export function aggregateByProvider(accesslogEntries) {
  const statsMap = new Map();

  for (const entry of accesslogEntries) {
    const provider = entry.provider || 'unknown';
    const existing = statsMap.get(provider);

    if (existing) {
      existing.requests++;
      if (entry.status >= 200 && entry.status < 400) {
        existing.success++;
      } else if (entry.status >= 400) {
        existing.failure++;
      }
      existing.durations.push(entry.duration || 0);
      existing.ttfbs.push(entry.ttfb || 0);
    } else {
      statsMap.set(provider, {
        provider,
        requests: 1,
        success: entry.status >= 200 && entry.status < 400 ? 1 : 0,
        failure: entry.status >= 400 ? 1 : 0,
        durations: [entry.duration || 0],
        ttfbs: [entry.ttfb || 0],
      });
    }
  }

  const results = [];
  for (const group of statsMap.values()) {
    const sortedDurations = [...group.durations].sort((a, b) => a - b);
    const sortedTtfbs = [...group.ttfbs].sort((a, b) => a - b);

    const totalDuration = sortedDurations.reduce((sum, d) => sum + d, 0);
    const totalTtfb = sortedTtfbs.reduce((sum, t) => sum + t, 0);

    results.push({
      provider: group.provider,
      requests: group.requests,
      success: group.success,
      failure: group.failure,
      successRate:
        group.requests > 0 ? ((group.success / group.requests) * 100).toFixed(2) + '%' : '0.00%',
      avgTtfb: group.requests > 0 ? Math.round(totalTtfb / group.requests) : 0,
      ttfbP95: calculatePercentile(sortedTtfbs, 95),
      ttfbP99: calculatePercentile(sortedTtfbs, 99),
      avgDuration: group.requests > 0 ? Math.round(totalDuration / group.requests) : 0,
      durationP95: calculatePercentile(sortedDurations, 95),
      durationP99: calculatePercentile(sortedDurations, 99),
    });
  }

  results.sort((a, b) => b.requests - a.requests);
  return results;
}

function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) {
    return 0;
  }

  if (sortedArray.length === 1) {
    return sortedArray[0];
  }

  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) {
    return sortedArray[lower];
  }

  return sortedArray[lower] + fraction * (sortedArray[upper] - sortedArray[lower]);
}

export const modelStatsAnalyzer = {
  aggregateByModel,
  aggregateByProvider,
};

export function aggregateByCategory(accesslogEntries, sessions) {
  const sessionMap = new Map();
  for (const session of sessions) {
    sessionMap.set(session.id, session);
  }

  const categoryMap = new Map();

  for (const entry of accesslogEntries) {
    const category = entry.category || 'unknown';
    const existing = categoryMap.get(category);

    if (existing) {
      existing.callCount++;
      if (entry.status >= 200 && entry.status < 400) {
        existing.successCount++;
      }
      existing.totalCount++;
      if (entry.duration) {
        existing.durations.push(entry.duration);
      }
      if (entry.model) {
        existing.models.add(entry.model);
      }
    } else {
      categoryMap.set(category, {
        category,
        callCount: 1,
        successCount: entry.status >= 200 && entry.status < 400 ? 1 : 0,
        totalCount: 1,
        durations: entry.duration ? [entry.duration] : [],
        models: new Set(entry.model ? [entry.model] : []),
      });
    }
  }

  const results = [];
  for (const group of categoryMap.values()) {
    const stats = {
      category: group.category,
      callCount: group.callCount,
    };

    if (group.durations.length > 0) {
      stats.avgDuration = Math.round(
        group.durations.reduce((sum, d) => sum + d, 0) / group.durations.length
      );
    }

    if (group.totalCount > 0) {
      stats.successRate = Math.round((group.successCount / group.totalCount) * 10000) / 100;
    }

    if (group.models.size > 0) {
      stats.modelUsed = Array.from(group.models).join(', ');
    }

    results.push(stats);
  }

  results.sort((a, b) => b.callCount - a.callCount);
  return results;
}

export const categoryStatsAnalyzer = {
  aggregateByCategory,
};

/**
 * CategoryStatsAnalyzer - Aggregates category statistics from accesslog + database
 * Direct category capture (not inference-based)
 */

export class CategoryStatsAnalyzer {
  /**
   * Aggregate by category from accesslog entries
   * @param {Array} logEntries - Accesslog entries with category field
   * @param {Map} sessionData - Map of sessionId -> { duration, successRate, messages }
   * @returns {Array} Category stats with duration and successRate
   */
  aggregateByCategory(logEntries, sessionData) {
    const categoryMap = new Map();

    for (const entry of logEntries) {
      const category = entry.category || 'unknown';
      const sessionId = entry.sessionId;
      const model = entry.model;

      // Get session details from database
      const session = sessionData.get(sessionId) || {};
      const duration = session.durationSeconds || 0;
      const successRate = session.successRate || 0;

      const existing = categoryMap.get(category);
      if (existing) {
        existing.callCount++;
        existing.totalDuration += duration;
        existing.successCount += successRate >= 50 ? 1 : 0;
        existing.models.add(model);
      } else {
        categoryMap.set(category, {
          category,
          callCount: 1,
          totalDuration: duration,
          successCount: successRate >= 50 ? 1 : 0,
          models: new Set([model]),
          avgDuration: 0,
          successRate: 0,
          modelUsed: '',
        });
      }
    }

    // Calculate averages
    const results = Array.from(categoryMap.values());
    for (const stats of results) {
      stats.avgDuration =
        stats.callCount > 0 ? Math.round(stats.totalDuration / stats.callCount) : 0;
      stats.successRate =
        stats.callCount > 0 ? Math.round((stats.successCount / stats.callCount) * 100) : 0;
      stats.modelUsed = Array.from(stats.models).join(', ');
      delete stats.models; // Remove Set before returning
      delete stats.totalDuration;
      delete stats.successCount;
    }

    return results.sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Get category distribution with percentage
   */
  getCategoryDistribution(logEntries, sessionData) {
    const aggregated = this.aggregateByCategory(logEntries, sessionData);

    const totalCalls = aggregated.reduce((sum, stat) => sum + stat.callCount, 0);

    if (totalCalls === 0) {
      return aggregated;
    }

    for (const stat of aggregated) {
      stat.percentage = Math.round((stat.callCount / totalCalls) * 10000) / 100;
    }

    return aggregated;
  }

  /**
   * Get top categories by call count
   */
  getTopCategories(logEntries, sessionData, limit) {
    const aggregated = this.aggregateByCategory(logEntries, sessionData);
    return aggregated.slice(0, limit);
  }
}

export const categoryStatsAnalyzer = new CategoryStatsAnalyzer();

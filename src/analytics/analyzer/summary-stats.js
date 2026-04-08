/**
 * SummaryStatsAnalyzer - Aggregates overall analytics summary
 */

export class SummaryStatsAnalyzer {
  /**
   * Generate summary statistics from all data sources
   * @param {Array} logEntries - Accesslog entries
   * @param {Map} sessionMessages - Map of sessionId -> messages
   * @param {Map} sessionData - Map of sessionId -> { duration, successRate }
   * @returns {Object} Summary statistics
   */
  generateSummary(logEntries, sessionMessages, sessionData) {
    const uniqueSessions = new Set(logEntries.map((e) => e.sessionId).filter(Boolean));
    const uniqueModels = new Set(logEntries.map((e) => e.model).filter(Boolean));
    const uniqueCategories = new Set(logEntries.map((e) => e.category).filter(Boolean));

    // Count messages
    let totalMessages = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const messages of sessionMessages.values()) {
      totalMessages += messages.length;
      for (const msg of messages) {
        if (msg.data?.tokens) {
          totalInputTokens += msg.data.tokens.input || 0;
          totalOutputTokens += msg.data.tokens.output || 0;
        }
      }
    }

    // Find top model
    const modelCounts = new Map();
    for (const entry of logEntries) {
      const model = entry.model || 'unknown';
      modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
    }
    const topModel = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Find top agent
    const agentCounts = new Map();
    for (const messages of sessionMessages.values()) {
      for (const msg of messages) {
        const agent = msg.data?.agent?.toLowerCase().trim() || 'unknown';
        agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
      }
    }
    const topAgent = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Find top category
    const categoryCounts = new Map();
    for (const entry of logEntries) {
      const category = entry.category || 'unknown';
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    const topCategory =
      Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Calculate overall success rate
    let totalSuccess = 0;
    let totalWithDuration = 0;
    for (const session of sessionData.values()) {
      if (session.successRate !== undefined) {
        totalSuccess += session.successRate >= 50 ? 1 : 0;
        totalWithDuration++;
      }
    }
    const overallSuccessRate =
      totalWithDuration > 0 ? Math.round((totalSuccess / totalWithDuration) * 100) : 0;

    return {
      totalSessions: uniqueSessions.size,
      totalMessages,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      uniqueModels: uniqueModels.size,
      uniqueCategories: uniqueCategories.size,
      topModel,
      topAgent,
      topCategory,
      overallSuccessRate,
    };
  }
}

export const summaryStatsAnalyzer = new SummaryStatsAnalyzer();

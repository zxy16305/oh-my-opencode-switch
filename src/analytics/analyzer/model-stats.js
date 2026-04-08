/**
 * ModelStatsAnalyzer - Aggregates model usage statistics from accesslog + database
 */

export class ModelStatsAnalyzer {
  /**
   * Aggregate by model from accesslog entries with token data from messages
   * @param {Array} logEntries - Accesslog entries with category
   * @param {Map} sessionMessages - Map of sessionId -> messages array
   * @returns {Array} Model stats sorted by totalTokens DESC
   */
  aggregateByModel(logEntries, sessionMessages) {
    const statsMap = new Map();

    for (const entry of logEntries) {
      const model = entry.model || 'unknown';
      const provider = entry.provider || 'unknown';
      const sessionId = entry.sessionId;

      // Get tokens from session messages
      const messages = sessionMessages.get(sessionId) || [];
      const tokens = this.aggregateTokens(messages);

      const key = `${provider}/${model}`;
      const existing = statsMap.get(key);

      if (existing) {
        existing.callCount++;
        existing.inputTokens += tokens.input;
        existing.outputTokens += tokens.output;
        existing.totalTokens = existing.inputTokens + existing.outputTokens;
      } else {
        statsMap.set(key, {
          model,
          provider,
          callCount: 1,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          totalTokens: tokens.input + tokens.output,
          efficiency: 0,
        });
      }
    }

    const results = Array.from(statsMap.values());
    for (const stats of results) {
      stats.efficiency = this.calculateEfficiency(stats);
    }

    return results.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /**
   * Aggregate by provider only
   */
  aggregateByProvider(logEntries, sessionMessages) {
    const statsMap = new Map();

    for (const entry of logEntries) {
      const provider = entry.provider || 'unknown';
      const sessionId = entry.sessionId;

      const messages = sessionMessages.get(sessionId) || [];
      const tokens = this.aggregateTokens(messages);

      const existing = statsMap.get(provider);

      if (existing) {
        existing.callCount++;
        existing.inputTokens += tokens.input;
        existing.outputTokens += tokens.output;
        existing.totalTokens = existing.inputTokens + existing.outputTokens;
      } else {
        statsMap.set(provider, {
          model: 'all',
          provider,
          callCount: 1,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          totalTokens: tokens.input + tokens.output,
          efficiency: 0,
        });
      }
    }

    const results = Array.from(statsMap.values());
    for (const stats of results) {
      stats.efficiency = this.calculateEfficiency(stats);
    }

    return results.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /**
   * Aggregate tokens from messages array
   */
  aggregateTokens(messages) {
    let input = 0;
    let output = 0;

    for (const msg of messages) {
      if (msg.data && msg.data.tokens) {
        input += msg.data.tokens.input || 0;
        output += msg.data.tokens.output || 0;
      }
    }

    return { input, output };
  }

  /**
   * Calculate efficiency as output/input ratio
   */
  calculateEfficiency(stats) {
    if (stats.inputTokens === 0) return 0;
    return Math.round((stats.outputTokens / stats.inputTokens) * 100) / 100;
  }

  /**
   * Get top N models by input tokens
   */
  getTopModels(logEntries, sessionMessages, limit) {
    const aggregated = this.aggregateByModel(logEntries, sessionMessages);
    return aggregated.sort((a, b) => b.inputTokens - a.inputTokens).slice(0, limit);
  }
}

export const modelStatsAnalyzer = new ModelStatsAnalyzer();

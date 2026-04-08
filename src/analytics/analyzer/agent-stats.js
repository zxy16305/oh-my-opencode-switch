/**
 * AgentStatsAnalyzer - Aggregates agent usage statistics from database messages
 */

export class AgentStatsAnalyzer {
  /**
   * Normalize agent name (case-insensitive)
   */
  normalizeAgentName(agent) {
    if (!agent || agent.trim() === '') {
      return 'unknown';
    }
    return agent.toLowerCase().trim();
  }

  /**
   * Aggregate messages by agent
   * @param {Map} sessionMessages - Map of sessionId -> messages array
   * @returns {Array} Agent stats sorted by callCount DESC
   */
  aggregateByAgent(sessionMessages) {
    const agentMap = new Map();

    for (const [sessionId, messages] of sessionMessages) {
      for (const message of messages) {
        const agent = this.normalizeAgentName(message.data?.agent);

        const existing = agentMap.get(agent);
        if (existing) {
          existing.callCount++;
          existing.inputTokens += message.data?.tokens?.input || 0;
          existing.outputTokens += message.data?.tokens?.output || 0;
        } else {
          agentMap.set(agent, {
            agent,
            callCount: 1,
            inputTokens: message.data?.tokens?.input || 0,
            outputTokens: message.data?.tokens?.output || 0,
            percentage: 0,
          });
        }
      }
    }

    const results = Array.from(agentMap.values());
    results.sort((a, b) => b.callCount - a.callCount);

    return results;
  }

  /**
   * Get agent distribution with percentage breakdown
   */
  getAgentDistribution(sessionMessages) {
    const aggregated = this.aggregateByAgent(sessionMessages);

    const totalCalls = aggregated.reduce((sum, stat) => sum + stat.callCount, 0);

    if (totalCalls === 0) {
      return aggregated;
    }

    // Calculate percentage for each agent
    for (const stat of aggregated) {
      stat.percentage = Math.round((stat.callCount / totalCalls) * 10000) / 100;
    }

    // Ensure percentages sum to ~100%
    const totalPercentage = aggregated.reduce((sum, stat) => sum + stat.percentage, 0);
    const roundingError = Math.round((100 - totalPercentage) * 100) / 100;

    if (roundingError !== 0 && aggregated.length > 0) {
      aggregated[0].percentage = Math.round((aggregated[0].percentage + roundingError) * 100) / 100;
    }

    return aggregated;
  }
}

export const agentStatsAnalyzer = new AgentStatsAnalyzer();

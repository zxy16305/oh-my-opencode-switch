export function aggregateByAgent(messages) {
  const agentMap = new Map();

  for (const message of messages) {
    const agent = message.agent || 'unknown';
    const existing = agentMap.get(agent);

    if (existing) {
      existing.callCount++;
      existing.inputTokens += message.tokens?.input || 0;
      existing.outputTokens += message.tokens?.output || 0;
    } else {
      agentMap.set(agent, {
        agent,
        callCount: 1,
        inputTokens: message.tokens?.input || 0,
        outputTokens: message.tokens?.output || 0,
        percentage: 0,
      });
    }
  }

  const results = Array.from(agentMap.values());
  results.sort((a, b) => b.callCount - a.callCount);

  return results;
}

export function getAgentDistribution(messages) {
  const aggregated = aggregateByAgent(messages);

  const totalCalls = aggregated.reduce((sum, stat) => sum + stat.callCount, 0);

  if (totalCalls === 0) {
    return aggregated;
  }

  for (const stat of aggregated) {
    stat.percentage = Math.round((stat.callCount / totalCalls) * 10000) / 100;
  }

  const totalPercentage = aggregated.reduce((sum, stat) => sum + stat.percentage, 0);
  const roundingError = Math.round((100 - totalPercentage) * 100) / 100;

  if (roundingError !== 0 && aggregated.length > 0) {
    aggregated[0].percentage = Math.round((aggregated[0].percentage + roundingError) * 100) / 100;
  }

  return aggregated;
}

export const agentStatsAnalyzer = {
  aggregateByAgent,
  getAgentDistribution,
};

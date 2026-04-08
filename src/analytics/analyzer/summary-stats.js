export function aggregateSummary(accesslogEntries, sessions, messages) {
  const totalRequests = accesslogEntries.length;
  const totalSessions = new Set(accesslogEntries.map((e) => e.sessionId).filter(Boolean)).size;
  const totalMessages = messages.length;

  const totalInputTokens = messages.reduce((sum, m) => sum + (m.tokens?.input || 0), 0);
  const totalOutputTokens = messages.reduce((sum, m) => sum + (m.tokens?.output || 0), 0);

  const modelCounts = new Map();
  const agentCounts = new Map();

  for (const entry of accesslogEntries) {
    const model = entry.model || 'unknown';
    modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
  }

  for (const msg of messages) {
    const agent = msg.agent || 'unknown';
    agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
  }

  const topModel = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const topAgent = Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const successCount = accesslogEntries.filter((e) => e.status >= 200 && e.status < 400).length;
  const failureCount = accesslogEntries.filter((e) => e.status >= 400).length;
  const successRate =
    totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(2) + '%' : '0.00%';

  const avgDuration =
    totalRequests > 0
      ? Math.round(accesslogEntries.reduce((sum, e) => sum + (e.duration || 0), 0) / totalRequests)
      : 0;

  const avgTtfb =
    totalRequests > 0
      ? Math.round(accesslogEntries.reduce((sum, e) => sum + (e.ttfb || 0), 0) / totalRequests)
      : 0;

  return {
    totalRequests,
    totalSessions,
    totalMessages,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    topModel,
    topAgent,
    successRate,
    successCount,
    failureCount,
    avgDuration,
    avgTtfb,
  };
}

export const summaryStatsAnalyzer = {
  aggregateSummary,
};

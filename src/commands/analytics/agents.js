import { logger } from '../../utils/logger.js';
import { parseTimeRange } from '../../utils/stats.js';
import { getAllMessages } from '../../analytics/reader/database-reader.js';
import { agentStatsAnalyzer } from '../../analytics/analyzer/agent-stats.js';

export function registerAgentsCommand(analyticsCmd) {
  analyticsCmd
    .command('agents')
    .description('Show agent usage statistics')
    .option('--last <range>', 'Time range (e.g., 24h, 7d)', '24h')
    .action(async (options) => {
      try {
        const { startTime, endTime } = parseTimeRange(options.last);

        const messages = await getAllMessages({ startTime, endTime });

        if (messages.length === 0) {
          logger.warn(`No agent data found for time range: ${options.last}`);
          return;
        }

        const agentStats = agentStatsAnalyzer.getAgentDistribution(messages);

        const tableData = agentStats.map((s) => ({
          Agent: s.agent,
          Calls: s.callCount,
          Percentage: `${s.percentage.toFixed(2)}%`,
          'Input Tokens': s.inputTokens.toLocaleString(),
          'Output Tokens': s.outputTokens.toLocaleString(),
          'Total Tokens': (s.inputTokens + s.outputTokens).toLocaleString(),
        }));

        logger.raw(`\nAgent Usage Statistics (${options.last})\n`);
        console.table(tableData);

        const totalCalls = agentStats.reduce((sum, s) => sum + s.callCount, 0);
        const totalInputTokens = agentStats.reduce((sum, s) => sum + s.inputTokens, 0);
        const totalOutputTokens = agentStats.reduce((sum, s) => sum + s.outputTokens, 0);

        logger.raw(`\nTotal: ${totalCalls} calls`);
        logger.raw(`Total Input Tokens: ${totalInputTokens.toLocaleString()}`);
        logger.raw(`Total Output Tokens: ${totalOutputTokens.toLocaleString()}`);
        logger.raw(`Total Tokens: ${(totalInputTokens + totalOutputTokens).toLocaleString()}\n`);
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
    });
}

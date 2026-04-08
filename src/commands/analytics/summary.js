import { logger } from '../../utils/logger.js';
import { parseTimeRange } from '../../utils/stats.js';
import { readAccesslog } from '../../analytics/reader/accesslog-reader.js';
import { getAllSessions, getAllMessages } from '../../analytics/reader/database-reader.js';
import { summaryStatsAnalyzer } from '../../analytics/analyzer/summary-stats.js';

export function registerSummaryCommand(analyticsCmd) {
  analyticsCmd
    .command('summary')
    .description('Show usage summary statistics')
    .option('--last <range>', 'Time range (e.g., 24h, 7d)', '24h')
    .action(async (options) => {
      try {
        const { startTime, endTime } = parseTimeRange(options.last);

        const accesslogEntries = await readAccesslog({ startTime, endTime });
        const sessions = await getAllSessions({ startTime, endTime });
        const messages = await getAllMessages({ startTime, endTime });

        if (accesslogEntries.length === 0 && messages.length === 0) {
          logger.warn(`No analytics data found for time range: ${options.last}`);
          return;
        }

        const summary = summaryStatsAnalyzer.aggregateSummary(accesslogEntries, sessions, messages);

        const tableData = [
          { Metric: 'Total Requests', Value: summary.totalRequests },
          { Metric: 'Total Sessions', Value: summary.totalSessions },
          { Metric: 'Total Messages', Value: summary.totalMessages },
          { Metric: 'Total Input Tokens', Value: summary.totalInputTokens.toLocaleString() },
          { Metric: 'Total Output Tokens', Value: summary.totalOutputTokens.toLocaleString() },
          { Metric: 'Total Tokens', Value: summary.totalTokens.toLocaleString() },
          { Metric: 'Top Model', Value: summary.topModel },
          { Metric: 'Top Agent', Value: summary.topAgent },
          { Metric: 'Success Rate', Value: summary.successRate },
          { Metric: 'Avg Duration', Value: `${summary.avgDuration}ms` },
          { Metric: 'Avg TTFB', Value: `${summary.avgTtfb}ms` },
        ];

        logger.raw(`\nAnalytics Summary (${options.last})\n`);
        console.table(tableData);
        logger.raw('');
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
    });
}

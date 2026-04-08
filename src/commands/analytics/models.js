import { logger } from '../../utils/logger.js';
import { parseTimeRange } from '../../utils/stats.js';
import { readAccesslog } from '../../analytics/reader/accesslog-reader.js';
import { modelStatsAnalyzer } from '../../analytics/analyzer/model-stats.js';

export function registerModelsCommand(analyticsCmd) {
  analyticsCmd
    .command('models')
    .description('Show model usage statistics')
    .option('--last <range>', 'Time range (e.g., 24h, 7d)', '24h')
    .option('--top <n>', 'Show top N models', '10')
    .option('--by-provider', 'Aggregate by provider instead of model')
    .action(async (options) => {
      try {
        const { startTime, endTime } = parseTimeRange(options.last);

        const accesslogEntries = await readAccesslog({ startTime, endTime });

        if (accesslogEntries.length === 0) {
          logger.warn(`No model data found for time range: ${options.last}`);
          return;
        }

        let stats;
        if (options.byProvider) {
          stats = modelStatsAnalyzer.aggregateByProvider(accesslogEntries);
        } else {
          stats = modelStatsAnalyzer.aggregateByModel(accesslogEntries);
        }

        const topN = parseInt(options.top, 10);
        const limitedStats = stats.slice(0, topN);

        const tableData = limitedStats.map((s) => ({
          Provider: s.provider,
          Model: s.model || 'N/A',
          Requests: s.requests,
          Success: s.success,
          Failure: s.failure,
          'Success Rate': s.successRate,
          'Avg TTFB': `${s.avgTtfb}ms`,
          'TTFB P95': `${s.ttfbP95}ms`,
          'Avg Duration': `${s.avgDuration}ms`,
          'Duration P95': `${s.durationP95}ms`,
        }));

        const groupType = options.byProvider ? 'Provider' : 'Model';
        logger.raw(`\n${groupType} Usage Statistics (${options.last})\n`);
        console.table(tableData);

        const totalRequests = stats.reduce((sum, s) => sum + s.requests, 0);
        const totalSuccess = stats.reduce((sum, s) => sum + s.success, 0);
        const totalFailure = stats.reduce((sum, s) => sum + s.failure, 0);

        logger.raw(
          `\nTotal: ${totalRequests} requests (${totalSuccess} success, ${totalFailure} failure)`
        );
        logger.raw(
          `Showing top ${Math.min(topN, stats.length)} of ${stats.length} ${options.byProvider ? 'providers' : 'models'}\n`
        );
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
    });
}

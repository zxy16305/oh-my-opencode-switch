import { logger } from '../../utils/logger.js';
import { parseTimeRange } from '../../utils/stats.js';
import { readAccesslog } from '../../analytics/reader/accesslog-reader.js';
import { getAllSessions } from '../../analytics/reader/database-reader.js';
import { categoryStatsAnalyzer } from '../../analytics/analyzer/category-stats.js';

export function registerCategoriesCommand(analyticsCmd) {
  analyticsCmd
    .command('categories')
    .description('Show category usage statistics (from accesslog)')
    .option('--last <range>', 'Time range (e.g., 24h, 7d)', '24h')
    .action(async (options) => {
      try {
        const { startTime, endTime } = parseTimeRange(options.last);

        const accesslogEntries = await readAccesslog({ startTime, endTime });
        const sessions = await getAllSessions({ startTime, endTime });

        if (accesslogEntries.length === 0) {
          logger.warn(`No category data found for time range: ${options.last}`);
          return;
        }

        const categoryStats = categoryStatsAnalyzer.aggregateByCategory(accesslogEntries, sessions);

        if (categoryStats.length === 0) {
          logger.warn('No categories found in accesslog data');
          return;
        }

        const tableData = categoryStats.map((s) => ({
          Category: s.category,
          Calls: s.callCount,
          'Success Rate': s.successRate !== undefined ? `${s.successRate.toFixed(2)}%` : 'N/A',
          'Avg Duration': s.avgDuration !== undefined ? `${s.avgDuration}ms` : 'N/A',
          'Models Used': s.modelUsed || 'N/A',
        }));

        logger.raw(`\nCategory Usage Statistics (${options.last})\n`);
        console.table(tableData);

        const totalCalls = categoryStats.reduce((sum, s) => sum + s.callCount, 0);
        logger.raw(`\nTotal: ${totalCalls} calls across ${categoryStats.length} categories\n`);
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
    });
}

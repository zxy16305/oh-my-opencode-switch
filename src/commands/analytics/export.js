import { logger } from '../../utils/logger.js';
import { parseTimeRange } from '../../utils/stats.js';
import { readAccesslog } from '../../analytics/reader/accesslog-reader.js';
import { getAllSessions, getAllMessages } from '../../analytics/reader/database-reader.js';
import { exportToJson } from '../../analytics/exporter/json-export.js';
import { exportToCsv } from '../../analytics/exporter/csv-export.js';

export function registerExportCommand(analyticsCmd) {
  analyticsCmd
    .command('export')
    .description('Export analytics data to JSON or CSV format')
    .option('--format <format>', 'Export format (json or csv)', 'json')
    .option('--output <filename>', 'Output file path')
    .option('--last <range>', 'Time range (e.g., 24h, 7d)', '24h')
    .action(async (options) => {
      try {
        const format = options.format;

        if (format !== 'json' && format !== 'csv') {
          logger.error('Format must be either "json" or "csv"');
          process.exit(1);
        }

        const { startTime, endTime } = parseTimeRange(options.last);

        const accesslogEntries = await readAccesslog({ startTime, endTime });
        const sessions = await getAllSessions({ startTime, endTime });
        const messages = await getAllMessages({ startTime, endTime });

        if (accesslogEntries.length === 0 && messages.length === 0 && sessions.length === 0) {
          logger.warn(`No analytics data found for time range: ${options.last}`);
          return;
        }

        const defaultFilename = `analytics-export-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`;
        const outputPath = options.output || defaultFilename;

        const exportData = {
          accesslog: accesslogEntries.map((entry) => ({
            timestamp: entry.timestamp?.toISOString(),
            sessionId: entry.sessionId,
            category: entry.category,
            provider: entry.provider,
            model: entry.model,
            virtualModel: entry.virtualModel,
            status: entry.status,
            ttfb: entry.ttfb,
            duration: entry.duration,
          })),
          sessions: sessions.map((session) => ({
            id: session.id,
            projectId: session.projectId,
            title: session.title,
            directory: session.directory,
            timeCreated: session.timeCreated,
            timeUpdated: session.timeUpdated,
            durationSeconds: session.durationSeconds,
          })),
          messages: messages.map((msg) => ({
            id: msg.id,
            session_id: msg.session_id,
            time_created: msg.time_created,
            role: msg.role,
            agent: msg.agent,
            modelID: msg.modelID,
            providerID: msg.providerID,
            tokens: msg.tokens,
            finish: msg.finish,
          })),
          exportTimestamp: new Date().toISOString(),
          timeRange: {
            last: options.last,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        };

        let result;
        if (format === 'json') {
          result = await exportToJson(exportData, outputPath);
        } else {
          const flatData = [
            ...exportData.messages.map((msg) => ({
              type: 'message',
              ...msg,
              tokens_input: msg.tokens?.input,
              tokens_output: msg.tokens?.output,
            })),
          ];
          result = await exportToCsv(flatData, outputPath);
        }

        logger.success(`Exported to ${result.filePath}`);
        logger.raw(`  Records: ${result.recordCount}`);
        logger.raw(`  File size: ${(result.fileSize / 1024).toFixed(2)} KB`);
        logger.raw(`  Time range: ${options.last}`);
        logger.raw('');
      } catch (error) {
        logger.error(error.message);
        process.exit(1);
      }
    });
}

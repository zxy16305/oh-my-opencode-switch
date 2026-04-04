import { ProxyConfigManager } from '../core/ProxyConfigManager.js';
import { logger } from '../utils/logger.js';
import { getProxyConfigPath } from '../utils/proxy-paths.js';
import { exists } from '../utils/files.js';
import { getDefaultProxyConfig } from '../utils/proxy-default-config.js';
import { readLogs, getLogPath, clearLogs } from '../utils/access-log.js';
import { parseTimeRange, generateStats } from '../utils/stats.js';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { ProxyServerManager } from '../proxy/server-manager.js';

// Singleton instance of ProxyServerManager
const serverManager = new ProxyServerManager();

// Time slot calculator for time-slots command
const timeSlotCalculator = createTimeSlotWeightCalculator();

/**
 * Start the proxy server
 * @param {object} options - CLI options
 * @param {number} [options.port] - Port to listen on
 * @param {string} [options.config] - Path to config file
 */
export async function startAction(options = {}) {
  await serverManager.start(options);
}

/**
 * Stop the proxy server
 */
export async function stopAction() {
  await serverManager.stop();
}

/**
 * Show proxy server status
 */
export async function statusAction() {
  const configManager = new ProxyConfigManager();
  const config = await configManager.readConfig();
  const configPath = getProxyConfigPath();
  const status = serverManager.getStatus();

  console.log('');
  console.log('Proxy Server Status');
  console.log('===================');

  if (status.running) {
    console.log(`  Status:    Running`);
    console.log(`  Port:      ${status.port}`);
    console.log(`  PID:       ${status.pid}`);
  } else {
    console.log(`  Status:    Not running`);
  }

  console.log(`  Config:    ${configPath}`);

  if (config && config.routes) {
    const models = Object.keys(config.routes);
    console.log(`  Routes:    ${models.length} configured`);
    if (models.length > 0) {
      for (const model of models) {
        const route = config.routes[model];
        const upstreamCount = route.upstreams?.length || 0;
        console.log(`    - ${model}: ${upstreamCount} upstream(s)`);
      }
    }
  } else {
    console.log(`  Routes:    Not configured`);
  }

  console.log('');
}

/**
 * Show proxy access logs
 * @param {object} options - CLI options
 */
export async function logsAction(options = {}) {
  const lines = parseInt(options.lines, 10) || 50;
  const logPath = getLogPath();

  console.log(`\nProxy Access Logs (${logPath})\n`);

  if (options.clear) {
    await clearLogs();
    logger.success('Logs cleared.');
    return;
  }

  const logs = await readLogs(lines);
  if (logs.length === 0) {
    console.log('No logs found.');
    return;
  }

  for (const line of logs) {
    console.log(line);
  }

  console.log(`\nShowing last ${logs.length} entries.`);
}

/**
 * Show proxy access statistics
 * @param {object} options - CLI options
 */
export async function statsAction(options = {}) {
  const { last, json } = options;

  if (!last) {
    logger.error('--last option is required (e.g., 1h, 24h, 7d, 30d)');
    process.exit(1);
  }

  try {
    const { startTime, endTime } = parseTimeRange(last);
    const stats = await generateStats({ startTime, endTime });

    if (stats.length === 0) {
      logger.warn(`No statistics found for time range: ${last}`);
      return;
    }

    if (json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      const tableData = stats.map((s) => ({
        Provider: s.provider,
        Model: s.model,
        Requests: s.requests,
        Success: s.success,
        Failure: s.failure,
        'Success Rate': s.successRate,
        'Avg TTFB': s.avgTtfb,
        'TTFB P95': s.ttfbP95,
        'TTFB P99': s.ttfbP99,
        'Avg Duration': s.avgDuration,
        'Duration P95': s.p95,
        'Duration P99': s.p99,
      }));
      console.table(tableData);
    }
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }
}

/**
 * Show time slot error rates and weight coefficients for providers
 * @param {object} options - CLI options
 * @param {string} [options.provider] - Filter by specific provider
 */
export async function timeSlotsAction(options = {}) {
  try {
    await timeSlotCalculator.load();

    const tracker = timeSlotCalculator.getTracker();
    let providers = tracker.getProviders();

    if (options.provider) {
      if (!providers.includes(options.provider)) {
        logger.warn(`Provider "${options.provider}" not found in time slot data.`);
        logger.info(`Available providers: ${providers.length > 0 ? providers.join(', ') : 'none'}`);
        return;
      }
      providers = [options.provider];
    }

    if (providers.length === 0) {
      logger.info('No time slot data available. Run the proxy server to collect data.');
      return;
    }

    const currentHour = timeSlotCalculator.getCurrentHour();
    const tableData = [];

    for (const provider of providers) {
      const totalStats = tracker.calculateTotalErrorRate(provider, 7);
      const hourlyStats = tracker.calculateHourlyErrorRate(provider, currentHour, 7);
      const currentWeight = timeSlotCalculator.getTimeSlotWeight(provider, currentHour);

      tableData.push({
        Provider: provider,
        'Current Hour': currentHour,
        'Hour Error Rate': hourlyStats.sufficientData
          ? `${(hourlyStats.errorRate * 100).toFixed(2)}%`
          : 'N/A (insufficient data)',
        'Total Error Rate': totalStats.sufficientData
          ? `${(totalStats.errorRate * 100).toFixed(2)}%`
          : 'N/A (insufficient data)',
        'Weight Coeff': currentWeight.toFixed(2),
        'Data Days': `${hourlyStats.dataDays}/7`,
      });
    }

    console.log('\nTime Slot Statistics\n');
    console.table(tableData);
    console.log(`\nCurrent hour: ${currentHour}:00`);
    console.log('Weight coefficients: 0.5 (danger), 1.0 (neutral), 2.0 (good)');
    console.log('Data based on last 7 days of statistics.\n');
  } catch (error) {
    logger.error(`Failed to load time slot data: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Initialize proxy configuration file
 * @param {object} options - CLI options
 */
export async function initAction(options = {}) {
  const configPath = getProxyConfigPath();
  const force = options.force || false;

  if (await exists(configPath)) {
    if (!force) {
      logger.warn(`Proxy config already exists at ${configPath}`);
      logger.info('Use --force to overwrite, or edit the file directly.');
      return;
    }
    logger.info(`Overwriting existing config at ${configPath}`);
  }

  const configManager = new ProxyConfigManager();
  const defaultConfig = getDefaultProxyConfig();

  await configManager.writeConfig(defaultConfig);

  logger.success(`Created proxy config at ${configPath}`);
  logger.info('Edit the file to add your API keys and routes.');
}

/**
 * Register proxy commands with Commander program
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerProxyCommands(program) {
  const proxy = program.command('proxy').description('Manage proxy server');

  proxy
    .command('start')
    .description('Start the proxy server')
    .option('-p, --port <port>', 'Port to listen on (overrides config file)')
    .option('-c, --config <path>', 'Path to config file')
    .action(startAction);

  proxy.command('stop').description('Stop the proxy server').action(stopAction);

  proxy.command('status').description('Show proxy server status').action(statusAction);

  proxy
    .command('logs')
    .description('Show proxy access logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-c, --clear', 'Clear the log file')
    .action(logsAction);

  proxy
    .command('stats')
    .description('Show proxy access statistics')
    .requiredOption('-l, --last <duration>', 'Time range (e.g., 1h, 24h, 7d, 30d)')
    .option('--json', 'Output as JSON')
    .action(statsAction);

  proxy
    .command('time-slots')
    .description('Show time slot error rates and weight coefficients for providers')
    .option('-p, --provider <name>', 'Filter by specific provider')
    .action(timeSlotsAction);

  proxy
    .command('init')
    .description('Initialize proxy configuration file')
    .option('-f, --force', 'Overwrite existing config file')
    .action(initAction);
}

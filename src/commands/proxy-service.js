import { fileURLToPath } from 'url';
import path from 'path';
import { logger } from '../utils/logger.js';
import { OosError } from '../utils/errors.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT_PATH = path.join(__dirname, '..', '..', 'bin', 'oos-proxy-daemon.js');

const SERVICE_NAME = 'OOS Proxy';
const SERVICE_ID = 'oosproxy';

export class AdminRequiredError extends OosError {
  constructor(message = 'Administrator privileges required. Please run as administrator.') {
    super(message, 'ADMIN_REQUIRED', 1);
  }
}

async function checkAdminPrivileges() {
  if (process.platform !== 'win32') {
    throw new OosError(
      'Windows service management is only supported on Windows.',
      'PLATFORM_ERROR',
      1
    );
  }

  try {
    const { execSync } = await import('child_process');
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function getNodePath() {
  const { execSync } = await import('child_process');
  try {
    return execSync('where node', { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    return 'node';
  }
}

export async function installService(options = {}) {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  const configManager = new ProxyConfigManager();
  const config = await configManager.readConfig();
  const port = parseInt(options.port, 10) || config?.port || 3000;
  const nodePath = await getNodePath();

  const { execSync } = await import('child_process');

  try {
    const binPath = `${nodePath} ${DAEMON_SCRIPT_PATH}`;
    execSync(
      `sc create "${SERVICE_ID}" binPath= "${binPath}" DisplayName= "${SERVICE_NAME}" start= auto`,
      { encoding: 'utf8' }
    );
    logger.success(`Windows service "${SERVICE_NAME}" installed.`);
    logger.info(`Port: ${port} (from config)`);
    logger.info('Start: oos proxy start');
  } catch (error) {
    logger.error(`Failed to install service: ${error.message}`);
    throw error;
  }
}

export async function uninstallService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  const { execSync } = await import('child_process');

  try {
    execSync(`sc stop "${SERVICE_ID}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // service may not be running
  }

  try {
    execSync(`sc delete "${SERVICE_ID}"`, { encoding: 'utf8' });
    logger.success(`Windows service "${SERVICE_NAME}" uninstalled.`);
  } catch (error) {
    logger.error(`Failed to uninstall service: ${error.message}`);
    throw error;
  }
}

export async function restartService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  const { execSync } = await import('child_process');

  try {
    const status = execSync(`sc query "${SERVICE_ID}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (status.includes('RUNNING')) {
      logger.info('Stopping service...');
      execSync(`net stop "${SERVICE_ID}"`, { encoding: 'utf8' });
      logger.success('Service stopped.');
    }

    logger.info('Starting service...');
    execSync(`net start "${SERVICE_ID}"`, { encoding: 'utf8' });
    logger.success(`Windows service "${SERVICE_NAME}" started.`);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';
    const message = error.message || '';

    if (
      stderr.includes('does not exist') ||
      stderr.includes('not found') ||
      stdout.includes('does not exist') ||
      stdout.includes('not found') ||
      message.includes('Command failed')
    ) {
      logger.error(`Service "${SERVICE_NAME}" is not installed.`);
      logger.info('Run "oos proxy install" first (requires admin).');
      process.exit(1);
    }
    throw error;
  }
}

export function registerProxyServiceCommands(program) {
  const proxy = program.commands.find((cmd) => cmd.name() === 'proxy');
  if (!proxy) {
    logger.error('Proxy command not found.');
    return;
  }

  proxy
    .command('install')
    .description('Install OOS Proxy as a Windows service')
    .option('-p, --port <port>', 'Port (overrides config file)')
    .action(async (options) => {
      try {
        await installService(options);
      } catch (error) {
        if (error instanceof OosError) {
          logger.error(error.message);
          process.exit(error.exitCode || 1);
        }
        throw error;
      }
    });

  proxy
    .command('uninstall')
    .description('Uninstall the OOS Proxy Windows service')
    .action(async () => {
      try {
        await uninstallService();
      } catch (error) {
        if (error instanceof OosError) {
          logger.error(error.message);
          process.exit(error.exitCode || 1);
        }
        throw error;
      }
    });

  proxy
    .command('restart')
    .description('Restart the OOS Proxy Windows service')
    .action(async () => {
      try {
        await restartService();
      } catch (error) {
        if (error instanceof OosError) {
          logger.error(error.message);
          process.exit(error.exitCode || 1);
        }
        throw error;
      }
    });
}

import { fileURLToPath } from 'url';
import path from 'path';
import { logger } from '../utils/logger.js';
import { OosError } from '../utils/errors.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT_PATH = path.join(__dirname, '..', '..', 'bin', 'oos-proxy-daemon.js');

const SERVICE_NAME = 'OOS Proxy';
const SERVICE_DESCRIPTION = 'OOS Proxy Server - Load balancing proxy for OpenCode';

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

export async function installService(options = {}) {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  const configManager = new ProxyConfigManager();
  const config = await configManager.readConfig();

  const port = parseInt(options.port, 10) || config?.port || 3000;

  try {
    const nw = await import('node-windows');
    const ServiceClass = nw.Service || nw.default?.Service;

    if (!ServiceClass) {
      throw new Error('Failed to load node-windows Service class');
    }

    const svc = new ServiceClass({
      name: SERVICE_NAME,
      description: SERVICE_DESCRIPTION,
      script: DAEMON_SCRIPT_PATH,
      env: [{ name: 'PORT', value: String(port) }],
    });

    return new Promise((resolve, reject) => {
      svc.on('install', () => {
        logger.success(`Windows service "${SERVICE_NAME}" installed successfully.`);
        logger.info(`Service will run on port ${port}.`);
        logger.info('Start via: oos proxy start or Windows Services');
        resolve();
      });

      svc.on('error', (err) => {
        logger.error(`Failed to install service: ${err.message}`);
        reject(err);
      });

      svc.on('invalidinstallation', () => {
        const err = new Error('Invalid installation detected');
        logger.error('Invalid installation detected. Service may not be properly configured.');
        reject(err);
      });

      svc.install();
    });
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      logger.error('node-windows package not found. Please run: npm install node-windows');
      process.exit(1);
    }
    throw error;
  }
}

export async function uninstallService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  try {
    const nw = await import('node-windows');
    const ServiceClass = nw.Service || nw.default?.Service;

    if (!ServiceClass) {
      throw new Error('Failed to load node-windows Service class');
    }

    const svc = new ServiceClass({
      name: SERVICE_NAME,
      script: DAEMON_SCRIPT_PATH,
    });

    return new Promise((resolve, reject) => {
      svc.on('uninstall', () => {
        logger.success(`Windows service "${SERVICE_NAME}" uninstalled successfully.`);
        resolve();
      });

      svc.on('error', (err) => {
        logger.error(`Failed to uninstall service: ${err.message}`);
        reject(err);
      });

      svc.uninstall();
    });
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      logger.error('node-windows package not found. Please run: npm install node-windows');
      process.exit(1);
    }
    throw error;
  }
}

export async function restartService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  const { execSync } = await import('child_process');
  const serviceName = 'OOS Proxy';

  try {
    const status = execSync(`sc query "${serviceName}"`, { encoding: 'utf8' });

    if (status.includes('RUNNING')) {
      logger.info('Stopping service...');
      execSync(`net stop "${serviceName}"`, { encoding: 'utf8' });
      logger.success('Service stopped.');
    }

    logger.info('Starting service...');
    execSync(`net start "${serviceName}"`, { encoding: 'utf8' });
    logger.success(`Windows service "${serviceName}" started successfully.`);
  } catch (error) {
    if (error.message.includes('does not exist') || error.message.includes('not found')) {
      logger.error(`Service "${serviceName}" is not installed. Run "oos proxy install" first.`);
      process.exit(1);
    }
    throw error;
  }
}

export function registerProxyServiceCommands(program) {
  const proxy = program.commands.find((cmd) => cmd.name() === 'proxy');
  if (!proxy) {
    logger.error('Proxy command not found. Make sure proxy commands are registered first.');
    return;
  }

  proxy
    .command('install')
    .description('Install OOS Proxy as a Windows service')
    .option('-p, --port <port>', 'Port for the proxy service (overrides config file)')
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

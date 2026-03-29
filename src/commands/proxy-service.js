import { fileURLToPath } from 'url';
import path from 'path';
import { logger } from '../utils/logger.js';
import { OosError } from '../utils/errors.js';
import { ProxyConfigManager } from '../core/ProxyConfigManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_SCRIPT_PATH = path.join(__dirname, '..', '..', 'bin', 'oos-proxy-service.js');

const SERVICE_NAME = 'OOS Proxy';
const SERVICE_ID = 'oos-proxy';
const NSSM_URL = 'https://nssm.cc/download';

export class AdminRequiredError extends OosError {
  constructor(message = 'Administrator privileges required. Please run as administrator.') {
    super(message, 'ADMIN_REQUIRED', 1);
  }
}

export class NssmNotFoundError extends OosError {
  constructor() {
    super(
      `NSSM not found. Please download from ${NSSM_URL} and place nssm.exe in your PATH.`,
      'NSSM_NOT_FOUND',
      1
    );
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

async function findNssm() {
  const { execSync } = await import('child_process');
  try {
    const nssmPath = execSync('where nssm', { encoding: 'utf8' }).trim();
    return nssmPath.split('\n')[0];
  } catch {
    throw new NssmNotFoundError();
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

function getLogPath() {
  const homePath = process.env.USERPROFILE || process.env.HOME;
  return path.join(homePath, '.config', 'opencode', '.oos', 'logs');
}

export async function installService(options = {}) {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  await findNssm();

  const configManager = new ProxyConfigManager();
  const config = await configManager.readConfig();
  const port = parseInt(options.port, 10) || config?.port || 3000;
  const nodePath = await getNodePath();
  const logPath = getLogPath();

  const { execSync } = await import('child_process');

  try {
    logger.info('Installing Windows service using NSSM...');
    logger.debug(`Node path: ${nodePath}`);
    logger.debug(`Script: ${SERVICE_SCRIPT_PATH}`);

    execSync(`nssm install ${SERVICE_ID} ${nodePath} ${SERVICE_SCRIPT_PATH}`, {
      encoding: 'utf8',
    });

    const cwd = path.dirname(path.dirname(SERVICE_SCRIPT_PATH));
    execSync(`nssm set ${SERVICE_ID} AppDirectory ${cwd}`, { encoding: 'utf8' });

    execSync(`nssm set ${SERVICE_ID} AppStdout ${path.join(logPath, 'proxy-stdout.log')}`, {
      encoding: 'utf8',
    });
    execSync(`nssm set ${SERVICE_ID} AppStderr ${path.join(logPath, 'proxy-stderr.log')}`, {
      encoding: 'utf8',
    });

    execSync(`nssm set ${SERVICE_ID} DisplayName "${SERVICE_NAME}"`, { encoding: 'utf8' });
    execSync(`nssm set ${SERVICE_ID} Start SERVICE_AUTO_START`, { encoding: 'utf8' });

    logger.success(`Windows service "${SERVICE_NAME}" installed.`);
    logger.info(`Service ID: ${SERVICE_ID}`);
    logger.info(`Port: ${port} (from config)`);
    logger.info(`Logs: ${logPath}`);
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

  await findNssm();

  const { execSync } = await import('child_process');

  try {
    execSync(`nssm stop ${SERVICE_ID}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // service may not be running
  }

  try {
    execSync(`nssm remove ${SERVICE_ID} confirm`, { encoding: 'utf8' });
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

  await findNssm();

  const { execSync } = await import('child_process');

  try {
    execSync(`nssm restart ${SERVICE_ID}`, { encoding: 'utf8' });
    logger.success(`Windows service "${SERVICE_NAME}" restarted.`);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (
      stderr.includes('does not exist') ||
      stderr.includes('not found') ||
      stderr.includes('service is not installed')
    ) {
      logger.error(`Service "${SERVICE_NAME}" is not installed.`);
      logger.info('Run "oos proxy install" first (requires admin + NSSM).');
      process.exit(1);
    }
    throw error;
  }
}

export async function startService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  await findNssm();

  const { execSync } = await import('child_process');

  try {
    execSync(`nssm start ${SERVICE_ID}`, { encoding: 'utf8' });
    logger.success(`Windows service "${SERVICE_NAME}" started.`);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (stderr.includes('does not exist') || stderr.includes('not found')) {
      logger.error(`Service "${SERVICE_NAME}" is not installed.`);
      logger.info('Run "oos proxy install" first (requires admin + NSSM).');
      process.exit(1);
    }
    throw error;
  }
}

export async function stopService() {
  const isAdmin = await checkAdminPrivileges();
  if (!isAdmin) {
    throw new AdminRequiredError();
  }

  await findNssm();

  const { execSync } = await import('child_process');

  try {
    execSync(`nssm stop ${SERVICE_ID}`, { encoding: 'utf8' });
    logger.success(`Windows service "${SERVICE_NAME}" stopped.`);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (stderr.includes('does not exist') || stderr.includes('not found')) {
      logger.error(`Service "${SERVICE_NAME}" is not installed.`);
      process.exit(1);
    }
    throw error;
  }
}

export async function serviceStatus() {
  const { execSync } = await import('child_process');

  try {
    const result = execSync(`nssm status ${SERVICE_ID}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    logger.info(`Service "${SERVICE_NAME}" status: ${result.trim()}`);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (stderr.includes('does not exist') || stderr.includes('not found')) {
      logger.info(`Service "${SERVICE_NAME}" is not installed.`);
      return 'not_installed';
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
    .description('Install OOS Proxy as a Windows service (requires NSSM + admin)')
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
}

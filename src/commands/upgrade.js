import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import { OosError } from '../utils/errors.js';

const execAsync = promisify(exec);

export async function upgradeAction(_options) {
  try {
    const { stdout, stderr } = await execAsync('git pull', {
      cwd: process.cwd(),
    });

    if (stderr && stderr.includes('not a git repository')) {
      logger.error('Not a git repository. Please run this command inside a git project.');
      throw new OosError('Not a git repository', 'E_UPGRADE_NOT_GIT');
    }

    if (stderr && stderr.includes('CONFLICT')) {
      logger.error('Merge conflict detected. Please resolve conflicts manually.');
      logger.raw(stderr);
      throw new OosError('Merge conflict detected', 'E_UPGRADE_CONFLICT');
    }

    if (stderr && (stderr.includes('could not read from remote') || stderr.includes('fatal:'))) {
      logger.error('Failed to pull from remote repository.');
      logger.raw(stderr);
      throw new OosError('Failed to pull from remote', 'E_UPGRADE_NETWORK');
    }

    if (stdout && stdout.trim()) {
      logger.raw(stdout.trim());
    }

    logger.success('Project updated successfully.');
  } catch (error) {
    const stderr = error.stderr || '';

    if (error.code === 'ENOENT' || error.message.includes('git: not found')) {
      logger.error('Git is not installed or not found in PATH.');
      throw new OosError('Git not found', 'E_UPGRADE_GIT_NOT_FOUND');
    }

    if (stderr.includes('not a git repository') || error.message.includes('not a git repository')) {
      logger.error('Not a git repository. Please run this command inside a git project.');
      throw new OosError('Not a git repository', 'E_UPGRADE_NOT_GIT');
    }

    if (stderr.includes('CONFLICT')) {
      logger.error('Merge conflict detected. Please resolve conflicts manually.');
      logger.raw(stderr);
      throw new OosError('Merge conflict detected', 'E_UPGRADE_CONFLICT');
    }

    if (error instanceof OosError) {
      throw error;
    }

    logger.error('Failed to upgrade project.');
    if (error.message) {
      logger.raw(error.message);
    }
    throw new OosError(error.message || 'Unknown error', 'E_UPGRADE_UNKNOWN');
  }
}

export function registerUpgradeCommand(program) {
  program
    .command('upgrade')
    .description('Update project by running git pull')
    .action(upgradeAction);
}

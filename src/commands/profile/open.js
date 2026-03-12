import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { ProfileManager } from '../../core/ProfileManager.js';
import { ProfileError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getProfileDirPath } from '../../utils/paths.js';

const execAsync = promisify(exec);

async function openDirectory(dirPath) {
  const platform = os.platform();
  let command;

  switch (platform) {
    case 'win32':
      command = `start "" "${dirPath}"`;
      break;
    case 'darwin':
      command = `open "${dirPath}"`;
      break;
    case 'linux':
      command = `xdg-open "${dirPath}"`;
      break;
    default:
      throw new ProfileError(`Unsupported platform: ${platform}`);
  }

  try {
    await execAsync(command);
  } catch (error) {
    throw new ProfileError(`Failed to open directory: ${error.message}`);
  }
}

export async function openAction(name) {
  const manager = new ProfileManager();
  const profile = await manager.getProfile(name);
  const profileDir = getProfileDirPath(profile.name);

  logger.info(`Opening profile directory: ${profileDir}`);
  await openDirectory(profileDir);
  logger.success(`Opened profile "${profile.name}" in file explorer`);
}

export function registerOpenCommand(program) {
  program
    .command('open <name>')
    .description('Open profile directory in file explorer')
    .action(openAction);
}

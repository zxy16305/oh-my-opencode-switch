import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  generatePowerShellCompletion,
} from './completion.js';

async function detectShell() {
  const shell = process.env.SHELL || process.env.ComSpec || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('powershell') || shell.includes('pwsh') || process.platform === 'win32')
    return 'powershell';
  return 'bash';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appendToFile(filePath, content) {
  const exists = await fileExists(filePath);
  const existingContent = exists ? await fs.readFile(filePath, 'utf8') : '';

  if (existingContent.includes('oos completion')) {
    logger.info(`Completion already configured in ${filePath}`);
    return false;
  }

  await fs.appendFile(filePath, content);
  return true;
}

async function setupBash() {
  const home = os.homedir();
  const bashrc = path.join(home, '.bashrc');
  const bashProfile = path.join(home, '.bash_profile');

  const targetFile = (await fileExists(bashrc)) ? bashrc : bashProfile;
  if (!targetFile) {
    logger.error('No .bashrc or .bash_profile found');
    return false;
  }

  const completionDir = path.join(home, '.local', 'share', 'bash-completion', 'completions');
  const completionFile = path.join(completionDir, 'oos');

  try {
    await fs.mkdir(completionDir, { recursive: true });
    await fs.writeFile(completionFile, generateBashCompletion());
    logger.success(`Bash completion installed to ${completionFile}`);
    logger.info('Restart your shell or run: source ~/.bashrc');
    return true;
  } catch (error) {
    logger.error(`Failed to install bash completion: ${error.message}`);
    return false;
  }
}

async function setupZsh() {
  const home = os.homedir();
  const zshrc = path.join(home, '.zshrc');

  const fpathLine =
    '\n# oos completion\nfpath=(~/.zsh/completion $fpath)\nautoload -Uz compinit && compinit\n';
  const completionDir = path.join(home, '.zsh', 'completion');
  const completionFile = path.join(completionDir, '_oos');

  try {
    await fs.mkdir(completionDir, { recursive: true });
    await fs.writeFile(completionFile, generateZshCompletion());

    const zshrcContent = await fs.readFile(zshrc, 'utf8').catch(() => '');
    if (!zshrcContent.includes('fpath=(~/.zsh/completion')) {
      await fs.appendFile(zshrc, fpathLine);
    }

    logger.success(`Zsh completion installed to ${completionFile}`);
    logger.info('Restart your shell or run: source ~/.zshrc');
    return true;
  } catch (error) {
    logger.error(`Failed to install zsh completion: ${error.message}`);
    return false;
  }
}

async function setupFish() {
  const home = os.homedir();
  const completionDir = path.join(home, '.config', 'fish', 'completions');
  const completionFile = path.join(completionDir, 'oos.fish');

  try {
    await fs.mkdir(completionDir, { recursive: true });
    await fs.writeFile(completionFile, generateFishCompletion());
    logger.success(`Fish completion installed to ${completionFile}`);
    logger.info('Restart your shell or run: source ~/.config/fish/completions/oos.fish');
    return true;
  } catch (error) {
    logger.error(`Failed to install fish completion: ${error.message}`);
    return false;
  }
}

async function setupPowerShell() {
  const home = os.homedir();
  const completionFile = path.join(home, '.oos-completion.ps1');

  try {
    await fs.writeFile(completionFile, generatePowerShellCompletion());
    logger.success(`PowerShell completion installed to ${completionFile}`);
    logger.info(`Add to your $PROFILE:`);
    logger.info(`  . ${completionFile}`);
    logger.info(`Or run: Add-Content $PROFILE '. ${completionFile}'`);
    return true;
  } catch (error) {
    logger.error(`Failed to install PowerShell completion: ${error.message}`);
    return false;
  }
}

export async function setupCompletionAction(shell) {
  const targetShell = shell || (await detectShell());

  logger.info(`Setting up completion for ${targetShell}...`);

  const setups = {
    bash: setupBash,
    zsh: setupZsh,
    fish: setupFish,
    powershell: setupPowerShell,
    pwsh: setupPowerShell,
  };

  const setup = setups[targetShell];
  if (!setup) {
    logger.error(`Unsupported shell: ${targetShell}`);
    logger.info('Supported shells: bash, zsh, fish, powershell');
    process.exit(1);
  }

  await setup();
}

export function registerSetupCompletionCommand(program) {
  program
    .command('setup-completion [shell]')
    .description('Install shell completion (auto-detects shell if not specified)')
    .action(setupCompletionAction);
}

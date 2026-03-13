#! /usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import chalk from 'chalk';

import { registerInitCommand } from '../src/commands/init.js';

import { registerProfileCommands } from '../src/commands/profile/index.js';
import { registerTemplateCommands } from '../src/commands/template/index.js';
import { registerRenderCommand } from '../src/commands/render.js';
import { registerCurrentCommand } from '../src/commands/current.js';
import { registerValidateCommand } from '../src/commands/validate.js';
import { registerModelsCommand } from '../src/commands/models.js';
import { registerCompletionCommand } from '../src/commands/completion.js';
import { registerSetupCompletionCommand } from '../src/commands/setup-completion.js';
import { logger } from '../src/utils/logger.js';
import { OosError } from '../src/utils/errors.js';
import { getProfilesDir } from '../src/utils/paths.js';
import { exists } from '../src/utils/files.js';

let legacyWarningShown = false;

async function checkLegacyProfiles() {
  if (legacyWarningShown) return;

  try {
    const profilesDir = getProfilesDir();
    if (!(await exists(profilesDir))) {
      return;
    }

    const profileDirs = await readdir(profilesDir, { withFileTypes: true });
    let hasLegacyProfiles = false;

    for (const dirent of profileDirs) {
      if (dirent.isDirectory()) {
        const configPath = path.join(profilesDir, dirent.name, 'config.json');
        if (await exists(configPath)) {
          hasLegacyProfiles = true;
          break;
        }
      }
    }

    if (hasLegacyProfiles) {
      logger.warn(
        'Legacy config.json profiles detected. Config.json mode has been removed. Please migrate your profiles to template mode manually.'
      );
      legacyWarningShown = true;
    }
  } catch (error) {
    // Ignore errors during legacy profile check - don't break the CLI
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

program
  .name('oos')
  .description('oh-my-opencode switch - Configuration profile manager')
  .version(packageJson.version, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help for command')
  .configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  });

registerProfileCommands(program);
registerTemplateCommands(program);
registerRenderCommand(program);
registerCurrentCommand(program);
registerValidateCommand(program);
registerModelsCommand(program);
registerInitCommand(program);
registerCompletionCommand(program);
registerSetupCompletionCommand(program);

program.exitOverride();

async function main() {
  try {
    await checkLegacyProfiles();
    await program.parseAsync();
  } catch (error) {
    if (
      error.code === 'commander.help' ||
      error.code === 'commander.version' ||
      error.code === 'commander.helpDisplayed'
    ) {
      process.exit(0);
    }

    if (error instanceof OosError) {
      logger.error(error.message);
      process.exit(error.exitCode || 1);
    }

    logger.error(`Unexpected error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();

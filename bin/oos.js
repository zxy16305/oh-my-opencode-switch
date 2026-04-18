#! /usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import chalk from 'chalk';

import { registerInitCommand } from '../src/commands/init.js';

import { registerProfileCommands } from '../src/commands/profile/index.js';
import { registerRenderCommand } from '../src/commands/render.js';
import { registerCurrentCommand } from '../src/commands/current.js';
import { registerValidateCommand } from '../src/commands/validate.js';
import { registerModelsCommand } from '../src/commands/models.js';
import { registerCompletionCommand } from '../src/commands/completion.js';
import { registerSetupCompletionCommand } from '../src/commands/setup-completion.js';
import { registerUpgradeCommand } from '../src/commands/upgrade.js';
import { registerProxyCommands } from '../src/commands/proxy.js';
import { registerProxyRegisterCommands } from '../src/commands/proxy-register.js';
import { registerProxyReloadCommand } from '../src/commands/proxy-reload.js';
import { registerAnalyticsCommands } from '../src/commands/analytics/index.js';
import { registerPluginCommands } from '../src/commands/plugin.js';
import { logger } from '../src/utils/logger.js';
import { OosError } from '../src/utils/errors.js';

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
registerRenderCommand(program);
registerCurrentCommand(program);
registerValidateCommand(program);
registerModelsCommand(program);
registerInitCommand(program);
registerCompletionCommand(program);
registerSetupCompletionCommand(program);
registerUpgradeCommand(program);
registerProxyCommands(program);
registerProxyRegisterCommands(program);
registerProxyReloadCommand(program);
registerAnalyticsCommands(program);
registerPluginCommands(program);

program.exitOverride();

async function main() {
  try {
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

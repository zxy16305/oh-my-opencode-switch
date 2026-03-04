import { registerGetCommand } from './get.js';
import { registerSetCommand } from './set.js';
import { registerListCommand } from './list.js';

export function registerVarCommands(program) {
  const varCmd = program.command('var').description('Manage profile variables');

  registerGetCommand(varCmd);
  registerSetCommand(varCmd);
  registerListCommand(varCmd);
}

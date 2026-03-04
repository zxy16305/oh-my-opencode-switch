import { registerShowCommand } from './show.js';
import { registerCreateCommand } from './create.js';
import { registerListCommand } from './list.js';

export function registerTemplateCommands(program) {
  const template = program.command('template').description('Manage profile templates');

  registerListCommand(template);
  registerShowCommand(template);
  registerCreateCommand(template);
}

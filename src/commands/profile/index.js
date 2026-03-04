import { registerListCommand } from './list.js';
import { registerCreateCommand } from './create.js';
import { registerSwitchCommand } from './switch.js';
import { registerCopyCommand } from './copy.js';
import { registerDeleteCommand } from './delete.js';
import { registerRenameCommand } from './rename.js';
import { registerShowCommand } from './show.js';

export function registerProfileCommands(program) {
  const profile = program
    .command('profile')
    .description('Manage configuration profiles');

  registerListCommand(profile);
  registerCreateCommand(profile);
  registerSwitchCommand(profile);
  registerCopyCommand(profile);
  registerDeleteCommand(profile);
  registerRenameCommand(profile);
  registerShowCommand(profile);
}

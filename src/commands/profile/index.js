import { registerListCommand } from './list.js';
import { registerExportCommand } from './export.js';
import { registerImportCommand } from './import.js';
import { registerCreateCommand } from './create.js';
import { registerSwitchCommand } from './switch.js';
import { registerCopyCommand } from './copy.js';
import { registerDeleteCommand } from './delete.js';
import { registerRenameCommand } from './rename.js';
import { registerShowCommand } from './show.js';
import { registerOpenCommand } from './open.js';
import { registerEditCommand } from './edit.js';
import { registerVariablesCommand } from './variables.js';

export function registerProfileCommands(program) {
  const profile = program.command('profile').description('Manage configuration profiles');

  registerListCommand(profile);
  registerCreateCommand(profile);
  registerSwitchCommand(profile);
  registerCopyCommand(profile);
  registerDeleteCommand(profile);
  registerRenameCommand(profile);
  registerShowCommand(profile);
  registerOpenCommand(profile);
  registerExportCommand(profile);
  registerImportCommand(profile);
  registerEditCommand(profile);
  registerVariablesCommand(profile);
}

import { ProfileManager } from '../../core/ProfileManager.js';
import { getVariablesPath } from '../../utils/paths.js';
import { readJson } from '../../utils/files.js';
import { ProfileError } from '../../utils/errors.js';

export async function variablesAction(name) {
  const manager = new ProfileManager();

  let profile;
  if (name) {
    profile = await manager.getProfile(name);
  } else {
    const activeProfile = await manager.getActiveProfile();
    if (!activeProfile) {
      throw new ProfileError(
        'No active profile. Specify a profile name or switch to a profile first.'
      );
    }
    profile = { name: activeProfile.name, ...activeProfile };
  }

  const variablesPath = getVariablesPath(profile.name);
  let variables;

  try {
    variables = await readJson(variablesPath);
  } catch (error) {
    variables = {};
  }

  const entries = Object.entries(variables);

  if (entries.length === 0) {
    console.log(`No variables defined for profile "${profile.name}"`);
    return;
  }

  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      console.log(`${key}: ${value}`);
    } else {
      console.log(`${key}: ${JSON.stringify(value)}`);
    }
  }
}

export function registerVariablesCommand(program) {
  program
    .command('variables [name]')
    .description('List variables for a profile')
    .action(variablesAction);
}

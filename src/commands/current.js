import { ProfileManager } from '../core/ProfileManager.js';

export async function currentAction(_options) {
  const manager = new ProfileManager();
  const profile = await manager.getActiveProfile();

  if (profile) {
    console.log(profile.name);
  } else {
    console.log('(none)');
  }
}

export function registerCurrentCommand(program) {
  program.command('current').description('Show current profile').action(currentAction);
}

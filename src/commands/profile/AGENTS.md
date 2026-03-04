# PROFILE COMMANDS

## Command Registry

All profile commands follow the `register(program)` export pattern and are auto-registered via `index.js`.

| Command | File      | Purpose               | Aliases |
| ------- | --------- | --------------------- | ------- |
| list    | list.js   | List all profiles     | ls      |
| create  | create.js | Create new profile    | -       |
| switch  | switch.js | Switch active profile | use     |
| copy    | copy.js   | Copy existing profile | cp      |
| delete  | delete.js | Delete profile        | rm      |
| rename  | rename.js | Rename profile        | mv      |
| show    | show.js   | Show profile details  | -       |

## Implementation Pattern

```javascript
import { ProfileManager } from '../../core/ProfileManager.js';
import { ProfileError } from '../../utils/errors.js';

export function register(program) {
  program.command('profile <name>').action(async (name) => {
    try {
      const manager = new ProfileManager();
      await manager.someMethod(name);
      console.log('Success message');
    } catch (error) {
      if (error instanceof ProfileError) {
        program.error(error.message);
      }
      throw error;
    }
  });
}
```

## Error Handling

- Catch `ProfileError` instances → use `program.error(message)` for CLI exit
- Re-throw non-profile errors (let them bubble up)
- Action handlers are async → use try/catch wrapper

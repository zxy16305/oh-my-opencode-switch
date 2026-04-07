# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-05
**Branch:** master (no commits yet)

## OVERVIEW

oh-my-opencode switch (oos) - CLI tool for managing and switching OpenCode configuration profiles.

## STRUCTURE

```
.
├── bin/oos.js              # CLI entry point (Commander.js)
├── src/
│   ├── core/               # Business logic (ConfigManager, ProfileManager)
│   ├── commands/           # CLI command handlers
│   │   ├── profile/        # Profile sub-commands
│   │   ├── current.js      # Show current config
│   │   ├── init.js         # Initialize OpenCode
│   │   └── validate.js     # Validate config
│   └── utils/              # Shared utilities
├── tests/
│   ├── unit/               # Unit tests
│   └── integration/        # CLI integration tests
└── .sisyphus/             # Project management & documentation
```

## WHERE TO LOOK

| Task            | Location                   | Notes                                |
| --------------- | -------------------------- | ------------------------------------ |
| CLI entry       | bin/oos.js                 | Commander.js setup, error handling   |
| Profile CRUD    | src/commands/profile/\*    | create, delete, rename, copy, switch |
| Config logic    | src/core/ConfigManager.js  | read, write, backup OpenCode config  |
| Profile logic   | src/core/ProfileManager.js | Profile metadata & management        |
| File operations | src/utils/files.js         | JSON I/O, atomic writes              |
| Path resolution | src/utils/paths.js         | ~ ~/.config/opencode/.oos/ structure |

## CODE MAP

| Symbol               | Type       | Location                   | Role                             |
| -------------------- | ---------- | -------------------------- | -------------------------------- |
| ConfigManager        | Class      | src/core/ConfigManager.js  | OpenCode config I/O & validation |
| ProfileManager       | Class      | src/core/ProfileManager.js | Profile metadata & switching     |
| readJson/writeJson   | Functions  | src/utils/files.js         | Atomic file operations           |
| opencodeConfigSchema | Zod schema | src/utils/validators.js    | OpenCode JSON schema validation  |

## CONVENTIONS

### Module System

- ESM only (`"type": "module"` in package.json)
- Use `import/export` - no CommonJS

### Code Style

- Single quotes, semicolons required
- 2-space indentation, 100 char line limit
- ESLint: unused vars allowed with `_` prefix

### Error Handling

- Custom error classes: `ConfigError`, `ProfileError`, `FileSystemError` (src/utils/errors.js)
- CLI errors: use `program.error()` with exit codes
- Async errors: re-throw custom errors, not generic Error

### File I/O

- Atomic writes via `atomically` package
- JSON files: use `readJson`/`writeJson` from utils/files.js
- Config paths: centralized in utils/paths.js

### Testing

- Node.js native test runner (`node:test`)
- Tests in `tests/unit` and `tests/integration`
- Pattern: `*.test.js`, not `*.spec.js`

### Test Isolation (MANDATORY)

**Rule: Tests MUST NEVER touch real user config at `~/.config/opencode/`.**

#### Required Pattern

- Import `setupTestHome` / `cleanupTestHome` / `getTestEnv` from `tests/helpers/test-home.js`
- Unit tests: call `setupTestHome()` in `beforeEach`, `cleanupTestHome()` in `afterEach`
- Integration tests: pass `getTestEnv(testHome)` to `execFileAsync` env option

#### When writing new tests that touch the filesystem:

1. ALWAYS use `setupTestHome()` — no exceptions
2. NEVER import `paths.js` functions without first calling `setupTestHome()`
3. NEVER use `os.homedir()` directly in test expectations — use the test home path

#### Files that must use test-home helper:

- Any test importing from `src/utils/paths.js`
- Any test importing from `src/core/ConfigManager.js`
- Any test importing from `src/core/VariableManager.js`
- Any test importing from `src/core/ProfileManager.js` (if calling `init()`)
- Any integration test spawning `bin/oos.js` subprocess

#### How OOS_TEST_HOME works:

- `paths.js` `getBaseConfigDir()` checks `process.env.OOS_TEST_HOME` first
- When set, all paths resolve under the test directory instead of `os.homedir()`
- Production code is unaffected — env var only exists during tests

## ANTI-PATTERNS (THIS PROJECT)

### Framework Mismatch

- jest.config.js exists but is **NOT used** - scripts use Node's native test runner
- Either remove Jest config or migrate to Jest

### Files to Clean

- `nul` in root - invalid Windows device name artifact, delete it
- `readme.md` - rename `readme.md` → `README.md` (standard naming)

## COMMANDS

```bash
# Development
npm install              # Install dependencies
npm link                # Link CLI globally

# Testing (Node.js native test runner)
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only

# Code quality
npm run lint             # Run ESLint
npm run lint:fix        # Auto-fix linting
npm run format           # Format with Prettier
npm run format:check    # Check formatting

# CLI usage (after npm link)
oos --help              # Show help
oos profile list        # List profiles
oos profile create NAME  # Create profile
oos profile switch NAME  # Switch profile
```

## NOTES

### Profile Storage Structure

```
~/.config/opencode/
├── oh-my-opencode.json          # Active config (managed by OpenCode)
└── .oos/
    ├── profiles.json             # Metadata (activeProfile, profiles map)
    └── profiles/
        └── profile-name/
            ├── template.json     # Template file with variable placeholders
            └── variables.json    # Variable definitions
```

### Key Dependencies

- **commander.js**: CLI parsing
- **zod**: Schema validation (both OpenCode & metadata)
- **ajv**: Additional JSON validation
- **atomically**: Safe file writes

### Switching Profiles

When `oos profile switch NAME` is called:

1. Backs up current OpenCode config
2. Reads template and variables from `.oos/profiles/NAME/`
3. Renders the template with variables to generate the active config
4. Writes rendered config to `oh-my-opencode.json` (active config)
5. Updates metadata with `activeProfile` and `lastUsedAt`

### First Profile

First created profile becomes `isDefault: true` and auto-activates if no active profile exists.

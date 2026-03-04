# CORE BUSINESS LOGIC

## STRUCTURE

```
src/core/
├── ConfigManager.js      # OpenCode config I/O & validation
└── ProfileManager.js     # Profile metadata & switching
```

## CLASS RESPONSIBILITIES

| Class          | Primary Role                   | Key Methods                           |
| -------------- | ------------------------------ | ------------------------------------- |
| ConfigManager  | OpenCode config I/O operations | readConfig, writeConfig, backupConfig |
| ProfileManager | Profile metadata & management  | create, delete, rename, switch, list  |

## PATTERNS & CONTRACTS

### Initialization Pattern

Both classes require async `init()` before use:

- Ensures ~/.config/opencode/.oos/ directories exist
- Validates file structure on startup

### Error Handling

Throw domain-specific errors:

- `ConfigError` for config read/write failures
- `ProfileError` for profile not found, duplicate names, invalid operations

### Validation

- All config validated via Zod schemas (src/utils/validators.js)
- `opencodeConfigSchema` for OpenCode configs
- Profiles validated against metadata schema

### File Operations

- Uses readJson/writeJson from src/utils/files.js (atomic writes)
- Backup writes timestamped to .oos/backups/
- Dir structure management through src/utils/paths.js

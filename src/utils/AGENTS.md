# SHARED UTILITIES

## Module Purposes

| Module           | Purpose                                |
| ---------------- | -------------------------------------- |
| files.js         | JSON I/O with atomic writes            |
| paths.js         | OOS directory & file path resolution   |
| validators.js    | Profile name & schema validation       |
| errors.js        | Custom error class definitions         |
| schemaFetcher.js | Fetch OpenCode JSON schema from GitHub |
| logger.js        | Centralized logging utility            |

## Key Patterns

### Atomic File Operations

All JSON writes use the atomically package for safe file updates. Read operations return parsed objects, write operations accept objects.

If file operations fail, they throw FileSystemError with context.

### Path Resolution

All paths are absolute. The paths module resolves OOS config directory (~/.config/opencode/.oos/) and derived paths for profile configs and metadata.

No path joining happens outside this module. Other utils import from paths.js instead of hardcoding paths.

### Validation

Profile names: alphanumeric, hyphens, underscores, 3-50 chars.

Schema validation: Zod for profiles metadata, AJV for OpenCode config.

### Error Handling

Three custom error classes:

- ConfigError: OpenCode config issues
- ProfileError: Profile-specific issues
- FileSystemError: I/O failures

All inherit from Error and include context in message.

### Schema Fetching

schemaFetcher.js pulls the latest OpenCode JSON schema from GitHub during validation.

Cached after first fetch to avoid redundant network calls.

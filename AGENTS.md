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
│   ├── analytics/          # Data analysis module
│   │   ├── analyzer/       # Configuration analyzers
│   │   ├── reader/         # Configuration data readers
│   │   └── exporter/       # Data export utilities
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
| Analytics       | src/analytics/\*           | data analysis, readers, exporters    |

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

## Weight System

The weight system controls request distribution across upstreams with a four-stage calculation flow.

### Weight Calculation Flow

```
Final Weight = Base Weight × Time Slot Weight × Route Weight × Dynamic Weight
```

| Stage               | Source                     | Operation      | Description                               |
| ------------------- | -------------------------- | -------------- | ----------------------------------------- |
| 1. Base Weight      | `upstream.weight`          | Initial value  | Default: 100 if not specified             |
| 2. Time Slot Weight | `upstream.timeSlotWeights` | REPLACEMENT    | Override based on current time slot       |
| 3. Route Weight     | `route.timeSlotWeight`     | MULTIPLICATION | Historical error-rate adjustment          |
| 4. Dynamic Weight   | `route.dynamicWeight`      | MULTIPLICATION | Real-time adjustment based on performance |

### Key Files

| File                  | Location          | Role                          |
| --------------------- | ----------------- | ----------------------------- |
| weight-calculator.js  | `src/core/proxy/` | Core weight calculation logic |
| weight-manager.js     | `src/core/proxy/` | Weight state management       |
| time-slot-detector.js | `src/core/proxy/` | Detect current time slot      |

### Weight Application Order

1. **Base Weight**: Read from `upstream.weight`, defaults to 100
2. **Time Slot Replacement**: Check `upstream.timeSlotWeights[currentSlot]`, replace base if defined
3. **Route Multiplication**: Apply `route.timeSlotWeight` (historical error-rate factor)
4. **Dynamic Multiplication**: Apply `route.dynamicWeight` (real-time adjustment)

## 测试与临时脚本访问规则

### 核心原则

**所有测试、临时脚本必须使用测试隔离机制，禁止直接修改真实用户配置。**

### 禁止的行为

1. **禁止修改真实配置文件**
   - 禁止测试、临时脚本修改 `~/.config/opencode/.oos/` 下的真实文件
   - 包括但不限于：`proxy-config.json`, `profiles.json`, `proxy-time-slots.json` 等

2. **禁止直接访问用户目录**
   - 禁止测试直接使用 `os.homedir()` 访问用户目录
   - 禁止在测试中使用硬编码的真实路径（如 `~/.config/opencode/...`）

3. **禁止绕过测试隔离机制**
   - 禁止在未调用 `setupTestHome()` 的情况下使用 `paths.js` 函数
   - 禁止测试直接操作真实文件系统

### 必须遵守的规则

1. **测试隔离要求**
   - 所有涉及文件 I/O 的测试必须使用 `setupTestHome()` 隔离
   - 单元测试：在 `beforeEach` 中调用 `setupTestHome()`，在 `afterEach` 中调用 `cleanupTestHome()`
   - 集成测试：启动子进程时必须传递 `getTestEnv(testHome)` 环境变量

2. **路径访问规范**
   - 测试中必须使用 `paths.js` 提供的路径函数，不能直接拼接路径
   - 使用 `getProxyConfigPath()`, `getOpencodeConfigPath()` 等函数获取测试路径

3. **测试验证**
   - 新增测试必须验证不会修改真实用户目录
   - 使用 `paths.js` 的测试必须检查 `OOS_TEST_HOME` 环境变量

### 违反规则的后果

1. **数据风险**
   - 可能导致用户配置丢失（proxy-config.json, profiles.json 等）
   - 可能污染真实用户环境，影响生产使用

2. **CI/CD 拦截**
   - CI/CD 会检测到并阻止合并
   - 代码审查会被拒绝

### 例外情况

1. **纯单元测试**
   - 纯单元测试（不涉及文件 I/O）不需要测试隔离
   - 例如：只测试纯函数逻辑的测试

2. **Mock 文件系统**
   - Mock 文件系统的测试可以例外
   - 但必须在测试注释中明确说明原因

### 快速参考

```javascript
// ✅ 正确示例
import { setupTestHome, cleanupTestHome } from '../helpers/test-home.js';

let testHome;
beforeEach(async () => {
  const result = await setupTestHome();
  testHome = result.testHome;
});
afterEach(async () => {
  await cleanupTestHome(testHome);
});

// ❌ 错误示例 - 禁止这样做！
import os from 'os';
const realPath = path.join(os.homedir(), '.config/opencode/.oos/proxy-config.json');
// 这会修改真实用户配置！
```

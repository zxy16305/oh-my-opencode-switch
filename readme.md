# oos (oh-my-opencode switch)

> ⚠️ 个人自用项目，随缘更新维护

OpenCode 配置文件管理工具，用于快速切换和管理 oh-my-opencode 配置。

## 安装

```bash
git clone <repo-url>
cd oh-my-opencode-switch
npm install
npm link
```

**要求**: Node.js >= 16.0.0

## 快速开始

```bash
# 初始化（首次使用）
oos init

# 交互式编辑当前配置变量（TUI界面）
oos profile edit
# 流程：上下箭头选择变量 → Enter进入编辑 → Ctrl+S保存 → Esc退出，修改即时生效

# 显示帮助
oos --help

# 显示版本
oos --version
```

## 命令

### 配置管理 (profile)

```bash
# 列出所有配置
oos profile list
oos profile ls

# 创建新配置（从当前配置）
oos profile create my-profile
oos profile create my-profile -d "My work profile"

# 切换到配置
oos profile switch my-profile
oos profile use my-profile

# 复制配置
oos profile copy my-profile new-profile
oos profile cp my-profile new-profile

# 删除配置
oos profile delete my-profile
oos profile rm my-profile
oos profile delete my-profile -f  # 强制删除

# 重命名配置
oos profile rename old-name new-name
oos profile mv old-name new-name

# 显示配置详情
oos profile show my-profile

# 打开配置目录（在文件资源管理器中）
oos profile open my-profile

# 导入配置
oos profile import ./my-profile.json

# 导出配置
oos profile export my-profile
oos profile export my-profile -o ./exported.json
```

### 编辑配置变量

```bash
# 交互式编辑配置变量
oos profile edit my-profile

# 编辑当前活跃配置
oos profile edit
```

编辑界面支持两种类型的变量：

- **模型变量**: 值为模型名称（如 `doubao-seed-2-0-pro`），使用模型选择器编辑
- **非模型变量**: 普通文本或结构化数据

对于非模型变量，根据值类型自动选择编辑方式：

- **简单值**（字符串、数字、布尔值）：使用单行文本输入，按 `Enter` 确认
- **复杂值**（对象、数组）：使用多行 JSON 编辑器，支持语法高亮和验证

JSON 编辑器快捷键：

- `Ctrl+S` / `Cmd+S` - 保存修改
- `Escape` - 取消编辑



### 其他命令

```bash
# 显示当前配置
oos current

# 验证当前配置
oos validate

# 列出可用模型
oos models
```

### Shell 补全

```bash
# 生成补全脚本
oos completion bash      # Bash
oos completion zsh       # Zsh
oos completion fish      # Fish
oos completion powershell # PowerShell

# 自动安装补全（检测当前 shell）
oos setup-completion

# 指定 shell 安装补全
oos setup-completion bash
oos setup-completion zsh
oos setup-completion fish
oos setup-completion powershell
```

#### 补全安装示例

**Bash:**

```bash
eval "$(oos completion bash)"
# 或自动安装
oos setup-completion bash
```

**Zsh:**

```bash
eval "$(oos completion zsh)"
# 或自动安装
oos setup-completion zsh
```

**Fish:**

```bash
oos completion fish > ~/.config/fish/completions/oos.fish
# 或自动安装
oos setup-completion fish
```

**PowerShell:**

```powershell
oos completion powershell > ~/.oos-completion.ps1
# 添加到 $PROFILE
. ~/.oos-completion.ps1
# 或自动安装
oos setup-completion powershell
```



## 目录结构

配置存储在 `~/.config/opencode/.oos/`：

```
~/.config/opencode/
├── oh-my-opencode.json          # 当前活跃配置
└── .oos/
    ├── profiles.json             # 元数据
    └── profiles/
        └── my-profile/
            └── config.json       # 配置文件
```

## 开发

```bash
# 安装依赖
npm install

# 链接到全局
npm link

# 运行测试
npm test

# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# 代码检查
npm run lint
npm run lint:fix

# 格式化
npm run format
npm run format:check
```

## License

MIT

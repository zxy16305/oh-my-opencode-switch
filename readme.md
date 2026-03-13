# oos (oh-my-opencode switch)

配置文件管理工具，用于快速切换 oh-my-opencode 配置。

## 安装

```bash
git clone <repo-url>
cd oh-my-opencode-switch
npm install
npm link
```

## 使用

### 基本命令

```bash
# 显示帮助
oos --help

# 显示版本
oos --version
```

### 配置管理

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
```

### 编辑配置变量

```bash
# 交互式编辑配置变量
oos profile edit my-profile

# 编辑当前活跃配置
oos profile edit
```

编辑界面支持两种类型的变量：

- **模型变量**: 值为模型名称（如 `claude-3-sonnet`），使用模型选择器编辑
- **非模型变量**: 普通文本或结构化数据

对于非模型变量，根据值类型自动选择编辑方式：

- **简单值**（字符串、数字、布尔值）：使用单行文本输入，按 `Enter` 确认
- **复杂值**（对象、数组）：使用多行 JSON 编辑器，支持语法高亮和验证

JSON 编辑器快捷键：

- `Ctrl+S` / `Cmd+S` - 保存修改
- `Escape` - 取消编辑

示例：编辑包含嵌套对象的变量

```bash
oos profile edit my-profile
# 选择变量 "API_CONFIG"
# 在 JSON 编辑器中输入：
# {
#   "endpoint": "https://api.example.com",
#   "timeout": 30,
#   "retries": 3
# }
# 按 Ctrl+S 保存
```

### 模板管理

模板功能允许您创建带有变量占位符的配置文件，通过变量替换实现快速环境切换。

```bash
# 列出所有带模板的配置
oos template list
oos template ls

# 为现有配置创建模板
oos template create my-profile --from-current

# 显示配置的模板内容
oos template show my-profile
```

### 渲染模板

```bash
# 渲染模板并输出到控制台
oos render my-template

# 渲染模板并保存到文件
oos render my-template --output rendered-config.json
```

### 其他命令

```bash
# 显示当前配置
oos current

# 验证当前配置
oos validate
```

## 模板语法

模板使用 `{{VARIABLE_NAME}}` 占位符语法：

```json
{
  "api": {
    "key": "{{API_KEY}}",
    "endpoint": "{{API_ENDPOINT}}"
  },
  "database": {
    "host": "{{DB_HOST}}",
    "port": {{DB_PORT}}
  }
}
```

## 目录结构

配置存储在 `~/.config/opencode/.oos/`：

```
~/.config/opencode/
├── oh-my-opencode.json          # 当前活跃配置
└── .oos/
    ├── profiles.json             # 元数据
    └── profiles/
        └── my-template/
            ├── template.json     # 模板文件
            └── variables.json    # 变量定义
```

## License

MIT

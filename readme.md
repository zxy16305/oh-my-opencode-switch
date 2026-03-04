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

# 创建模板配置（支持变量替换）
oos profile create my-template --template

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

### 变量管理

变量用于模板中的占位符替换，变量名必须为 `UPPER_SNAKE_CASE` 格式。

```bash
# 设置变量
oos var set my-template API_KEY secret123
oos var set my-template CONFIG '{"host":"localhost","port":3000}' --json

# 获取变量值
oos var get my-template API_KEY

# 列出所有变量
oos var list my-template
oos var ls my-template
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

### 变量值类型

- **字符串**: `oos var set profile NAME value`
- **数字**: `oos var set profile PORT 3000`
- **布尔值**: `oos var set profile DEBUG true`
- **对象/数组**: `oos var set profile CONFIG '{"key":"value"}' --json`

## 目录结构

配置存储在 `~/.config/opencode/.oos/`：

```
~/.config/opencode/
├── oh-my-opencode.json          # 当前活跃配置
└── .oos/
    ├── profiles.json             # 元数据
    └── profiles/
        ├── work/
        │   └── config.json       # Legacy 配置
        └── my-template/
            ├── template.json     # 模板文件
            └── variables.json    # 变量定义
```

## License

MIT

# Proxy Server 使用指南

## 概述

OOS Proxy 是一个轻量级负载均衡代理服务器，用于在多个 AI 模型提供商之间进行请求分发。它支持多种路由策略、会话粘滞和熔断保护机制。

**主要功能**：

- **虚拟模型名称**：将请求路由到实际的后端模型
- **负载均衡**：支持轮询、随机、权重和粘滞会话策略
- **故障转移**：自动检测失败的上游服务并切换到备用服务
- **熔断保护**：防止级联故障，保护后端服务
- **Windows 服务**：可作为系统服务后台运行

## 快速开始

### 1. 初始化配置

```bash
# 创建默认配置文件
oos proxy init

# 强制覆盖已有配置
oos proxy init --force
```

配置文件位置：`~/.config/opencode/.oos/proxy-config.json`

### 2. 编辑配置

编辑配置文件，添加路由和上游服务器。

**简化配置**（推荐）- 自动从 opencode 配置读取 baseURL 和 apiKey：

```json
{
  "port": 3000,
  "routes": {
    "lb-mixed": {
      "strategy": "sticky",
      "upstreams": [
        { "provider": "ali", "model": "glm-4.7" },
        { "provider": "baidu", "model": "qianfan-code-latest" }
      ]
    }
  }
}
```

只需指定 `provider` 和 `model`，代理会自动从 `~/.config/opencode/opencode.json` 和 `~/.local/share/opencode/auth.json` 读取对应的 `baseURL` 和 `apiKey`。

**完整配置**（需要自定义时使用）：

```json
{
  "port": 3000,
  "routes": {
    "lb-custom": {
      "strategy": "sticky",
      "upstreams": [
        {
          "id": "custom-upstream",
          "provider": "custom",
          "model": "custom-model",
          "baseURL": "https://api.custom.com/v1",
          "apiKey": "your-api-key"
        }
      ]
    }
  }
}
```

### 3. 启动代理

```bash
# 使用默认端口 (3000)
oos proxy start

# 指定端口
oos proxy start -p 3001

# 指定配置文件
oos proxy start -c ./custom-config.json
```

### 4. 在 OpenCode 中使用

在 `oh-my-opencode.json` 中配置模型名称为路由名称：

```json
{
  "model": "lb-qwen-plus"
}
```

## 配置说明

### 配置文件结构

```json
{
  "port": 3000,
  "routes": {
    "<virtual-model-name>": {
      "strategy": "<routing-strategy>",
      "upstreams": [
        {
          "id": "<unique-id>",
          "provider": "<provider-name>",
          "model": "<actual-model-name>",
          "baseURL": "<api-endpoint>",
          "apiKey": "<api-key>",
          "weight": 1,
          "metadata": {}
        }
      ],
      "metadata": {}
    }
  }
}
```

### 配置字段说明

| 字段                      | 类型   | 必填 | 说明                                                    |
| ------------------------- | ------ | ---- | ------------------------------------------------------- |
| `port`                    | number | 否   | 代理服务器监听端口，默认 3000                           |
| `routes`                  | object | 否   | 路由配置对象，键为虚拟模型名称                          |
| `routes.<name>.strategy`  | string | 否   | 路由策略：`sticky`、`round-robin`、`weighted`、`random` |
| `routes.<name>.upstreams` | array  | 是   | 上游服务器列表                                          |
| `upstreams[].id`          | string | 是   | 上游唯一标识                                            |
| `upstreams[].provider`    | string | 是   | 提供商名称（alibaba、zhipu、deepseek 等）               |
| `upstreams[].model`       | string | 是   | 实际使用的模型名称                                      |
| `upstreams[].baseURL`     | string | 是   | API 端点 URL                                            |
| `upstreams[].apiKey`      | string | 否   | API 密钥，可为 null                                     |
| `upstreams[].weight`      | number | 否   | 权重值，仅 weighted 策略使用                            |
| `upstreams[].metadata`    | object | 否   | 自定义元数据                                            |

### 常用提供商配置示例

**阿里云（通义千问）**：

```json
{
  "id": "alibaba-qwen-plus",
  "provider": "alibaba",
  "model": "qwen-plus",
  "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "your-dashscope-api-key"
}
```

**智谱 AI**：

```json
{
  "id": "zhipu-glm-4",
  "provider": "zhipu",
  "model": "glm-4",
  "baseURL": "https://open.bigmodel.cn/api/paas/v4",
  "apiKey": "your-zhipu-api-key"
}
```

**DeepSeek**：

```json
{
  "id": "deepseek-chat",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "baseURL": "https://api.deepseek.com",
  "apiKey": "your-deepseek-api-key"
}
```

## 路由策略

### sticky（粘滞会话）

同一会话的所有请求路由到同一上游服务器。

**工作原理**：

- 从请求头提取会话 ID（优先级：`x-opencode-session` > `x-session-affinity` > 自动生成）
- 使用一致性哈希算法将Session 映射到后端
- Session 映射 TTL 为 30 分钟，超时自动清理

**适用场景**：需要保持会话上下文的场景

```json
{
  "strategy": "sticky",
  "upstreams": [
    { "id": "upstream-1", ... },
    { "id": "upstream-2", ... }
  ]
}
```

### round-robin（轮询）

按顺序轮流将请求分发到各个上游服务器。

**工作原理**：

- 维护每个路由的计数器
- 每次请求后计数器递增
- 使用 `counter % upstreams.length` 选择上游

**适用场景**：上游性能相近，需要均匀分配负载

```json
{
  "strategy": "round-robin",
  "upstreams": [
    { "id": "upstream-1", ... },
    { "id": "upstream-2", ... }
  ]
}
```

### weighted（加权）

根据权重比例分配请求。

**工作原理**：

- 每个上游可配置 `weight` 字段（默认 1）
- 权重越高，被选中的概率越大
- 使用加权随机算法选择

**适用场景**：上游性能或成本不同，需要差异化分配

```json
{
  "strategy": "weighted",
  "upstreams": [
    { "id": "fast-upstream", "weight": 3, ... },
    { "id": "slow-upstream", "weight": 1, ... }
  ]
}
```

### random（随机）

完全随机选择上游服务器。

**适用场景**：简单负载分担，无特殊要求

```json
{
  "strategy": "random",
  "upstreams": [
    { "id": "upstream-1", ... },
    { "id": "upstream-2", ... }
  ]
}
```

## 熔断机制

熔断器保护后端服务免受级联故障影响。

### 工作原理

**状态机**：

- **CLOSED（关闭）**：正常状态，请求正常通过
- **OPEN（打开）**：熔断状态，直接拒绝请求
- **HALF_OPEN（半开）**：探测状态，允许一个请求探测

**状态转换**：

1. CLOSED 状态下，连续失败达到阈值（默认 3 次）→ OPEN
2. OPEN 状态下，经过冷却时间（默认 60 秒）→ HALF_OPEN
3. HALF_OPEN 状态下：
   - 请求成功 → CLOSED
   - 请求失败 → OPEN（重置冷却时间）

### 配置选项

在配置文件中添加 `reliability` 字段：

```json
{
  "port": 3000,
  "reliability": {
    "allowedFails": 3,
    "cooldownTimeMs": 60000
  },
  "routes": { ... }
}
```

| 参数             | 默认值 | 说明                       |
| ---------------- | ------ | -------------------------- |
| `allowedFails`   | 3      | 连续失败多少次后触发熔断   |
| `cooldownTimeMs` | 60000  | 熔断后多少毫秒进入半开状态 |

### 故障转移

对于 sticky 策略，当检测到上游失败时：

1. 记录该上游的失败
2. 自动将会话映射到下一个可用上游
3. 响应头中添加 `x-used-provider` 标识实际使用的上游

## Windows 服务

### 安装服务

**要求**：以管理员身份运行

```bash
# 使用默认端口 3000
oos proxy install

# 指定端口
oos proxy install -p 3001
```

安装完成后：

- 服务名称：`OOS Proxy`
- 服务描述：`OOS Proxy Server - Load balancing proxy for OpenCode`
- 可通过 Windows 服务管理器启动/停止

### 卸载服务

**要求**：以管理员身份运行

```bash
oos proxy uninstall
```

### 依赖

需要安装 `node-windows` 包：

```bash
npm install node-windows
```

## 故障排查

### 端口被占用

**错误**：`Port 3000 is already in use`

**解决方案**：

```bash
# 使用其他端口
oos proxy start -p 3001

# 或查找并关闭占用端口的进程
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### 配置文件不存在

**错误**：`No proxy configuration found`

**解决方案**：

```bash
# 初始化配置文件
oos proxy init
```

### 路由配置无效

**错误**：`Invalid routes configuration`

**解决方案**：

- 检查 JSON 语法是否正确
- 确保每个路由至少有一个 upstream
- 验证必填字段：`id`、`provider`、`model`、`baseURL`

### 服务安装失败

**错误**：`Administrator privileges required`

**解决方案**：

- 以管理员身份重新运行命令行
- Windows：右键点击终端 → 以管理员身份运行

**错误**：`node-windows package not found`

**解决方案**：

```bash
npm install node-windows
```

### 请求返回 404

**错误**：`Unknown model: xxx`

**解决方案**：

- 检查请求中的模型名称是否与配置中的路由名称匹配
- 使用 `oos proxy status` 查看已配置的路由

### 熔断器频繁触发

**现象**：请求被拒绝，返回 `503 Service Unavailable`

**解决方案**：

1. 检查上游服务是否正常运行
2. 验证 API Key 是否有效
3. 调整熔断器参数：
   ```json
   {
     "reliability": {
       "allowedFails": 5,
       "cooldownTimeMs": 120000
     }
   }
   ```

## 命令参考

| 命令                  | 说明                | 选项                                                           |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `oos proxy init`      | 初始化配置文件      | `-f, --force` 覆盖已有配置                                     |
| `oos proxy start`     | 启动代理服务器      | `-p, --port <port>` 端口<br>`-c, --config <path>` 配置文件路径 |
| `oos proxy stop`      | 停止代理服务器      | 无                                                             |
| `oos proxy status`    | 查看服务器状态      | 无                                                             |
| `oos proxy install`   | 安装为 Windows 服务 | `-p, --port <port>` 服务端口                                   |
| `oos proxy uninstall` | 卸载 Windows 服务   | 无                                                             |

## 响应头信息

代理服务器会在响应中添加以下头信息：

| 响应头            | 说明                   |
| ----------------- | ---------------------- |
| `x-used-provider` | 实际处理请求的上游 ID  |
| `x-session-id`    | 会话 ID（sticky 策略） |

# Proxy Server 使用指南

## 概述

OOS Proxy 是一个轻量级负载均衡代理服务器，用于在多个 AI 模型提供商之间进行请求分发。它支持会话粘滞和熔断保护机制。

**主要功能**：

- **虚拟模型名称**：将请求路由到实际的后端模型
- **负载均衡**：支持粘滞会话策略，确保同一会话请求路由到同一上游
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

### 5. 注册代理到 OpenCode

使用 `oos proxy register` 自动将代理路由注册为 OpenCode 可用的模型：

```bash
oos proxy register
```

此命令会：

1. 读取 proxy-config.json 中的路由配置
2. 在 opencode.json 中创建代理 provider（按协议区分）
   - chat 协议：`opencode-proxy`，name 为 `OOS Proxy (Chat)`，baseURL 为 `http://localhost:<port>/v1`
   - responses 协议：`opencode-proxy-responses`，name 为 `OOS Proxy (Responses)`，baseURL 同样为 `http://localhost:<port>/v1`
   - 两个 provider 均会填充占位 API Key，避免 SDK 初始化阶段因缺少 key 报错
3. 为每个路由创建虚拟模型条目
4. 自动计算模型限制（context/output）

**命令选项**：

- `-p, --port <port>`: 指定代理端口（默认使用配置中的端口）

**取消注册**：

```bash
oos proxy unregister
```

**工作流程示例**：

1. 配置 proxy-config.json
2. 启动代理：`oos proxy start`
3. 注册代理：`oos proxy register`
4. 在 OpenCode 中使用虚拟模型

**虚拟模型命名**：

- 模型名称保持路由名称不变
- 在 OpenCode 中显示为：`<routeName> (Proxy)`

**模型限制计算优先级**：

1. opencode.json 中显式配置
2. 从 models.dev API 获取
3. 使用最小值（多个上游时）

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

**顶层配置**：

| 字段             | 类型   | 必填 | 说明                           |
| ---------------- | ------ | ---- | ------------------------------ |
| `version`        | number | 否   | 配置 schema 版本，当前固定为 1 |
| `port`           | number | 否   | 代理服务器监听端口，默认 3000  |
| `routes`         | object | 否   | 路由配置对象，键为虚拟模型名称 |
| `reliability`    | object | 否   | 熔断器配置                     |
| `timeSlotWeight` | object | 否   | 时间段权重计算器配置           |
| `auth`           | object | 否   | 认证配置                       |

**路由配置**：

| 字段             | 类型   | 必填 | 说明                           |
| ---------------- | ------ | ---- | ------------------------------ |
| `strategy`       | string | 否   | 路由策略：`sticky`（默认）     |
| `upstreams`      | array  | 是   | 上游服务器列表                 |
| `dynamicWeight`  | object | 否   | 动态权重调整配置               |
| `timeSlotWeight` | object | 否   | 时间段权重配置（覆盖全局设置） |
| `metadata`       | object | 否   | 自定义元数据                   |

**上游配置**：

| 字段              | 类型   | 必填 | 说明                     |
| ----------------- | ------ | ---- | ------------------------ |
| `id`              | string | 否   | 上游唯一标识（自动生成） |
| `provider`        | string | 是   | 提供商名称               |
| `model`           | string | 是   | 实际使用的模型名称       |
| `baseURL`         | string | 否   | API 端点 URL（自动发现） |
| `apiKey`          | string | 否   | API 密钥（自动读取）     |
| `weight`          | number | 否   | 权重值（1-1000，默认 1） |
| `timeSlotWeights` | object | 否   | 时段权重配置（成本优化） |
| `metadata`        | object | 否   | 自定义元数据             |

**动态权重配置**：

| 字段               | 类型   | 默认值 | 说明                         |
| ------------------ | ------ | ------ | ---------------------------- |
| `enabled`          | bool   | false  | 是否启用动态权重调整         |
| `initialWeight`    | number | 100    | 初始权重                     |
| `minWeight`        | number | 10     | 最小权重（防止完全切断流量） |
| `checkInterval`    | number | 10     | 检查间隔（秒）               |
| `latencyThreshold` | number | 1.5    | 延迟阈值（倍数）             |
| `recoveryInterval` | number | 300000 | 恢复间隔（毫秒）             |
| `recoveryAmount`   | number | 1      | 每次恢复的权重增量           |

**时间段权重配置**：

| 字段                  | 类型   | 默认值 | 说明                     |
| --------------------- | ------ | ------ | ------------------------ |
| `enabled`             | bool   | true   | 是否启用时间段权重调整   |
| `totalErrorThreshold` | number | 0.01   | 总错误率阈值（1%）       |
| `dangerSlotThreshold` | number | 0.05   | 危险时段错误率阈值（5%） |
| `dangerMultiplier`    | number | 0.5    | 危险时段权重系数         |
| `normalMultiplier`    | number | 2.0    | 良好时段权重系数         |
| `lookbackDays`        | number | 7      | 统计数据回溯天数         |

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

### 内置提供商支持

除了手动配置提供商外，代理还支持使用通过 `opencode auth login` 命令配置的内置提供商。

**什么是内置提供商**：

- 通过 `opencode auth login` 命令登录并保存 API 密钥的提供商
- 认证信息存储在 `~/.local/share/opencode/auth.json`
- 无需在 `opencode.json` 中手动配置 `baseURL` 和 `apiKey`

**使用示例**：

```json
{
  "port": 3000,
  "routes": {
    "lb-gpt": {
      "upstreams": [
        { "provider": "openai", "model": "gpt-4" },
        { "provider": "azure", "model": "gpt-4" }
      ]
    }
  }
}
```

即使 `openai` 和 `azure` 没有在 `opencode.json` 的 provider 部分定义，只要通过 `opencode auth login` 登录过，代理就能自动读取它们的认证信息并正常工作。

**模型限制（Limit）计算优先级**：

当使用内置提供商时，模型的限制（context limit）按以下优先级确定：

1. **opencode.json 中显式配置的限制**（最高优先级）
   - 如果在 `opencode.json` 的 provider 定义中指定了 `limit` 字段，优先使用
2. **从 models.dev API 自动获取**（中等优先级）
   - 如果未在 opencode.json 中指定，代理会从 models.dev API 查询该模型的默认限制
3. **默认值 Infinity**（最低优先级）
   - 如果以上都没有，使用无限制（Infinity）

这种设计确保了灵活性和便利性的平衡：你可以手动覆盖任何模型的限制，同时享受自动获取默认值的便利。

### 认证配置

代理支持 API Key 认证，保护代理服务不被未授权访问。

**配置结构**：

```json
{
  "auth": {
    "enabled": true,
    "keys": [
      {
        "key": "sk-your-api-key-1",
        "name": "dev-key",
        "enabled": true
      },
      {
        "key": "sk-your-api-key-2",
        "name": "prod-key",
        "enabled": false
      }
    ]
  }
}
```

**配置字段说明**：

| 字段                  | 类型    | 说明                               |
| --------------------- | ------- | ---------------------------------- |
| `auth.enabled`        | boolean | 是否启用认证，false 时允许所有请求 |
| `auth.keys[].key`     | string  | API Key 值                         |
| `auth.keys[].name`    | string  | Key 的名称（用于标识）             |
| `auth.keys[].enabled` | boolean | 是否启用该 Key                     |

**支持的 Header 格式**：

1. **Authorization Header**（推荐）：

   ```
   Authorization: Bearer sk-your-api-key
   ```

2. **X-API-Key Header**：
   ```
   X-API-Key: sk-your-api-key
   ```

**认证流程**：

1. 从请求头提取 API Key
2. 如果 `auth.enabled` 为 false，允许访问
3. 如果未提供 API Key，返回 401
4. 检查 Key 是否存在于 `auth.keys` 中且 `enabled: true`
5. 匹配成功则允许访问，否则返回 401

**错误响应格式**（OpenAI 兼容）：

```json
{
  "error": {
    "message": "Missing API Key",
    "type": "invalid_request_error",
    "code": 401
  }
}
```

**使用示例**：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "lb-mixed", "messages": [...]}'
```

## 路由策略

### sticky（粘滞会话）

同一会话的所有请求路由到同一上游服务器。

**工作原理**：

- 从请求头提取会话 ID（优先级：`x-opencode-session` > `x-session-affinity` > 自动生成）
- 使用一致性哈希算法将 Session 映射到后端
- Session 映射 TTL 为 30 分钟，超时自动清理

**适用场景**：需要保持会话上下文的场景

**权重影响方式**：

sticky 策略不仅保持会话粘滞，还使用最小负载算法在多个会话间实现负载均衡：

- **评分公式**：`score = (requestCount + 1) / effectiveWeight`
  - `requestCount`：最近 1 小时内的请求数（滑动窗口）
  - `effectiveWeight`：有效权重（1-1000，默认 1）
  - `+1` 确保即使 requestCount=0 时权重也生效
- **选择逻辑**：每次选择 score 最低的上游（负载最轻）
- **权重作用**：
  - 初始分配：权重高的上游 score 更低，优先被新会话选中
  - 每 10 次请求重选：会话每处理 10 个请求后重新评估，权重高的可承担更多负载
  - 长期均衡：请求数趋向于与权重成正比（权重 2:1 → 请求数约 2:1）

**权重边界处理**：

- 权重值必须为 1-1000 的整数，默认为 1
- 权重=0 或负数：该上游被排除在负载均衡之外（用于流量排除/禁用）
- 权重>1000：会被截断为 1000

```json
{
  "upstreams": [
    { "id": "upstream-1", "weight": 3, ... },  // 承担约 3 倍负载
    { "id": "upstream-2", "weight": 1, ... },  // 承担基准负载
    { "id": "upstream-3", "weight": 0, ... }   // 被排除（不接收请求）
  ]
}
```

## 时段权重配置

### 概述

时段权重配置允许根据一天中的不同时段（小时）为上游设置不同的权重，用于成本优化和流量控制。

**核心机制**：

- **时段类型**：将一天 24 小时划分为 HIGH（高峰）、MEDIUM（中等）、LOW（低峰）三种类型
- **权重替换**：时段权重会**替换**上游的基础 `weight` 值（不是倍增）
- **自动应用**：根据当前系统时间自动选择对应时段的权重

### 时段类型定义

| 时段类型   | 小时范围（24 小时制） | 说明                                   |
| ---------- | --------------------- | -------------------------------------- |
| **high**   | 10-11, 13-17          | 上午 10-11 点，下午 1-5 点（业务高峰） |
| **medium** | 8-9, 12, 18-20        | 早上 8-9 点，中午 12 点，晚上 6-8 点   |
| **low**    | 21-23, 0-7            | 晚上 9 点到次日 7 点（低峰时段）       |

**边界规则**（左闭右开）：

```
小时 7  → low
小时 8  → medium（进入中等负荷时段）
小时 10 → high（进入高峰时段）
小时 12 → medium（午间）
小时 13 → high（下午高峰开始）
小时 18 → medium（晚间中等负荷开始）
小时 21 → low（夜间低负荷开始）
```

### 配置示例

```json
{
  "port": 3000,
  "routes": {
    "lb-cost-optimized": {
      "upstreams": [
        {
          "provider": "ali",
          "model": "qwen-plus",
          "weight": 1,
          "timeSlotWeights": {
            "high": 1,
            "medium": 2,
            "low": 3
          }
        },
        {
          "provider": "baidu",
          "model": "qianfan-code-latest",
          "weight": 2
        }
      ]
    }
  }
}
```

### 权重语义

**替换规则**：

- 如果配置了 `timeSlotWeights`，当前时段对应的权重会**完全替换** `weight` 值
- 如果某个时段类型未配置（部分配置），则保持使用基础 `weight` 值
- 如果未配置 `timeSlotWeights`，则始终使用 `weight` 值

**示例场景**：

```javascript
// 配置：
// upstream.weight = 1
// upstream.timeSlotWeights = { high: 1, medium: 2, low: 3 }

// 当前时间为 14:00（high 时段）
effectiveWeight = 1; // 使用 timeSlotWeights.high

// 当前时间为 12:00（medium 时段）
effectiveWeight = 2; // 使用 timeSlotWeights.medium

// 当前时间为 03:00（low 时段）
effectiveWeight = 3; // 使用 timeSlotWeights.low
```

**使用场景**：

1. **成本优化**：在高峰时段使用较便宜的提供商，在低峰时段使用高质量提供商
2. **流量控制**：在特定时段限制某些上游的流量比例
3. **负载均衡**：根据时段调整上游的负载分配策略

### 配置字段说明

| 字段                     | 类型   | 必填 | 说明                              |
| ------------------------ | ------ | ---- | --------------------------------- |
| `timeSlotWeights.high`   | number | 否   | 高峰时段权重（10-11, 13-17 点）   |
| `timeSlotWeights.medium` | number | 否   | 中等时段权重（8-9, 12, 18-20 点） |
| `timeSlotWeights.low`    | number | 否   | 低峰时段权重（21-23, 0-7 点）     |

**约束**：

- 权重值必须为非负数（≥ 0）
- 权重值为 0 或负数：该上游在该时段被排除（不接收请求）
- 权重值 > 1000：会被截断为 1000
- 可以只配置部分时段（未配置的时段使用基础 `weight`）

### 与其他权重机制的协同

时段权重配置会与其他权重机制协同工作，应用顺序如下：

```
effectiveWeight = timeSlotWeights[static replacement]
                × timeSlotWeight[dynamic multiplier - 错误率]
                × dynamicWeight[latency based]
                × staticWeight
```

1. **时段权重（静态替换）**：首先应用，替换基础权重
2. **时段权重（动态倍增）**：基于历史错误率的动态调整（见下一节）
3. **动态权重**：基于延迟和错误率的实时调整
4. **边界处理**：最终结果确保 ≥ 1

## 时间段权重计算器

### 概述

时间段权重计算器根据历史错误模式，在不同时间段动态调整上游权重：

- **目的**：避开历史错误率高的时间段，提升整体成功率
- **机制**：按小时统计每个 provider 的成功/失败次数
- **权重调整**：危险时段降低权重，良好时段提升权重

### 工作原理

**数据收集**：

- 记录每个请求的成功/失败状态
- 按小时聚合统计（YYYY-MM-DD-HH 格式）
- 数据持久化到 `~/.config/opencode/.oos/proxy-time-slots.json`

**权重计算**：

- 总错误率 < 1% → 权重系数 1.0（不调整）
- 总错误率 > 1%：
  - 该小时错误率 > 5% → 权重系数 0.5（危险时段）
  - 该小时错误率 ≤ 5% → 权重系数 2.0（良好时段）

**有效权重公式**：

```
effectiveWeight = staticWeight × dynamicWeight × timeSlotWeight
```

### 配置选项

在配置文件顶层或路由级别添加 `timeSlotWeight` 配置：

```json
{
  "timeSlotWeight": {
    "enabled": true,
    "totalErrorThreshold": 0.01,
    "dangerSlotThreshold": 0.05,
    "dangerMultiplier": 0.5,
    "normalMultiplier": 2.0,
    "lookbackDays": 7
  }
}
```

| 参数                  | 默认值 | 说明                               |
| --------------------- | ------ | ---------------------------------- |
| `enabled`             | `true` | 是否启用时间段权重调整             |
| `totalErrorThreshold` | `0.01` | 总错误率阈值（1%），低于此值不调整 |
| `dangerSlotThreshold` | `0.05` | 危险时段错误率阈值（5%）           |
| `dangerMultiplier`    | `0.5`  | 危险时段权重系数                   |
| `normalMultiplier`    | `2.0`  | 良好时段权重系数                   |
| `lookbackDays`        | `7`    | 统计数据回溯天数                   |

### 数据持久化

**保存位置**：`~/.config/opencode/.oos/proxy-time-slots.json`

**保存时机**：

- 每1小时自动保存
- 服务器关闭时保存
- 服务器启动时加载

**数据结构示例**：

```json
{
  "providers": {
    "ali": {
      "2026-04-08-09": { "success": 145, "failure": 1 },
      "2026-04-08-10": { "success": 112, "failure": 0 }
    }
  },
  "lastUpdated": "2026-04-08T10:30:00.000Z"
}
```

### 使用场景

**场景1：避开高峰期错误**

- 某个 provider 在下午2点经常出错
- 时间段权重会自动降低该时段的权重
- 流量自动转移到其他 provider

**场景2：优先使用稳定时段**

- 某个 provider 在凌晨表现良好
- 时间段权重会自动提升该时段的权重
- 充分利用稳定时段的容量

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
    "allowedFails": 2,
    "cooldownTimeMs": 60000
  },
  "routes": { ... }
}
```

| 参数             | 默认值 | 说明                       |
| ---------------- | ------ | -------------------------- |
| `allowedFails`   | 2      | 连续失败多少次后触发熔断   |
| `cooldownTimeMs` | 60000  | 熔断后多少毫秒进入半开状态 |

### 故障转移

对于 sticky 策略，当检测到上游失败时：

1. 记录该上游的失败
2. 自动将会话映射到下一个可用上游
3. 响应头中添加 `x-used-provider` 标识实际使用的上游

## 监控与统计

### Dashboard 实时监控

访问 `http://localhost:PORT/_internal/dashboard` 查看可视化监控面板。

**功能**：

- **上游数据表格**：实时显示每个上游的请求数、会话数、错误率、性能指标
- **访问日志**：Server-Sent Events (SSE) 实时推送最近 50 条请求日志
- **自动刷新**：10 秒轮询更新统计数据

**表格字段说明**：

| 字段         | 说明                                 |
| ------------ | ------------------------------------ |
| Route        | 路由名称                             |
| Provider     | 提供商                               |
| Model        | 模型名称                             |
| Requests     | 全局累计请求数                       |
| 最近1小时    | 最近 1 小时请求数（滑动窗口）        |
| Sessions     | 活跃会话数                           |
| Errors       | 错误计数                             |
| Avg TTFB     | 平均首字节时间（Time To First Byte） |
| TTFB P95     | TTFB 95 百分位                       |
| TTFB P99     | TTFB 99 百分位                       |
| Avg Duration | 平均响应时长                         |
| Duration P95 | Duration 95 百分位                   |
| Duration P99 | Duration 99 百分位                   |
| 配置权重     | 静态配置的权重                       |
| 当前权重     | 动态调整后的权重                     |

**性能指标说明**：

- **TTFB**：从发送请求到收到第一个字节的时间，反映服务响应速度
- **Duration**：完整请求的总耗时，包括 TTFB 和数据传输时间
- **百分位统计**：P95 表示 95% 的请求低于该值，P99 表示 99% 的请求低于该值
- **滑动窗口**：统计基于最近 1000 个样本，避免历史数据影响实时判断

**内存占用**：

- 每个 upstream 保留最近 1000 个 TTFB 样本和 1000 个 Duration 样本
- 每个样本约 8 字节（number 类型）
- 每个 upstream 约 16KB 内存占用

### Stats 命令行统计

```bash
# 查看最近 24 小时统计
oos proxy stats --last 24h

# 查看最近 7 天统计
oos proxy stats --last 7d

# JSON 格式输出
oos proxy stats --last 1h --json
```

**输出示例**：

```
┌─────────┬────────────┬─────────┬──────────┬─────────┬─────────┬──────────────┬──────────────┬───────┬───────┐
│ (index) │ Provider   │ Model   │ Requests │ Success │ Failure │ Success Rate │ Avg Duration │ P95   │ P99   │
├─────────┼────────────┼─────────┼──────────┼─────────┼─────────┼──────────────┼──────────────┼───────┼───────┤
│ 0       │ 'baidu'    │ 'glm-4' │ 145      │ 144     │ 1       │ '99.31%'     │ 1881         │ 3358  │ 4756  │
│ 1       │ 'ali'      │ 'glm-4' │ 112      │ 112     │ 0       │ '100.00%'    │ 1997         │ 6701  │ 6920  │
└─────────┴────────────┴─────────┴──────────┴─────────┴─────────┴──────────────┴──────────────┴───────┴───────┘
```

### 访问日志

```bash
# 查看最近 50 条日志
oos proxy logs

# 查看最近 100 条日志
oos proxy logs -n 100

# 清空日志文件
oos proxy logs -c
```

日志文件位置：`~/.config/opencode/.oos/logs/access.log`

## 配置热重载

### 概述

热重载允许在不重启代理服务器的情况下更新配置：

- **零停机**：保持现有连接，不中断服务
- **配置验证**：自动验证新配置有效性
- **差异显示**：清晰展示配置变更内容

### 使用方法

**命令行**：

```bash
oos proxy reload               # 从默认地址重载
oos proxy reload --port 3001   # 指定端口
oos proxy reload --host 0.0.0.0 --port 3001
```

**内部端点**（仅限本地访问）：

```bash
curl -X POST http://localhost:3000/_internal/reload
```

### 输出示例

**成功重载**：

```json
{
  "success": true,
  "message": "Config reloaded successfully",
  "diff": {
    "added": ["lb-new-route"],
    "removed": ["lb-old-route"],
    "modified": ["lb-existing-route"]
  }
}
```

**配置无效**：

```json
{
  "success": false,
  "error": "Invalid configuration: routes.lb-test has no valid upstreams"
}
```

**配置文件不存在**：

```json
{
  "success": false,
  "error": "Configuration file not found"
}
```

### 安全限制

- **本地访问**：仅允许 localhost 调用
- **转发限制**：检查 X-Forwarded-For 头
- **非本地请求**：返回 403 Forbidden

### 错误码

| 退出码 | 说明     |
| ------ | -------- |
| 0      | 重载成功 |
| 1      | 配置无效 |
| 2      | 连接失败 |
| 3      | 其他错误 |

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

| 命令                   | 说明                     | 选项                                                                                     |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `oos proxy init`       | 初始化配置文件           | `-f, --force` 覆盖已有配置                                                               |
| `oos proxy start`      | 启动代理服务器           | `-p, --port <port>` 端口<br>`-c, --config <path>` 配置文件<br>`-n, --name <name>` 实例名 |
| `oos proxy stop`       | 停止代理服务器           | 无                                                                                       |
| `oos proxy status`     | 查看服务器状态           | 无                                                                                       |
| `oos proxy reload`     | 热重载配置               | `--host <host>` 主机地址<br>`--port <port>` 端口                                         |
| `oos proxy register`   | 注册代理到 opencode.json | `-p, --port <port>` 代理端口                                                             |
| `oos proxy unregister` | 取消注册代理             | 无                                                                                       |
| `oos proxy logs`       | 查看访问日志             | `-n <count>` 日志条数<br>`-c` 清空日志                                                   |
| `oos proxy stats`      | 查看访问统计             | `--last <period>` 时间范围<br>`--json` JSON 格式输出                                     |
| `oos proxy install`    | 安装为 Windows 服务      | `-p, --port <port>` 服务端口                                                             |
| `oos proxy uninstall`  | 卸载 Windows 服务        | 无                                                                                       |

## 内部端点

代理提供以下内部端点用于监控和管理，**仅允许本地访问**：

| 端点                     | 方法 | 说明          | 认证      |
| ------------------------ | ---- | ------------- | --------- |
| `/_internal/dashboard`   | GET  | HTML 监控面板 | localhost |
| `/_internal/stats`       | GET  | 统计数据 JSON | localhost |
| `/_internal/debug`       | GET  | 调试信息 JSON | localhost |
| `/_internal/logs/stream` | GET  | SSE 日志流    | localhost |
| `/_internal/reload`      | POST | 热重载配置    | localhost |

### 端点详情

**Dashboard**: `GET /_internal/dashboard`

- 返回 HTML 监控面板
- 包含上游统计表格和实时日志
- 10秒自动刷新

**Stats**: `GET /_internal/stats`

- 返回 JSON 格式的统计数据
- 包含请求数、错误率、TTFB、Duration 等

**Debug**: `GET /_internal/debug`

- 返回 JSON 格式的调试信息
- 包含当前路由配置和熔断器状态

**Logs Stream**: `GET /_internal/logs/stream`

- Server-Sent Events (SSE) 流
- 实时推送最近 50 条访问日志

**Reload**: `POST /_internal/reload`

- 热重载配置文件
- 返回配置变更差异
- 仅接受 localhost 请求

## 响应头信息

| 响应头            | 说明                   |
| ----------------- | ---------------------- |
| `x-used-provider` | 实际处理请求的上游 ID  |
| `x-session-id`    | 会话 ID（sticky 策略） |

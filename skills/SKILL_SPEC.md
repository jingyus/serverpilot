# ServerPilot Skill Specification v1.0

## Overview

Skill 是 ServerPilot 的插件扩展机制。每个 Skill 是一段 **AI 增强的自动化运维流程**，以 prompt 为核心驱动 AI 在目标服务器上自主完成任务。

### 设计哲学

- **Prompt-Centric** — Skill 的核心是 prompt，不是写死的脚本。AI 根据 prompt 理解意图，自主决定执行步骤。
- **环境自适应** — 同一个 Skill 在 Ubuntu 上用 `apt`，在 CentOS 上用 `yum`，AI 自行判断，无需 if-else。
- **安全受控** — 所有命令执行经过 ServerPilot 5 级风险分级体系检查，Skill 声明最高允许的风险级别。
- **低门槛** — 会写 prompt 就能开发 Skill，不需要学习复杂的 DSL 或编排语法。

---

## 目录结构

```
skills/
  SKILL_SPEC.md              # 本规范文档
  official/                   # 官方内置 Skills
    log-auditor/
      skill.yaml
    intrusion-detector/
      skill.yaml
    auto-backup/
      skill.yaml
  community/                  # 社区 Skills（通过 Git URL 安装）
    <skill-name>/
      skill.yaml
```

每个 Skill 是一个独立目录，必须包含 `skill.yaml` 文件。

---

## skill.yaml 完整规范

### 最小示例

```yaml
kind: skill
version: "1.0"

metadata:
  name: hello-checker
  displayName: "系统状态速查"
  version: "0.1.0"

triggers:
  - type: manual

tools:
  - shell

prompt: |
  检查当前服务器的基本运行状态，输出 CPU、内存、磁盘使用概况。
```

### 完整字段定义

```yaml
# ============================================================
# 文件标识（必填）
# ============================================================
kind: skill                    # 固定值，标识这是一个 Skill 定义文件
version: "1.0"                 # Skill 规范版本，当前为 "1.0"

# ============================================================
# 元信息 metadata（必填）
# ============================================================
metadata:
  name: string                 # 唯一标识符，小写字母+连字符，如 "log-auditor"
  displayName: string          # 用户可见的显示名称，如 "智能日志审查"
  description: string          # 一句话描述 Skill 功能（可选，建议填写）
  version: string              # Skill 版本号，遵循 SemVer，如 "1.2.0"
  author: string               # 作者标识（可选），如 "serverpilot-official"
  tags: string[]               # 分类标签（可选），如 [security, monitoring]
  icon: string                 # 图标文件路径（可选），相对于 Skill 目录

# ============================================================
# 触发条件 triggers（必填，至少声明一种）
# ============================================================
triggers:
  - type: manual               # 用户手动触发

  - type: cron                 # 定时触发
    schedule: string           # Cron 表达式，如 "0 8 * * *"（每天8点）

  - type: event                # 系统事件触发
    on: string                 # 事件名称（见 §事件类型表）
    filter:                    # 事件过滤条件（可选）
      [key]: value             # 键值对匹配事件 payload

  - type: threshold            # 指标阈值触发
    metric: string             # 指标名称（见 §指标类型表）
    operator: string           # 比较运算符: gt | gte | lt | lte | eq | neq
    value: number              # 阈值数值

# ============================================================
# 可用工具 tools（必填，至少声明一种）
# ============================================================
#
# Skill 只能使用它声明的工具。未声明的工具 AI 无法调用。
# 这是权限最小化原则 —— Skill 只拿它需要的能力。
#
tools:
  - shell              # 在目标服务器执行命令（通过 Agent）
  - read_file          # 读取目标服务器上的文件
  - write_file         # 写入目标服务器上的文件
  - notify             # 发送通知（Webhook / Dashboard 推送）
  - http               # 调用外部 HTTP API
  - store              # 读写 Skill 持久化存储（Key-Value）

# ============================================================
# 用户输入参数 inputs（可选）
# ============================================================
#
# 定义用户可配置的参数。安装/启用 Skill 时，用户填写这些参数。
# 参数值会以 {{参数名}} 的形式注入到 prompt 中。
#
inputs:
  - name: string               # 参数标识符，如 "log_paths"
    type: string               # 类型: string | number | boolean | string[] | enum
    required: boolean          # 是否必填，默认 false
    default: any               # 默认值
    description: string        # 参数说明，展示在配置界面
    options: string[]          # 仅 type=enum 时有效，可选值列表

# ============================================================
# 安全约束 constraints（可选，强烈建议填写）
# ============================================================
constraints:
  risk_level_max: string       # 允许的最高命令风险级别
                               # 可选值: green | yellow | red | critical
                               # 默认: yellow（不声明时，最高只能执行 yellow 级命令）
                               # 注意: forbidden 级命令永远不可执行

  timeout: string              # Skill 单次执行的超时时间
                               # 格式: "30s" | "5m" | "1h"
                               # 默认: "5m"

  max_steps: number            # 单次执行最多允许的命令步数
                               # 默认: 20
                               # 防止 AI 陷入无限循环

  requires_confirmation: boolean
                               # 是否每次执行前需要用户确认
                               # 默认: false（cron 触发的 Skill 通常为 false）
                               # 建议: risk_level_max >= red 时设为 true

  server_scope: string         # 执行范围
                               # "single"  — 只在指定的一台服务器上运行（默认）
                               # "all"     — 在用户所有服务器上依次运行
                               # "tagged"  — 在匹配指定 tag 的服务器上运行

  run_as: string               # 执行身份（可选）
                               # 不指定时使用 Agent 默认身份
                               # 如 "root" 或 "deploy"

# ============================================================
# 运行要求 requires（可选）
# ============================================================
requires:
  agent: string                # Agent 最低版本要求，如 ">=1.0.0"
  os: string[]                 # 支持的操作系统，如 [linux, darwin]
  commands: string[]           # 依赖的系统命令，如 [journalctl, tar]
                               # 执行前会检查命令是否存在

# ============================================================
# Prompt（必填 — Skill 的核心）
# ============================================================
#
# prompt 是发送给 AI 的完整指令。AI 根据 prompt 自主决定：
#   - 执行哪些命令
#   - 以什么顺序执行
#   - 如何分析执行结果
#   - 是否需要发送通知
#
# prompt 中可以使用以下变量：
#   {{input.<参数名>}}          — 用户配置的输入参数
#   {{server.name}}            — 目标服务器名称
#   {{server.os}}              — 目标服务器操作系统
#   {{server.ip}}              — 目标服务器 IP 地址
#   {{skill.last_run}}         — 上次运行时间（ISO 8601）
#   {{skill.last_result}}      — 上次运行的输出摘要
#   {{now}}                    — 当前时间（ISO 8601）
#
prompt: |
  你的 prompt 内容写在这里。

  建议的 prompt 结构：
  ## 角色
  你是一个 XXX 专家。

  ## 任务
  具体要做什么。

  ## 执行指南
  - 首先做什么
  - 然后做什么
  - 注意事项

  ## 输出要求
  - 输出什么格式
  - severity 级别定义
  - 何时发送通知

# ============================================================
# 输出定义 outputs（可选）
# ============================================================
#
# 声明 Skill 执行后产出的结构化数据。
# 用于 Dashboard 展示、其他 Skill 引用、或事件触发链。
#
outputs:
  - name: string               # 输出标识符，如 "report"
    type: string               # 类型: string | number | boolean | object
    description: string        # 输出说明
```

---

## 字段详细说明

### 触发类型 (triggers)

| type | 说明 | 必填字段 | 示例 |
|------|------|---------|------|
| `manual` | 用户在 Dashboard 手动点击运行 | 无 | `- type: manual` |
| `cron` | 按 Cron 表达式定时运行 | `schedule` | `schedule: "0 */6 * * *"` (每6小时) |
| `event` | 响应系统事件运行 | `on` | `on: alert.triggered` |
| `threshold` | 指标超过阈值时运行 | `metric`, `operator`, `value` | `metric: cpu.usage, operator: gte, value: 90` |

**Cron 表达式格式**: 标准 5 字段 (`分 时 日 月 周`)

```
* * * * *
│ │ │ │ │
│ │ │ │ └── 星期 (0-7, 0和7都是周日)
│ │ │ └──── 月 (1-12)
│ │ └────── 日 (1-31)
│ └──────── 时 (0-23)
└────────── 分 (0-59)
```

### 系统事件表 (event.on)

| 事件名 | 触发时机 | Payload 字段 |
|--------|---------|-------------|
| `alert.triggered` | 告警规则触发 | severity, metric, value, serverId |
| `server.offline` | 服务器离线 | serverId, lastSeen |
| `server.online` | 服务器上线 | serverId |
| `task.completed` | 任务执行完成 | taskId, success, serverId |
| `task.failed` | 任务执行失败 | taskId, error, serverId |
| `operation.failed` | 操作执行失败 | operationId, exitCode, serverId |
| `agent.disconnected` | Agent 断开连接 | agentId, serverId |
| `skill.completed` | 其他 Skill 执行完成 | skillName, outputs |

### 指标类型表 (threshold.metric)

| 指标名 | 说明 | 单位 |
|--------|------|------|
| `cpu.usage` | CPU 使用率 | 百分比 (0-100) |
| `memory.usage_percent` | 内存使用率 | 百分比 (0-100) |
| `disk.usage_percent` | 磁盘使用率 | 百分比 (0-100) |
| `disk.io_wait` | 磁盘 IO 等待 | 百分比 |
| `network.rx_bytes` | 网络接收流量 | bytes/s |
| `network.tx_bytes` | 网络发送流量 | bytes/s |
| `load.1min` | 1 分钟负载 | 浮点数 |
| `load.5min` | 5 分钟负载 | 浮点数 |

### 工具能力表 (tools)

| 工具名 | 能力 | 安全限制 |
|--------|------|---------|
| `shell` | 在服务器上执行 shell 命令 | 受 `risk_level_max` 约束，经过 `classifyCommand()` 检查 |
| `read_file` | 读取服务器上的文件内容 | 只读，不触发风险检查 |
| `write_file` | 写入/创建文件 | 受 `risk_level_max` 约束 |
| `notify` | 发送通知到 Webhook/Dashboard | 无限制 |
| `http` | 发起 HTTP 请求到外部 API | 仅允许 HTTPS，禁止内网地址 |
| `store` | 读写 Skill 自身的持久化存储 | 每个 Skill 独立存储空间，最大 1MB |

---

## 安全模型

### 风险级别映射

Skill 复用 ServerPilot 已有的 5 级风险分级体系 (`@aiinstaller/shared/security`)：

| 风险级别 | 说明 | 示例命令 | Skill 中的行为 |
|----------|------|---------|---------------|
| `green` | 只读命令 | `ls`, `cat`, `ps`, `df` | 自动执行 |
| `yellow` | 安装/低危修改 | `apt install`, `pip install` | 需声明，自动执行 |
| `red` | 配置修改 | `systemctl restart`, `chmod` | 需声明，建议 `requires_confirmation: true` |
| `critical` | 危险操作 | `rm -rf`, `fdisk`, `iptables` | 需声明，强制 `requires_confirmation: true` |
| `forbidden` | 绝对禁止 | `:(){ :|:& };:`, `mkfs` | **永远不可执行，无论 Skill 如何声明** |

### 权限检查流程

```
Skill 请求执行命令
  │
  ├── classifyCommand(command) → 获取命令风险级别
  │
  ├── 风险级别 == forbidden ?
  │     └── YES → 拒绝执行，记录审计日志
  │
  ├── 风险级别 > skill.constraints.risk_level_max ?
  │     └── YES → 拒绝执行，通知用户 "Skill 权限不足"
  │
  ├── requires_confirmation == true && 非自动确认的级别 ?
  │     └── YES → 暂停，推送确认请求到 Dashboard
  │
  └── 通过 → 执行命令，记录审计日志
```

### 安装审查

用户安装 Skill 时，系统展示权限摘要：

```
┌──────────────────────────────────────────┐
│  安装 Skill: 智能日志审查 v1.2.0         │
│  作者: serverpilot-official               │
│                                          │
│  请求的权限:                              │
│  ✅ shell  — 在服务器上执行命令           │
│  ✅ notify — 发送通知                     │
│                                          │
│  安全级别: 最高 yellow (安装/低危修改)     │
│  触发方式: 每天 08:00 自动运行            │
│                                          │
│  [安装]  [取消]                           │
└──────────────────────────────────────────┘
```

---

## Prompt 编写指南

### 基本原则

1. **明确角色** — 告诉 AI 它是什么专家
2. **明确目标** — 清楚说明要完成什么任务
3. **给出步骤指引** — 不是死板的步骤，而是指导方向
4. **定义输出格式** — 确保输出可被系统解析
5. **声明边界** — 明确告诉 AI 什么不要做

### 推荐的 Prompt 结构

```yaml
prompt: |
  ## 角色
  你是一个专业的 [领域] 专家，负责 [职责描述]。

  ## 目标
  [用一句话说明这个 Skill 要完成什么]

  ## 环境信息
  - 服务器: {{server.name}} ({{server.os}})
  - IP: {{server.ip}}
  - 上次运行: {{skill.last_run}}

  ## 执行指南
  1. 首先 [做什么]
  2. 然后 [做什么]
  3. 根据结果 [做什么]

  ## 注意事项
  - 不要执行任何危险命令
  - 如果发现异常，优先通过 notify 告警
  - [其他约束]

  ## 输出要求
  以 JSON 格式输出结果：
  {
    "severity": "info | warning | critical",
    "summary": "一句话总结",
    "findings": ["发现1", "发现2"],
    "recommendations": ["建议1", "建议2"]
  }
```

### 变量引用

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{input.<name>}}` | 用户配置的输入参数 | `{{input.log_paths}}` → `"/var/log/syslog"` |
| `{{server.name}}` | 服务器名称 | `"production-web-01"` |
| `{{server.os}}` | 操作系统 | `"Ubuntu 22.04"` |
| `{{server.ip}}` | 服务器 IP | `"192.168.1.100"` |
| `{{skill.last_run}}` | 上次运行时间 | `"2025-01-15T08:00:00Z"` |
| `{{skill.last_result}}` | 上次运行的输出摘要 | `"发现 3 个警告..."` |
| `{{now}}` | 当前时间 | `"2025-01-16T08:00:00Z"` |

---

## Skill 生命周期

```
  发现          安装           配置          启用         运行
 ┌─────┐     ┌─────┐      ┌─────┐      ┌──────┐    ┌──────┐
 │Browse│────▶│Install│────▶│Config│────▶│Enable│───▶│Running│
 │ /Git │     │      │      │inputs│     │      │    │      │
 └─────┘     └─────┘      └─────┘      └──────┘    └──┬───┘
                                           ▲           │
                                           │       ┌───▼───┐
                                       ┌───┴──┐    │Paused │
                                       │Update│    └───┬───┘
                                       └──────┘        │
                                                   ┌───▼────┐
                                                   │Uninstall│
                                                   └────────┘
```

### 状态说明

| 状态 | 说明 |
|------|------|
| `installed` | 已安装，未配置 |
| `configured` | 已配置输入参数 |
| `enabled` | 已启用，触发器活跃 |
| `running` | 正在执行中 |
| `paused` | 暂停，触发器不活跃 |
| `error` | 上次执行出错 |

---

## 执行引擎行为

### 单次执行流程

```
触发 (cron/event/manual/threshold)
  │
  ├── 1. 检查 requires（OS、命令依赖、Agent 版本）
  │     └── 不满足 → 跳过，记录原因
  │
  ├── 2. 解析 prompt，注入变量（inputs、server info、上下文）
  │
  ├── 3. 构建 AI 消息
  │     ├── system: "你是 ServerPilot Skill 执行引擎..."
  │     ├── system: [解析后的 skill prompt]
  │     └── user: "请在服务器 {{server.name}} 上执行此 Skill"
  │
  ├── 4. AI 自主循环（Agentic Loop）
  │     ├── AI 决定调用工具 (shell/read_file/notify/...)
  │     ├── 安全检查 → 通过 → 执行 → 返回结果给 AI
  │     ├── AI 分析结果，决定下一步
  │     └── 重复，直到 AI 认为任务完成或达到 max_steps
  │
  ├── 5. 收集 AI 输出，解析 outputs
  │
  └── 6. 记录执行日志，更新 last_run / last_result
```

### Agentic Loop 约束

- 每次循环 AI 只能调用 `tools` 中声明的工具
- 每条命令经过 `classifyCommand()` 安全检查
- 超过 `max_steps` 次命令执行后强制终止
- 超过 `timeout` 时间后强制终止
- AI 每次工具调用的输入/输出都记录到审计日志

---

## 社区 Skill 发布规范

### 目录结构要求

```
my-awesome-skill/
  skill.yaml           # 必须
  README.md            # 强烈建议：说明用途、配置方法、示例
  LICENSE              # 建议：开源协议
  CHANGELOG.md         # 建议：版本变更记录
```

### 命名规范

- `metadata.name`: 小写字母 + 数字 + 连字符，2-50 字符
- 正确: `log-auditor`, `ssl-checker`, `mysql-backup-v2`
- 错误: `Log_Auditor`, `my skill`, `a`

### 版本规范

遵循 [SemVer](https://semver.org/):
- MAJOR: 不兼容的 prompt 或 inputs 变更
- MINOR: 新增功能（新 output、新 trigger 支持）
- PATCH: Bug 修复、prompt 优化

### 安装方式

```bash
# 从 Git 仓库安装
serverpilot skill install https://github.com/user/my-skill.git

# 从本地目录安装
serverpilot skill install ./path/to/skill/

# 卸载
serverpilot skill uninstall my-skill
```

---

## 与现有系统的集成点

| ServerPilot 模块 | Skill 系统如何复用 |
|-----------------|-------------------|
| Agent 通信协议 | `shell` 工具通过 Agent WebSocket 在目标服务器执行命令 |
| 5 级风险分级 | `classifyCommand()` 检查每条命令，`risk_level_max` 设置上限 |
| AI Provider | Skill 执行使用用户配置的 AI Provider（Claude/OpenAI/...） |
| Webhook | `notify` 工具复用现有 Webhook Dispatcher |
| 审计日志 | 所有命令执行自动记录到 audit_log |
| 服务器档案 | `{{server.*}}` 变量来自 ServerProfile |
| RBAC | Skill 安装/管理需要 `skill:manage` 权限，执行需要 `skill:execute` 权限 |
| Dashboard | Skill 商店、配置、运行状态、日志查看 |

---

## 附录：规范版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-02-12 | 初始版本 |

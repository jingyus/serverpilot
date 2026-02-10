# AIInstaller 项目功能模块分析

> 基于源码梳理 · 2026-02-09 · 配合 DevOps 产品方案 (ServerPilot) 复用评估

---

## 1. 项目概述

**AIInstaller** 是一个 AI 驱动的软件安装平台，采用 **Server-Agent 架构** + **WebSocket 实时通信**。当前以 "AI 辅助安装 OpenClaw" 为主要场景，但其架构具有通用性。

### 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | TypeScript (ESM) |
| 运行时 | Node.js (Server), Bun (Agent 编译) |
| Monorepo | pnpm workspace |
| 通信 | WebSocket (ws) |
| 类型验证 | Zod (Server/Shared), 轻量手写验证 (Agent) |
| 测试 | Vitest |
| 构建 | Bun compile (单一二进制) |
| 部署 | Docker Compose, Fly.io |

### 代码结构

```
aiinstaller/
├── packages/
│   ├── agent/          # 客户端 Agent (安装在目标机器)
│   ├── server/         # 服务端 (AI 引擎 + API + WS)
│   ├── shared/         # 共享协议定义
│   ├── admin/          # 管理面板 (新增)
│   └── website/        # 官网 (新增)
├── scripts/            # 构建、部署、发布脚本
├── tests/              # 集成测试 / E2E 测试
├── nginx/              # Nginx 配置
├── docker-compose.yml  # 容器编排
├── fly.toml            # Fly.io 部署配置
└── install.sh          # 一键安装脚本
```

---

## 2. 功能模块详解

### 模块 A: WebSocket 通信层

**位置**: `packages/agent/src/client.ts`, `packages/agent/src/authenticated-client.ts`, `packages/server/src/api/server.ts`

**功能**:
- WebSocket 长连接管理 (Server ↔ Agent)
- 自动重连 + 指数退避 (可配置最大重试次数、基础延迟、最大延迟)
- 连接超时控制
- 事件驱动架构 (`connected`, `disconnected`, `message`, `error`, `reconnecting`, `reconnectFailed`)
- 消息序列化 / 反序列化 + 协议验证
- 带认证的客户端封装 (`AuthenticatedClient`)

**关键接口**:
```typescript
// 连接配置
interface InstallClientOptions {
  serverUrl: string;
  autoReconnect?: boolean;         // 默认 true
  maxReconnectAttempts?: number;   // 默认 5
  reconnectBaseDelayMs?: number;   // 默认 1000
  reconnectMaxDelayMs?: number;    // 默认 30000
  connectionTimeoutMs?: number;    // 默认 10000
}

// 连接状态
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
```

**复用评估**: ★★★★★ 核心复用模块
> ServerPilot 的 Agent ↔ Server WSS 通信可直接复用。需扩展:
> - `ws` → `wss` (TLS 加密)
> - 添加心跳机制 (30s)
> - 消息确认 (ack) 机制
> - 将 `maxReconnectAttempts` 改为无限重连（永不放弃）

---

### 模块 B: 协议消息系统

**位置**: `packages/shared/src/protocol/messages.ts`, `packages/agent/src/protocol-lite.ts`

**功能**:
- 统一的消息类型定义 (Zod schema)
- 轻量版协议（Agent 端不依赖 Zod，减小二进制体积 8-10 MB）
- 消息创建工具函数 (`createMessage` / `createMessageLite`)
- 消息安全解析 (`safeParseMessage` / `safeParseMessageLite`)

**当前消息类型**:
```
auth.request / auth.response          # 认证
session.create                         # 会话创建
env.report                             # 环境上报
plan.receive                           # 接收安装计划
step.execute / step.output / step.complete  # 步骤执行
error.occurred / fix.suggest           # 错误处理
session.complete                       # 会话结束
ai.stream.start/token/complete/error   # AI 流式响应
```

**复用评估**: ★★★★★ 核心复用模块
> 协议分层设计（Server 用 Zod 完整验证，Agent 用轻量验证）非常适合 ServerPilot。需扩展消息类型:
> - `heartbeat` — 心跳
> - `metrics.report` — 监控指标上报
> - `command.execute / command.output / command.result` — 命令执行（替换 step.*）
> - `command.cancel` — 取消执行
> - `env.request` — 请求环境信息
> - `agent.upgrade` — 升级通知
> - `ack` — 消息确认

---

### 模块 C: 环境探测系统

**位置**: `packages/agent/src/detect/`

**子模块**:

| 文件 | 功能 | 探测内容 |
|------|------|---------|
| `os.ts` | 操作系统检测 | OS 类型/版本/架构/内核 |
| `runtime.ts` | 运行时检测 | Node.js/Bun/Python 版本 |
| `package-managers.ts` | 包管理器检测 | apt/yum/brew/npm/pnpm/pip 等 |
| `network.ts` | 网络检测 | npm/GitHub 可达性、代理检测 |
| `device-fingerprint.ts` | 设备指纹 | 唯一设备标识生成 |
| `index.test.ts` | 集成测试 | 全量探测测试 |

**关键输出结构**:
```typescript
interface EnvironmentInfo {
  os: { platform, distro, version, arch, kernel };
  runtime: { node?, bun?, python? };
  packageManagers: { apt?, yum?, brew?, npm?, ... };
  network: { canAccessNpm, canAccessGithub, proxy? };
  permissions: { isRoot, canSudo, homeDir };
  hardware: { cpu, memory, disk };
}
```

**复用评估**: ★★★★★ 直接复用
> ServerPilot Agent 的"环境探测"功能完全对应。当前模块已实现:
> - 系统信息采集（OS/CPU/内存/磁盘）
> - 包管理器发现
> - 网络连通性检测
> - 设备指纹（可作为 Agent ID 基础）
>
> 需扩展:
> - 已安装软件清单发现（扫描 dpkg/rpm/brew）
> - 运行服务检测（systemctl list-units）
> - 开放端口检测（ss/netstat）
> - 增量更新上报（差异对比）

---

### 模块 D: 命令执行引擎

**位置**: `packages/agent/src/execute/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `executor.ts` | 命令执行器 — 封装 child_process，支持超时、实时输出流 |
| `sandbox.ts` | 沙箱执行 — 安全隔离的命令执行环境 |
| `snapshot.ts` | 操作快照 — 执行前状态记录，支持回滚 |

**关键能力**:
- 命令超时控制
- 实时 stdout/stderr 流式回传
- 退出码处理
- 沙箱隔离执行

**复用评估**: ★★★★★ 直接复用
> ServerPilot Agent 的"命令执行"核心。当前已有:
> - 沙箱执行 + 超时控制 + 流式输出
> - 快照机制（操作前备份）
>
> 需扩展:
> - 命令分级白名单（🟢/🟡/🔴/⛔/🚫 五级）
> - 参数安全审计（危险参数黑名单）
> - 专用用户权限执行（serverpilot 用户 + sudoers）
> - 幂等性标记（防止重复执行）

---

### 模块 E: AI 引擎

**位置**: `packages/server/src/ai/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `agent.ts` | AI Agent 调用 — 对接 LLM API (Claude/OpenAI 等) |
| `planner.ts` | 通用 AI 规划器 — 生成结构化执行计划 |
| `error-analyzer.ts` | 错误分析器 — 分析命令执行失败原因并生成修复建议 |
| `common-errors.ts` | 常见错误库 — 内置错误模式匹配 |
| `fault-tolerance.ts` | 容错机制 — AI 调用失败重试、模型降级 |

**关键能力**:
- 多模型支持 (Claude/OpenAI/DeepSeek 等)
- 结构化计划输出 (JSON 格式的步骤列表)
- 错误自动诊断 + 修复建议生成
- AI 调用失败时的容错/降级策略
- 流式响应支持 (ai.stream.*)

**复用评估**: ★★★★★ 核心复用模块
> ServerPilot 的"AI 对话引擎"核心。当前已有:
> - 多模型调用能力
> - 结构化计划生成
> - 错误诊断闭环
> - 容错/降级机制
>
> 需扩展:
> - AI Provider 抽象层（统一 interface，可插拔）
> - Ollama 本地模型支持
> - 模型能力分级 (Tier 1/2/3)
> - System Prompt 动态拼接（角色 + 档案 + 安全规则 + 格式约束）
> - 对话上下文管理（滑动窗口 + 摘要压缩）
> - 输出校验层（命令存在性、安全规则、OS 匹配）

---

### 模块 F: 安装流程编排

**位置**: `packages/server/src/installers/openclaw/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `planner.ts` | 安装计划生成 — 基于环境检测结果生成步骤列表 |
| `steps.ts` | 步骤定义 — 具体安装命令和参数 |
| `detect.ts` | 前置检测 — 检查安装条件是否满足 |
| `env-plan-adjuster.ts` | 环境适配 — 根据 OS/架构调整安装计划 |
| `alternative-commands.ts` | 备选命令 — 主命令失败时的替代方案 |
| `step-skipper.ts` | 步骤跳过 — 已安装组件自动跳过 |
| `step-merger.ts` | 步骤合并 — 合并可批量执行的步骤 |
| `step-retry.ts` | 步骤重试 — 失败自动重试策略 |
| `success-rate-tracker.ts` | 成功率追踪 — 追踪各步骤历史成功率 |
| `timeout-adjuster.ts` | 超时调整 — 根据网络环境动态调整超时 |
| `auto-switch.ts` | 自动切换 — 安装方式自动切换 |
| `common-errors.ts` | 常见错误 — 安装过程常见错误模式 |

**复用评估**: ★★★☆☆ 架构模式复用，逻辑需重写
> 当前是 OpenClaw 专用安装器，但其**架构模式**非常有价值:
> - 计划生成 → 环境适配 → 步骤优化 → 执行 → 重试
> - 这套流程可抽象为 ServerPilot 的"任务执行引擎"
>
> 可复用的设计模式:
> - 风险评估 (`assessRisks`)
> - 步骤跳过/合并/重试策略
> - 成功率追踪
> - 超时动态调整
> - 备选命令机制
>
> 需要重写:
> - 将 OpenClaw 专用逻辑替换为通用运维命令执行
> - 接入 AI 动态计划生成（而非预定义步骤）

---

### 模块 G: API 服务层

**位置**: `packages/server/src/api/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `server.ts` | HTTP + WebSocket 服务器 |
| `handlers.ts` | 请求处理器 — 消息路由和业务逻辑 |
| `auth-handler.ts` | 认证处理 — 设备/Agent 认证 |
| `device-client.ts` | 设备管理 — 设备注册、状态追踪 |
| `session-client.ts` | 会话管理 — 安装会话生命周期 |
| `license-client.ts` | 许可证管理 — 授权验证 |
| `rate-limiter.ts` | 限流器 — AI 调用配额管理 |

**关键设计**:
- 设备指纹认证
- 会话生命周期管理 (创建 → 执行 → 完成/失败)
- AI 调用配额: 免费 5 次安装/月, 20 次 AI 调用/安装
- 多 AI Provider 支持 (anthropic/openai/deepseek/google/qwen)

**复用评估**: ★★★★☆ 大部分可复用
> ServerPilot Server 的 API 层可基于此扩展:
> - HTTP 服务器 → 添加 REST API 路由 (/api/v1/...)
> - WebSocket 服务器 → 升级为 WSS + 多连接管理
> - 认证 → 从设备指纹改为密钥认证 (HMAC)
> - 会话 → 从安装会话改为对话会话
> - 限流 → 云版继续使用，社区版移除
>
> 需扩展:
> - Agent 连接管理器（多 Agent 并发连接）
> - 用户认证模块（注册/登录/JWT）
> - 任务调度器（即时 + 定时任务）

---

### 模块 H: 用户界面层

**位置**: `packages/agent/src/ui/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `progress.ts` | 进度条展示 — 多步骤安装进度追踪 |
| `prompt.ts` | 用户交互 — 确认/选择/输入提示 |
| `error-messages.ts` | 错误展示 — 格式化错误信息和修复建议 |
| `summary.ts` | 安装总结 — 完成后的结果展示 |
| `verbose.ts` | 详细日志 — 调试模式的详细输出 |

**复用评估**: ★★★☆☆ CLI 部分复用
> ServerPilot Agent CLI 可复用:
> - 进度条展示（命令执行进度）
> - 错误格式化（网络错误、执行失败的友好提示）
> - 用户确认交互（危险操作确认）
>
> Web Dashboard 需要全新开发（React SPA）

---

### 模块 I: 构建与部署系统

**位置**: `scripts/`, `docker-compose.yml`, `fly.toml`, `.github/`

**子模块**:

| 文件 | 功能 |
|------|------|
| `build-binary.ts` | 跨平台二进制编译 (Bun compile) |
| `cdn-config.ts` | CDN 分发配置 |
| `github-releases.ts` | GitHub Release 自动发布 |
| `release.ts` | 版本发布流程 |
| `install-sh.ts` | 一键安装脚本生成 |
| `fly-*.ts` | Fly.io 部署全套 (init/deploy/secrets/autoscale/cli-install/setup) |
| `docs-publish.ts` | 文档发布 |
| `monitoring-config.ts` | 监控配置 |
| `docker-compose.yml` | 容器编排 |
| `fly.toml` | Fly.io 部署配置 |
| `install.sh` | 一键安装脚本 |
| `nginx/` | Nginx 反向代理配置 |
| `.github/` | CI/CD 工作流 |

**复用评估**: ★★★★★ 完整复用
> ServerPilot 的部署体系可直接沿用:
> - `build-binary.ts` → Agent 二进制跨平台编译
> - `github-releases.ts` → Agent 发布 + 签名
> - `install-sh.ts` → `curl -fsSL https://get.serverpilot.dev | bash`
> - `fly-*.ts` → 云版 Server 部署到 Fly.io
> - `docker-compose.yml` → 自部署单机一体模式
> - `monitoring-config.ts` → 服务监控
> - CI/CD → 测试 + 构建 + 发布

---

### 模块 J: 共享类型与协议

**位置**: `packages/shared/src/`

**内容**:
- `protocol/messages.ts` — 完整消息类型定义 (Zod schema)
- 共享的 TypeScript 类型: `EnvironmentInfo`, `InstallPlan`, `InstallStep`, `StepResult` 等

**复用评估**: ★★★★★ 直接复用 + 扩展
> 消息协议和共享类型是架构基础，直接复用并扩展新消息类型

---

## 3. 与 DevOps 产品方案 (ServerPilot) 的模块映射

### 3.1 可直接复用的模块

| ServerPilot 功能需求 | 对应现有模块 | 复用度 | 改动量 |
|---------------------|------------|--------|--------|
| Agent ↔ Server WSS 通信 | 模块 A (client.ts + server.ts) | 90% | 加 TLS + 心跳 + ack |
| 消息协议 | 模块 B (protocol) | 80% | 扩展消息类型 |
| Agent 环境探测 | 模块 C (detect/) | 85% | 加软件清单/服务/端口扫描 |
| Agent 命令执行 | 模块 D (execute/) | 80% | 加命令分级 + 权限控制 |
| AI 引擎（多模型调用） | 模块 E (ai/) | 75% | 加 Ollama + Provider 抽象 |
| AI 错误诊断 | 模块 E (error-analyzer.ts) | 90% | 直接复用 |
| AI 容错/降级 | 模块 E (fault-tolerance.ts) | 90% | 直接复用 |
| Agent 二进制构建 | 模块 I (build-binary.ts) | 95% | 改名 + 加签名 |
| 一键安装脚本 | 模块 I (install.sh) | 80% | 改安装逻辑 |
| Docker 部署 | 模块 I (docker-compose.yml) | 70% | 适配新架构 |
| Fly.io 云部署 | 模块 I (fly-*.ts) | 85% | 配置调整 |
| CI/CD + GitHub Release | 模块 I (.github/ + release.ts) | 90% | 直接复用 |
| 限流/配额管理 | 模块 G (rate-limiter.ts) | 70% | 适配云版计费模型 |
| 设备认证 | 模块 G (auth-handler.ts) | 60% | 改为密钥认证 |

### 3.2 可复用架构模式（需重写逻辑）

| ServerPilot 功能需求 | 参考现有模块 | 复用方式 |
|---------------------|------------|---------|
| 任务执行引擎 | 模块 F (installers/openclaw/) | 复用步骤编排、重试、超时、降级的设计模式 |
| 服务器档案系统 | 模块 C (detect/) 的输出 | 将环境探测结果持久化为档案 |
| 知识库 RAG | 当前无 | 全新开发（产品方案已有设计） |
| 操作历史审计 | 当前无 | 全新开发（基于现有消息协议扩展） |

### 3.3 需要全新开发的模块

| ServerPilot 功能需求 | 说明 | 优先级 |
|---------------------|------|--------|
| **Web Dashboard (React SPA)** | 服务器列表、AI 对话界面、监控面板、设置 | MVP |
| **AI 对话模块** | 自然语言 → 结构化计划，上下文管理 | MVP |
| **服务器档案管理器** | 档案 CRUD + AI 上下文注入 + 增量更新 | MVP |
| **命令分级白名单** | 五级分类 + 参数审计 | MVP |
| **用户认证系统** | 注册/登录/JWT (云版: OAuth) | MVP |
| **SQLite 数据库层** | 档案/历史/任务/审计 持久化 | MVP |
| **定时任务调度器** | Cron 表达式 + Agent 下发 | v0.2 |
| **监控指标采集** | CPU/内存/磁盘/网络 + 实时图表 | v0.2 |
| **告警规则引擎** | 阈值告警 + 邮件/Webhook 通知 | v0.2 |
| **快照回滚系统** | 配置快照 + 数据库快照 + 一键回滚 | v0.2 |
| **知识库系统** | 内置知识 + 自动学习 + 文档抓取 | v0.2 |
| **Agent 自动更新** | 版本检查 + 下载 + 签名验证 + 热替换 | v0.2 |
| **团队协作** | 多用户 + 角色权限 + 邀请 | v1.0 (云版) |
| **Stripe 计费** | 订阅管理 + 计费 | v1.0 (云版) |

---

## 4. 与 OpenClaw 的对比分析

| 维度 | AIInstaller (当前) | OpenClaw | ServerPilot (目标) |
|------|------------------|----------|------------------|
| **核心场景** | 软件安装 | 多渠道 AI 助手 | 服务器运维 |
| **架构** | Server + Agent | Gateway + Agent | Server + Agent |
| **通信** | WebSocket | WebSocket + RPC | WSS |
| **AI 调用** | Server 端调用 | Agent 端调用 | Server 端调用 |
| **插件系统** | 无 | 完善 (32 扩展) | v1.2+ 规划 |
| **UI** | CLI | CLI + WebChat + 控制面板 | Web Dashboard + CLI |
| **部署** | Docker | Docker + Daemon | Docker + 单二进制 |
| **代码规模** | ~15k 行 | ~125k 行 | 预计 ~40-60k 行 (MVP) |

### 可从 OpenClaw 借鉴的设计

| OpenClaw 特性 | ServerPilot 对应需求 | 借鉴价值 |
|--------------|-------------------|---------|
| Gateway + Agent 分离 | Server + Agent 分离 | ★★★★★ 相同架构理念 |
| 插件化扩展 (registerTool/Channel/Hook) | 插件系统 (v1.2+) | ★★★★☆ 注册式 API 设计 |
| 会话管理生命周期 | 对话会话管理 | ★★★★☆ 创建→执行→压缩→保存 |
| 故障转移 (认证轮转 + 模型回退) | AI 容错 + 模型降级 | ★★★★★ 当前已部分实现 |
| 并发控制 (Lane 系统) | Agent 命令并发控制 | ★★★☆☆ 可参考设计 |
| 技能系统 (Markdown + 代码) | 知识库 (Markdown 文档) | ★★★☆☆ 类似的知识注入方式 |
| 子 Agent 系统 | 暂不需要 | ★☆☆☆☆ 不适用 |

---

## 5. 复用路线图建议

### Phase 1: MVP 核心复用 (6 周)

```
直接复用（改名 + 适配）:
├── WebSocket 通信层 (client.ts → agent-ws-client.ts)
│   └── 添加 TLS + 心跳 + ack
├── 协议消息系统 (protocol/)
│   └── 扩展 ServerPilot 消息类型
├── 环境探测 (detect/)
│   └── 扩展软件清单 + 服务发现
├── 命令执行 (execute/)
│   └── 添加分级白名单
├── AI 引擎 (ai/)
│   └── 添加 Provider 抽象 + Ollama
├── 构建系统 (scripts/)
│   └── 改名 + 添加签名
└── Docker + 部署
    └── 适配新架构

全新开发:
├── Web Dashboard (React + Vite + Tailwind)
├── REST API 路由 (/api/v1/)
├── 用户认证 (社区版本地账户)
├── SQLite 数据层
├── 服务器档案管理
├── AI 对话模块 (System Prompt 工程)
└── 命令安全审计
```

### Phase 2: 安全与体验 (4 周)

```
扩展现有模块:
├── 快照回滚 (execute/snapshot.ts 增强)
├── 定时任务 (新增调度器)
├── 监控采集 (detect/ 扩展)
└── Agent 自动更新 (build-binary.ts + github-releases.ts)

全新开发:
├── 告警规则引擎
├── 知识库系统
├── 档案增量更新
└── 完善的操作历史
```

### Phase 3: 开源发布 (4 周)

```
复用:
├── CI/CD (.github/)
├── 安装脚本 (install.sh)
├── CDN 分发 (cdn-config.ts)
└── 文档发布 (docs-publish.ts)
```

---

## 6. 总结

### 复用度统计

| 类别 | 模块数 | 可复用 | 复用率 |
|------|--------|--------|--------|
| 通信层 | 3 | 3 | 100% |
| AI 引擎 | 5 | 5 | 100% |
| 环境探测 | 6 | 6 | 100% |
| 命令执行 | 3 | 3 | 100% |
| API 服务 | 7 | 5 | 71% |
| 安装编排 | 12 | 0 (模式复用) | 模式复用 |
| UI 层 | 5 | 3 | 60% |
| 构建部署 | 12 | 11 | 92% |
| **合计** | **53** | **36** | **~70%** |

### 关键结论

1. **架构完全匹配**: AIInstaller 的 Server-Agent-WSS 架构与 ServerPilot 产品方案一致，这是最大的复用优势

2. **核心通信可直接用**: WebSocket 客户端/服务器 + 协议消息系统经过测试验证，是可靠的基础

3. **AI 引擎是宝贵资产**: 多模型调用 + 错误诊断 + 容错降级已经实现，省去大量开发时间

4. **Agent 能力基础扎实**: 环境探测 + 命令执行 + 沙箱 + 快照，覆盖了 ServerPilot Agent 80% 的核心需求

5. **DevOps 基础设施完备**: 跨平台构建 + 一键安装 + Docker + Fly.io + CI/CD 全套可用

6. **主要新增工作**: Web Dashboard、AI 对话模块、服务器档案、命令安全审计、知识库系统 — 这些是 ServerPilot 的差异化功能，需要全新开发

**预计 MVP 开发效率提升**: 由于 ~70% 的基础模块可复用，MVP 开发周期可从 10-12 周缩短至 **6 周**。

# OpenClaw 项目深度分析

## 项目定位

**OpenClaw** 是一个**本地优先的个人 AI 助手框架**，让用户可以通过 WhatsApp、Telegram、Slack、Discord 等 15+ 通讯平台与 Claude/GPT 等 AI 交互。

### 核心价值

- **数据隐私**：所有敏感数据存储在本地
- **多渠道统一**：一个网关对接所有消息平台
- **高度可扩展**：插件化架构

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  多渠道通讯平台 (WhatsApp/Telegram/Slack/Discord/Signal...) │
└────────────────────────────┬────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│           Gateway (WebSocket 控制平面)                       │
│  ├── 会话管理 (Session Layer)                               │
│  ├── 多客户端路由 (Routing Engine)                          │
│  ├── 配置管理 + Cron + Webhooks                             │
│  └── 媒体管道 (图片/音频/视频处理)                           │
└────────────────────────────┬────────────────────────────────┘
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
         ┌────────┐    ┌──────────┐   ┌──────────┐
         │Pi Agent│    │ macOS App│   │ CLI/TUI  │
         │ (RPC)  │    │ iOS/Android│ │          │
         └────────┘    └──────────┘   └──────────┘
```

### 核心数据流

1. **入口**: 用户在 WhatsApp/Telegram/etc 发送消息
2. **网关**: 接收消息，路由到对应 Agent
3. **Pi Agent**: 调用 LLM，使用工具（浏览器、Canvas、脚本等）
4. **响应**: 回复送回原渠道（或其他渠道）

---

## 代码组织 (Monorepo)

| 目录 | 内容 | 规模 |
|------|------|------|
| `src/` | 核心源码 (69个模块) | ~50k+ 行 |
| `extensions/` | 32个官方扩展 | ~20k+ 行 |
| `apps/` | macOS/iOS/Android 应用 | ~30k+ 行 |
| `skills/` | 54个可选技能 | - |
| `ui/` | WebChat + 控制面板 | ~10k+ 行 |
| `docs/` | 完整文档 | - |
| `test/` | 测试文件 | ~15k+ 行 |

### 核心模块分布

```
src/
├── gateway/          # 125 文件 - 网关核心 (WS服务器+RPC)
├── agents/           # 299 文件 - Pi智能体集成
├── commands/         # 177 文件 - CLI命令
├── config/           # 123 文件 - 配置系统
├── infra/            # 152 文件 - 基础设施
├── cli/              # ~100 文件 - CLI程序构建
├── browser/          # 70 文件 - 浏览器控制
├── plugins/          # 插件系统
├── channels/         # 通讯渠道共享逻辑
├── telegram/         # Telegram支持
├── slack/            # Slack支持
├── discord/          # Discord支持
├── whatsapp/         # WhatsApp支持
└── ...
```

---

## 核心设计模式

### 1. Gateway + Agent 分离架构

```
用户消息 → Gateway(路由/认证/会话) → Agent(AI调用/工具执行) → 回复
```

- **Gateway 职责**：多客户端协调、消息路由、配置管理
- **Agent 职责**：LLM 调用、工具执行、上下文管理
- **优势**：职责分离，支持分布式部署

### 2. 插件化扩展系统

```typescript
// 清单驱动
openclaw.plugin.json → 定义ID、配置Schema、元数据

// 注册式API
api.registerTool(tool)           // 注册工具
api.registerChannel(channel)     // 注册通道
api.registerHook("event", fn)    // 注册钩子
api.registerService(service)     // 注册服务
api.registerProvider(provider)   // 注册模型提供商
api.registerCli(registrar)       // 注册CLI命令
```

### 3. 多层技能系统

```
优先级: 工作区技能 > 自定义目录 > 内置技能 > 捆绑技能
```

- 每个技能是一个 Markdown 文件 + 可选代码
- 运行时动态加载到系统提示

### 4. 故障转移机制

```
尝试主模型 → 失败 → 认证轮转 → 模型回退 → 上下文压缩
```

- 自动认证配置轮转
- 模型备用列表
- 上下文溢出时自动压缩

### 5. 并发控制（车道系统）

```typescript
// 两级队列
sessionLane: 防止同一会话并发修改
globalLane: 可选的全局并发限制
```

### 6. 事件驱动的钩子系统

```typescript
钩子点:
- message_received → before_agent_start → before_tool_call
- after_tool_call → agent_end → message_sending → message_sent
```

---

## 核心执行流程

```
用户输入
  ↓
entry.ts: 进程初始化
  ↓
run-main.ts: CLI主函数
  ├── 环境加载 (dotenv)
  ├── 运行时检查
  └── 快速路由检查
  ↓
Commander 解析命令
  ↓
Agent 执行 (嵌入式或Gateway)
  ├── 加载配置和工作空间
  ├── 解析会话
  ├── 构建技能快照
  ├── 构建系统提示
  ├── 创建工具集合
  ├── 调用 LLM API
  ├── 处理工具调用 (循环)
  ├── 故障转移/重试
  └── 保存会话
  ↓
结果交付
```

---

## 技术栈

| 类别 | 技术选型 |
|------|---------|
| **运行时** | Node.js 22+, TypeScript ESM |
| **构建** | pnpm monorepo, tsx |
| **类型验证** | Zod + TypeBox |
| **WebSocket** | ws (8.19.0) |
| **HTTP** | Express 5 + Hono |
| **浏览器** | Playwright |
| **媒体处理** | Sharp + FFmpeg |
| **向量DB** | sqlite-vec |
| **CLI** | Commander + @clack/prompts |
| **测试** | Vitest + V8 覆盖率 |
| **Linter** | oxlint + oxfmt |

### 通讯渠道集成

| 渠道 | 库 | 类型 |
|------|-----|------|
| WhatsApp | @whiskeysockets/baileys | Web 爬虫 |
| Telegram | grammY | Bot API |
| Slack | @slack/bolt | Official API |
| Discord | discord.js | Official API |
| Signal | signal-cli | CLI 包装 |
| iMessage | imsg | Native |
| Matrix | matrix-sdk-crypto | Official |

---

## Agent 和工作流设计

### Agent 隔离

```
单个 Agent 的完整隔离：
├── 工作区 (~/.openclaw/workspace-<agentId>/)
│   └── AGENTS.md, SOUL.md, TOOLS.md, 本地技能
├── Agent 目录 (~/.openclaw/agents/<agentId>/agent/)
│   ├── auth-profiles.json (认证凭证)
│   └── models.json (模型发现)
├── 会话存储 (~/.openclaw/agents/<agentId>/sessions/)
│   └── <SessionId>.jsonl (交互记录)
└── 身份标识
    └── agentId (唯一标识)
```

### 子 Agent 系统

```
sessions_spawn() → 即时返回 → 后台运行 → 结果自动公告回来
```

- 异步执行，不阻塞主会话
- 自动归档和清理
- 工具策略隔离（禁止嵌套spawn）

### 会话管理

```
Session 生命周期:
├── 创建 (resolveSession)
├── 加载 (loadSessionEntry)
├── 执行 (追加消息、调用AI、工具执行)
├── 压缩 (上下文溢出时)
├── 保存 (updateSessionStore)
└── 交付 (发送回复)
```

---

## 扩展系统

### 扩展发现优先级

1. **配置加载路径** (origin: "config")
2. **工作空间扩展** (`{workspaceDir}/.openclaw/extensions`)
3. **全局扩展** (`~/.config/openclaw/extensions`)
4. **打包扩展** (origin: "bundled")

### 清单格式

```json
{
  "id": "my-plugin",
  "kind": "memory",
  "channels": ["discord"],
  "name": "My Plugin",
  "description": "Plugin description",
  "version": "1.0.0",
  "configSchema": { /* JSON Schema */ }
}
```

### 支持的注册类型

- `registerTool()` - 注册 LLM 工具
- `registerChannel()` - 注册通讯渠道
- `registerHook()` - 注册生命周期钩子
- `registerService()` - 注册后台服务
- `registerProvider()` - 注册模型提供商
- `registerCli()` - 注册 CLI 命令
- `registerHttpRoute()` - 注册 HTTP 路由
- `registerGatewayMethod()` - 注册网关方法
- `registerCommand()` - 注册文本命令

---

## 项目成熟度

| 指标 | 状态 |
|------|------|
| 代码规模 | ~125k+ 行 |
| 测试覆盖 | 70%+ |
| 文档 | 完整 (Mintlify) |
| CI/CD | GitHub Actions |
| 开源协议 | MIT |
| 社区 | 活跃 (Discord) |

---

## 部署选项

- **本地运行**: 直接 Node.js 运行
- **Docker**: Dockerfile + docker-compose
- **Daemon**: systemd (Linux) / launchd (macOS)
- **远程访问**: Tailscale Serve/Funnel, SSH 隧道
- **云托管**: Fly.io (fly.toml)

---

## 总结

OpenClaw 是一个架构设计优秀的开源项目，核心特点：

1. **模块化**：Gateway + Agent + 插件分离
2. **可扩展**：插件系统 + 技能系统
3. **可靠性**：故障转移 + 并发控制
4. **隐私优先**：本地存储 + 自托管
5. **多平台**：CLI + macOS/iOS/Android + WebChat

# ServerPilot 技术方案

> 版本: v1.0 | 日期: 2026-02-09
> 基于产品方案 v2.2 设计

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 系统架构设计](#2-系统架构设计)
- [3. 技术栈选型](#3-技术栈选型)
- [4. 核心模块设计](#4-核心模块设计)
- [5. 数据库设计](#5-数据库设计)
- [6. API 设计](#6-api-设计)
- [7. 通信协议设计](#7-通信协议设计)
- [8. 安全架构](#8-安全架构)
- [9. AI 引擎设计](#9-ai-引擎设计)
- [10. 部署方案](#10-部署方案)
- [11. 开发计划与里程碑](#11-开发计划与里程碑)
- [12. 现有模块复用分析](#12-现有模块复用分析)

---

## 1. 项目概述

### 1.1 项目定位

ServerPilot 是一款 **AI 驱动的智能运维平台**，用户通过自然语言对话管理服务器，AI 自动将运维意图转化为可执行的操作计划，由 Agent 安全执行。

**核心理念:**
```
传统运维: 用户 → 写脚本/敲命令 → 服务器
ServerPilot: 用户 → 对话 AI → AI 生成计划 → Agent 执行 → 结果反馈
```

### 1.2 系统组成

| 组件 | 职责 | 技术栈 |
|------|------|--------|
| **Server** | 大脑 - 理解意图、制定计划、调度执行 | Node.js + TypeScript |
| **Agent** | 手脚 - 探测环境、执行命令、汇报状态 | Bun/Node.js + TypeScript |
| **Dashboard** | 眼睛 - Web 界面、可视化管理 | React + Vite |
| **AI Provider** | 智能引擎 - 可插拔的 AI 模型 | Claude/GPT/DeepSeek/Ollama |

### 1.3 部署模式

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| 单机一体 (A) | 个人开发者 1 台服务器 | 一条命令部署，Server+Agent 同机 |
| 一主多从 (B) | 小团队 2-20 台服务器 | 管理节点装 Server，其余只装 Agent |
| 本机管远程 (C) | 远程运维场景 | 本地 Mac/PC 管理云服务器 |
| 云版 | 企业/团队 | 免部署，注册即用 |

---

## 2. 系统架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户层                                    │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Web Dashboard   │    │   Agent CLI     │                     │
│  │  (React SPA)     │    │  (终端对话)      │                     │
│  └────────┬────────┘    └────────┬────────┘                     │
└───────────┼──────────────────────┼──────────────────────────────┘
            │ REST/WebSocket       │ WebSocket
┌───────────┼──────────────────────┼──────────────────────────────┐
│           ▼                      ▼                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Server (Node.js)                          ││
│  │                                                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │  REST API   │  │ WebSocket   │  │ Dashboard   │          ││
│  │  │  /api/v1/*  │  │ Gateway     │  │ Static      │          ││
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘          ││
│  │         │                │                                   ││
│  │  ┌──────┴────────────────┴──────┐                           ││
│  │  │         核心引擎层             │                           ││
│  │  │  ┌───────────┐ ┌───────────┐ │                           ││
│  │  │  │ AI Engine │ │ Knowledge │ │                           ││
│  │  │  │ (Planner) │ │   Base    │ │                           ││
│  │  │  └───────────┘ └───────────┘ │                           ││
│  │  │  ┌───────────┐ ┌───────────┐ │                           ││
│  │  │  │  Session  │ │  Profile  │ │                           ││
│  │  │  │  Manager  │ │  Manager  │ │                           ││
│  │  │  └───────────┘ └───────────┘ │                           ││
│  │  │  ┌───────────┐ ┌───────────┐ │                           ││
│  │  │  │   Task    │ │  Audit    │ │                           ││
│  │  │  │ Scheduler │ │   Log     │ │                           ││
│  │  │  └───────────┘ └───────────┘ │                           ││
│  │  └──────────────────────────────┘                           ││
│  │                    │                                         ││
│  │  ┌─────────────────┴─────────────────┐                      ││
│  │  │         数据持久层                  │                      ││
│  │  │  SQLite (社区版) / PostgreSQL (云版) │                     ││
│  │  └───────────────────────────────────┘                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │ WSS                              │
└──────────────────────────────┼──────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Agent 层 (多实例)                           │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │   Agent A     │  │   Agent B     │  │   Agent C     │        │
│  │  (prod-01)    │  │  (prod-02)    │  │  (staging)    │        │
│  │               │  │               │  │               │        │
│  │ · 环境探测     │  │ · 环境探测     │  │ · 环境探测     │        │
│  │ · 命令执行     │  │ · 命令执行     │  │ · 命令执行     │        │
│  │ · 状态汇报     │  │ · 状态汇报     │  │ · 状态汇报     │        │
│  │ · 快照回滚     │  │ · 快照回滚     │  │ · 快照回滚     │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  表现层 (Presentation Layer)                                     │
│  · React Dashboard (Web UI)                                     │
│  · Agent CLI (Terminal UI)                                      │
├─────────────────────────────────────────────────────────────────┤
│  接口层 (Interface Layer)                                        │
│  · REST API (Hono)                                              │
│  · WebSocket Gateway (ws)                                       │
│  · 消息协议 (JSON + Zod validation)                              │
├─────────────────────────────────────────────────────────────────┤
│  业务逻辑层 (Business Layer)                                      │
│  · AI Engine (对话/规划/诊断)                                     │
│  · Session Manager (会话管理)                                    │
│  · Profile Manager (服务器档案)                                   │
│  · Task Scheduler (任务调度)                                     │
│  · Knowledge Base (知识库 RAG)                                   │
│  · Security Auditor (安全审计)                                   │
├─────────────────────────────────────────────────────────────────┤
│  数据访问层 (Data Access Layer)                                   │
│  · Repository Pattern                                           │
│  · SQLite / PostgreSQL                                          │
├─────────────────────────────────────────────────────────────────┤
│  基础设施层 (Infrastructure Layer)                                │
│  · Logger (Pino)                                                │
│  · Config Management                                            │
│  · Error Handling                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 数据流设计

#### 对话运维流程

```
用户输入 "安装 Redis"
    │
    ▼
┌─────────────────┐
│  Web Dashboard   │
└────────┬────────┘
         │ POST /api/v1/chat
         ▼
┌─────────────────┐     ┌─────────────────┐
│   REST API      │────▶│  Session Mgr    │ 创建/获取会话
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Profile Mgr    │────▶│ 获取服务器档案    │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Knowledge Base  │────▶│ RAG 知识检索     │
└────────┬────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│   AI Engine     │
│  ┌───────────┐  │
│  │  Planner  │  │────▶ 生成执行计划 (JSON)
│  └───────────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Security Check  │────▶ 命令分级 + 参数审计
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  用户确认执行?   │
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Task Executor  │────▶│  WSS Gateway    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │              ┌────────▼────────┐
         │              │     Agent       │
         │              │  ┌───────────┐  │
         │              │  │ Snapshot  │  │ 创建快照
         │              │  └───────────┘  │
         │              │  ┌───────────┐  │
         │              │  │ Executor  │  │ 执行命令
         │              │  └───────────┘  │
         │              └────────┬────────┘
         │                       │ 实时输出流
         ▼◀──────────────────────┘
┌─────────────────┐
│  结果展示        │
└─────────────────┘
```

---

## 3. 技术栈选型

### 3.1 后端技术栈

| 层次 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **运行时** | Node.js | >= 22.0.0 | 成熟稳定，生态丰富 |
| **语言** | TypeScript | ^5.7.0 | 类型安全，开发效率高 |
| **Web 框架** | Hono | ^4.7.0 | 轻量高性能，兼容多运行时 |
| **WebSocket** | ws | ^8.18.0 | 最成熟的 Node.js WS 库 |
| **数据验证** | Zod | ^3.25.0 | 运行时类型校验，与 TS 无缝集成 |
| **日志** | Pino | ^10.3.0 | 高性能结构化日志 |
| **数据库** | better-sqlite3 | ^11.8.1 | 社区版零配置 SQLite |
| **ORM** | Drizzle ORM | ^0.38.0 | 类型安全，轻量高性能 |
| **AI SDK** | @anthropic-ai/sdk | ^0.39.0 | Claude 官方 SDK |

### 3.2 Agent 技术栈

| 组件 | 技术 | 选型理由 |
|------|------|---------|
| **运行时** | Bun | 可编译为单一二进制文件 |
| **CLI UI** | @clack/prompts | 现代化交互式 CLI |
| **进度条** | osc-progress | 终端进度展示 |
| **颜色** | chalk | 终端颜色输出 |
| **WebSocket** | ws | 与 Server 保持一致 |

### 3.3 前端技术栈

| 组件 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **框架** | React | 18.x | 生态成熟，组件丰富 |
| **构建** | Vite | 5.x | 快速开发体验 |
| **路由** | React Router | 6.x | 标准路由方案 |
| **状态管理** | Zustand | 5.x | 轻量简洁 |
| **UI 组件** | Shadcn/ui | - | 可定制，无运行时依赖 |
| **样式** | Tailwind CSS | 3.x | 响应式设计，快速开发 |
| **图表** | Recharts | 2.x | React 原生图表库 |
| **WebSocket** | 原生 API | - | 无需额外依赖 |

### 3.4 基础设施

| 组件 | 技术 | 用途 |
|------|------|------|
| **容器化** | Docker + Compose | 一键部署 |
| **CI/CD** | GitHub Actions | 自动化测试和发布 |
| **云部署** | Fly.io | 边缘部署，低延迟 |
| **反向代理** | Nginx | SSL 终止，负载均衡 |
| **测试框架** | Vitest | 单元/集成测试 |
| **E2E 测试** | Playwright | 端到端测试 |

### 3.5 Monorepo 结构

```
ServerPilot/
├── packages/
│   ├── server/           # 服务端代码
│   │   ├── src/
│   │   │   ├── api/      # REST API + WebSocket
│   │   │   ├── ai/       # AI 引擎
│   │   │   ├── knowledge/ # 知识库
│   │   │   ├── core/     # 核心业务逻辑
│   │   │   ├── db/       # 数据库访问层
│   │   │   └── utils/    # 工具函数
│   │   └── package.json
│   │
│   ├── agent/            # 客户端代码
│   │   ├── src/
│   │   │   ├── detect/   # 环境探测
│   │   │   ├── execute/  # 命令执行
│   │   │   ├── client/   # WebSocket 客户端
│   │   │   └── ui/       # CLI 界面
│   │   └── package.json
│   │
│   ├── dashboard/        # Web 前端 (待开发)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── stores/
│   │   │   └── api/
│   │   └── package.json
│   │
│   └── shared/           # 共享协议和类型
│       ├── src/
│       │   ├── protocol/ # 消息协议定义
│       │   └── types/    # 共享类型
│       └── package.json
│
├── knowledge-base/       # 内置知识库
│   ├── nginx/
│   ├── mysql/
│   ├── docker/
│   └── ...
│
├── scripts/              # 构建和部署脚本
├── docker/               # Docker 配置
├── docs/                 # 文档
├── pnpm-workspace.yaml
└── package.json
```

---

## 4. 核心模块设计

### 4.1 Server 模块架构

```
packages/server/src/
├── index.ts                    # 入口文件
│
├── api/                        # 接口层
│   ├── server.ts              # WebSocket 服务器核心
│   ├── handlers.ts            # 消息处理器路由
│   ├── routes/                # REST API 路由
│   │   ├── auth.ts           # 认证相关
│   │   ├── servers.ts        # 服务器管理
│   │   ├── chat.ts           # AI 对话
│   │   ├── tasks.ts          # 任务管理
│   │   └── profile.ts        # 档案管理
│   ├── middleware/            # 中间件
│   │   ├── auth.ts           # JWT 认证
│   │   ├── rate-limit.ts     # 限流
│   │   └── error.ts          # 错误处理
│   └── websocket/             # WebSocket 处理
│       ├── connection.ts     # 连接管理
│       ├── auth-handler.ts   # 认证处理
│       └── message-router.ts # 消息路由
│
├── ai/                         # AI 引擎 (已实现)
│   ├── agent.ts               # AI Agent 主类 ✅
│   ├── planner.ts             # 安装计划生成器 ✅
│   ├── error-analyzer.ts      # 错误诊断器 ✅
│   ├── prompts.ts             # System Prompt 模板 ✅
│   ├── streaming.ts           # 流式响应 ✅
│   ├── fault-tolerance.ts     # 容错降级 ✅
│   └── providers/             # AI Provider 抽象
│       ├── base.ts           # 基础接口
│       ├── claude.ts         # Claude 实现 ✅
│       ├── openai.ts         # OpenAI 实现 (待完善)
│       ├── deepseek.ts       # DeepSeek 实现 (待开发)
│       └── ollama.ts         # Ollama 实现 (待开发)
│
├── knowledge/                  # 知识库模块 (已实现)
│   ├── loader.ts              # 知识库加载器 ✅
│   ├── vectordb.ts            # 向量数据库 ✅
│   ├── text-chunker.ts        # 文本分块 ✅
│   ├── context-enhancer.ts    # 上下文增强 ✅
│   ├── scraper.ts             # 文档抓取 ✅
│   └── auto-learn.ts          # 自动学习 (待开发)
│
├── core/                       # 核心业务逻辑 (待开发)
│   ├── session/               # 会话管理
│   │   ├── manager.ts        # 会话管理器
│   │   ├── context.ts        # 对话上下文
│   │   └── history.ts        # 历史记录
│   ├── profile/               # 服务器档案
│   │   ├── manager.ts        # 档案管理器
│   │   ├── aggregator.ts     # 数据聚合
│   │   └── updater.ts        # 增量更新
│   ├── task/                  # 任务管理
│   │   ├── scheduler.ts      # 任务调度器
│   │   ├── executor.ts       # 任务执行器
│   │   └── cron.ts           # 定时任务
│   └── security/              # 安全模块
│       ├── command-classifier.ts  # 命令分级
│       ├── param-auditor.ts       # 参数审计
│       └── snapshot.ts            # 快照管理
│
├── db/                         # 数据访问层 (待开发)
│   ├── schema.ts              # Drizzle Schema
│   ├── migrations/            # 数据库迁移
│   └── repositories/          # Repository 模式
│       ├── server.ts
│       ├── profile.ts
│       ├── operation.ts
│       └── task.ts
│
└── utils/                      # 工具函数 (已实现)
    ├── logger.ts              # 日志 ✅
    ├── config.ts              # 配置管理
    └── error.ts               # 错误处理
```

### 4.2 Agent 模块架构

```
packages/agent/src/
├── index.ts                    # CLI 入口 ✅
├── client.ts                   # WebSocket 客户端 ✅
├── authenticated-client.ts     # 带认证的客户端 ✅
│
├── detect/                     # 环境探测 (已实现)
│   ├── index.ts               # 聚合探测入口 ✅
│   ├── os.ts                  # 操作系统检测 ✅
│   ├── runtime.ts             # 运行时检测 ✅
│   ├── package-managers.ts    # 包管理器发现 ✅
│   ├── network.ts             # 网络连通性 ✅
│   ├── device-fingerprint.ts  # 设备指纹 ✅
│   ├── services.ts            # 服务发现 (待开发)
│   └── ports.ts               # 端口扫描 (待开发)
│
├── execute/                    # 命令执行 (已实现)
│   ├── executor.ts            # 命令执行器 ✅
│   ├── sandbox.ts             # 沙箱隔离 ✅
│   ├── snapshot.ts            # 操作快照 ✅
│   └── error-collector.ts     # 错误收集 ✅
│
├── security/                   # 安全模块 (待开发)
│   ├── command-validator.ts   # 命令验证
│   ├── whitelist.ts           # 白名单管理
│   └── audit-log.ts           # 审计日志
│
└── ui/                         # CLI 界面 (已实现)
    ├── progress.ts            # 进度条 ✅
    ├── prompt.ts              # 交互确认 ✅
    ├── table.ts               # 表格输出 ✅
    └── colors.ts              # 颜色方案 ✅
```

### 4.3 Dashboard 模块架构 (待开发)

```
packages/dashboard/src/
├── main.tsx                    # 入口
├── App.tsx                     # 根组件
│
├── components/                 # 组件库
│   ├── ui/                    # 基础 UI 组件 (Shadcn)
│   ├── layout/                # 布局组件
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── MainLayout.tsx
│   ├── server/                # 服务器相关
│   │   ├── ServerList.tsx
│   │   ├── ServerCard.tsx
│   │   └── ServerDetail.tsx
│   ├── chat/                  # 对话组件
│   │   ├── ChatPanel.tsx
│   │   ├── MessageList.tsx
│   │   ├── PlanPreview.tsx
│   │   └── ExecutionLog.tsx
│   ├── monitor/               # 监控组件
│   │   ├── MetricsChart.tsx
│   │   ├── ServiceStatus.tsx
│   │   └── AlertList.tsx
│   └── common/                # 通用组件
│       ├── Loading.tsx
│       ├── ErrorBoundary.tsx
│       └── Modal.tsx
│
├── pages/                      # 页面
│   ├── Login.tsx
│   ├── Dashboard.tsx          # 总览
│   ├── Servers.tsx            # 服务器列表
│   ├── ServerDetail.tsx       # 服务器详情
│   ├── Chat.tsx               # AI 对话
│   ├── Tasks.tsx              # 任务管理
│   ├── Operations.tsx         # 操作记录
│   └── Settings.tsx           # 设置
│
├── stores/                     # 状态管理 (Zustand)
│   ├── auth.ts                # 认证状态
│   ├── servers.ts             # 服务器列表
│   ├── chat.ts                # 对话状态
│   └── ui.ts                  # UI 状态
│
├── api/                        # API 客户端
│   ├── client.ts              # HTTP 客户端
│   ├── websocket.ts           # WebSocket 客户端
│   └── hooks/                 # React Query hooks
│       ├── useServers.ts
│       ├── useChat.ts
│       └── useProfile.ts
│
└── utils/                      # 工具函数
    ├── format.ts              # 格式化
    └── constants.ts           # 常量
```

---

## 5. 数据库设计

### 5.1 ER 图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   users     │     │   servers   │     │   agents    │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ id (PK)     │     │ id (PK)     │     │ id (PK)     │
│ email       │     │ name        │     │ server_id   │
│ password    │     │ user_id (FK)│◄────│ key_hash    │
│ created_at  │     │ status      │     │ version     │
│ updated_at  │     │ created_at  │     │ last_seen   │
└─────────────┘     └─────────────┘     │ created_at  │
      │                   │             └─────────────┘
      │                   │
      │                   ▼
      │             ┌─────────────┐
      │             │  profiles   │
      │             ├─────────────┤
      │             │ id (PK)     │
      │             │ server_id   │
      │             │ os_info     │ (JSON)
      │             │ software    │ (JSON)
      │             │ services    │ (JSON)
      │             │ preferences │ (JSON)
      │             │ notes       │ (JSON)
      │             │ history     │ (JSON)
      │             │ updated_at  │
      │             └─────────────┘
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  sessions   │     │ operations  │     │   tasks     │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ id (PK)     │     │ id (PK)     │     │ id (PK)     │
│ user_id(FK) │     │ server_id   │     │ server_id   │
│ server_id   │     │ session_id  │     │ user_id     │
│ messages    │(JSON)│ type        │     │ name        │
│ context     │(JSON)│ command     │     │ cron        │
│ created_at  │     │ output      │     │ command     │
│ updated_at  │     │ status      │     │ status      │
└─────────────┘     │ risk_level  │     │ last_run    │
                    │ snapshot_id │     │ next_run    │
                    │ created_at  │     │ created_at  │
                    └─────────────┘     └─────────────┘

┌─────────────┐     ┌─────────────┐
│  snapshots  │     │   alerts    │
├─────────────┤     ├─────────────┤
│ id (PK)     │     │ id (PK)     │
│ server_id   │     │ server_id   │
│ operation_id│     │ type        │
│ files       │(JSON)│ severity   │
│ configs     │(JSON)│ message    │
│ created_at  │     │ resolved    │
│ expires_at  │     │ created_at  │
└─────────────┘     └─────────────┘
```

### 5.2 Schema 定义 (Drizzle ORM)

```typescript
// packages/server/src/db/schema.ts

import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';

// 用户表
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  timezone: text('timezone').default('UTC'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 服务器表
export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  status: text('status', { enum: ['online', 'offline', 'error'] }).default('offline'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Agent 表
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  keyHash: text('key_hash').notNull(),
  version: text('version'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 服务器档案表
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull().unique(),
  osInfo: text('os_info', { mode: 'json' }).$type<OsInfo>(),
  software: text('software', { mode: 'json' }).$type<Software[]>().default([]),
  services: text('services', { mode: 'json' }).$type<Service[]>().default([]),
  preferences: text('preferences', { mode: 'json' }).$type<Preferences>(),
  notes: text('notes', { mode: 'json' }).$type<string[]>().default([]),
  operationHistory: text('operation_history', { mode: 'json' }).$type<string[]>().default([]),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 对话会话表
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  messages: text('messages', { mode: 'json' }).$type<Message[]>().default([]),
  context: text('context', { mode: 'json' }).$type<SessionContext>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// 操作记录表
export const operations = sqliteTable('operations', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  sessionId: text('session_id').references(() => sessions.id),
  userId: text('user_id').references(() => users.id).notNull(),
  type: text('type', { enum: ['install', 'config', 'restart', 'execute', 'backup'] }).notNull(),
  description: text('description').notNull(),
  commands: text('commands', { mode: 'json' }).$type<string[]>().default([]),
  output: text('output'),
  status: text('status', { enum: ['pending', 'running', 'success', 'failed', 'rolled_back'] }).default('pending'),
  riskLevel: text('risk_level', { enum: ['green', 'yellow', 'red', 'critical'] }).default('green'),
  snapshotId: text('snapshot_id').references(() => snapshots.id),
  duration: integer('duration'), // 毫秒
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// 快照表
export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  operationId: text('operation_id'),
  files: text('files', { mode: 'json' }).$type<SnapshotFile[]>().default([]),
  configs: text('configs', { mode: 'json' }).$type<SnapshotConfig[]>().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
});

// 定时任务表
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  cron: text('cron').notNull(), // cron 表达式
  command: text('command').notNull(),
  status: text('status', { enum: ['active', 'paused', 'deleted'] }).default('active'),
  lastRun: integer('last_run', { mode: 'timestamp' }),
  lastStatus: text('last_status', { enum: ['success', 'failed'] }),
  nextRun: integer('next_run', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 告警表
export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  serverId: text('server_id').references(() => servers.id).notNull(),
  type: text('type', { enum: ['cpu', 'memory', 'disk', 'service', 'offline'] }).notNull(),
  severity: text('severity', { enum: ['info', 'warning', 'critical'] }).notNull(),
  message: text('message').notNull(),
  value: text('value'), // 触发值
  threshold: text('threshold'), // 阈值
  resolved: integer('resolved', { mode: 'boolean' }).default(false),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// 知识库缓存表
export const knowledgeCache = sqliteTable('knowledge_cache', {
  id: text('id').primaryKey(),
  software: text('software').notNull(),
  platform: text('platform').notNull(),
  content: text('content', { mode: 'json' }).$type<KnowledgeEntry>().notNull(),
  source: text('source', { enum: ['builtin', 'auto_learn', 'scrape', 'community'] }).notNull(),
  successCount: integer('success_count').default(0),
  lastUsed: integer('last_used', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

### 5.3 类型定义

```typescript
// packages/shared/src/types/database.ts

export interface OsInfo {
  platform: string;
  arch: string;
  version: string;
  kernel: string;
  hostname: string;
  uptime: number;
}

export interface Software {
  name: string;
  version: string;
  configPath?: string;
  dataPath?: string;
  ports?: number[];
}

export interface Service {
  name: string;
  status: 'running' | 'stopped' | 'failed';
  ports: number[];
  manager?: 'systemd' | 'pm2' | 'docker';
  uptime?: string;
}

export interface Preferences {
  packageManager?: 'apt' | 'yum' | 'brew' | 'apk';
  deploymentStyle?: 'docker' | 'bare-metal' | 'pm2';
  backupLocation?: string;
  logLocation?: string;
  preferredEditor?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  plan?: ExecutionPlan;
}

export interface SessionContext {
  serverId: string;
  profileSnapshot: string; // 压缩后的档案
  tokenCount: number;
  summarized: boolean;
}

export interface SnapshotFile {
  path: string;
  content: string;
  mode: number;
  owner: string;
}

export interface SnapshotConfig {
  type: 'nginx' | 'mysql' | 'redis' | 'crontab' | 'other';
  path: string;
  content: string;
}

export interface KnowledgeEntry {
  commands: string[];
  verification?: string;
  notes?: string[];
  platform?: string;
}
```

---

## 6. API 设计

### 6.1 REST API 规范

基础 URL: `/api/v1`

认证方式: JWT Bearer Token

#### 认证接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /auth/login | 用户登录 |
| POST | /auth/register | 用户注册 |
| POST | /auth/refresh | 刷新 Token |
| POST | /auth/logout | 登出 |

#### 服务器管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /servers | 获取服务器列表 |
| POST | /servers | 添加服务器 (生成 Agent 安装令牌) |
| GET | /servers/:id | 获取服务器详情 |
| PATCH | /servers/:id | 更新服务器信息 |
| DELETE | /servers/:id | 删除服务器 |
| GET | /servers/:id/profile | 获取服务器档案 |
| GET | /servers/:id/metrics | 获取监控指标 |
| GET | /servers/:id/operations | 获取操作记录 |

#### AI 对话

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /chat/:serverId | 发送对话消息 |
| GET | /chat/:serverId/sessions | 获取会话列表 |
| GET | /chat/:serverId/sessions/:sessionId | 获取会话详情 |
| DELETE | /chat/:serverId/sessions/:sessionId | 删除会话 |

#### 任务管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /tasks | 获取定时任务列表 |
| POST | /tasks | 创建定时任务 |
| GET | /tasks/:id | 获取任务详情 |
| PATCH | /tasks/:id | 更新任务 |
| DELETE | /tasks/:id | 删除任务 |
| POST | /tasks/:id/run | 立即执行任务 |

#### 告警管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /alerts | 获取告警列表 |
| PATCH | /alerts/:id/resolve | 标记告警已解决 |

### 6.2 API 详细定义

#### POST /api/v1/chat/:serverId

发送对话消息，AI 生成执行计划。

**请求体:**
```json
{
  "message": "帮我安装 Redis 并配置为主从复制",
  "sessionId": "session-uuid" // 可选，不传则创建新会话
}
```

**响应体 (SSE 流式):**
```json
// 事件: plan
{
  "type": "plan",
  "data": {
    "planId": "plan-uuid",
    "description": "安装 Redis 并配置主从复制",
    "steps": [
      {
        "id": "step-1",
        "command": "apt update",
        "description": "更新软件源",
        "risk": "green",
        "rollback": null
      },
      {
        "id": "step-2",
        "command": "apt install redis-server -y",
        "description": "安装 Redis",
        "risk": "yellow",
        "rollback": "apt remove redis-server -y"
      }
    ],
    "totalRisk": "yellow",
    "requiresConfirmation": true
  }
}

// 事件: message
{
  "type": "message",
  "data": {
    "content": "我检测到你的服务器是 Ubuntu 22.04，已为你生成安装计划..."
  }
}
```

#### POST /api/v1/chat/:serverId/execute

执行已确认的计划。

**请求体:**
```json
{
  "planId": "plan-uuid",
  "sessionId": "session-uuid"
}
```

**响应体 (SSE 流式):**
```json
// 事件: step_start
{
  "type": "step_start",
  "data": {
    "stepId": "step-1",
    "command": "apt update"
  }
}

// 事件: output
{
  "type": "output",
  "data": {
    "stepId": "step-1",
    "content": "Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease\n..."
  }
}

// 事件: step_complete
{
  "type": "step_complete",
  "data": {
    "stepId": "step-1",
    "exitCode": 0,
    "duration": 3500
  }
}

// 事件: complete
{
  "type": "complete",
  "data": {
    "success": true,
    "operationId": "op-uuid",
    "snapshotId": "snap-uuid"
  }
}
```

### 6.3 错误响应格式

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数验证失败",
    "details": [
      {
        "field": "serverId",
        "message": "服务器 ID 格式不正确"
      }
    ]
  }
}
```

**错误码列表:**

| 错误码 | HTTP 状态 | 描述 |
|--------|----------|------|
| UNAUTHORIZED | 401 | 未认证 |
| FORBIDDEN | 403 | 无权限 |
| NOT_FOUND | 404 | 资源不存在 |
| VALIDATION_ERROR | 400 | 参数验证失败 |
| SERVER_OFFLINE | 503 | 目标服务器离线 |
| AI_UNAVAILABLE | 503 | AI 服务不可用 |
| RATE_LIMITED | 429 | 请求过于频繁 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

---

## 7. 通信协议设计

### 7.1 WebSocket 消息格式

```typescript
// packages/shared/src/protocol/messages.ts

interface BaseMessage {
  id: string;           // UUID v4
  type: string;         // 消息类型
  timestamp: number;    // Unix 毫秒时间戳
}

interface RequestMessage extends BaseMessage {
  payload: unknown;
}

interface ResponseMessage extends BaseMessage {
  requestId?: string;   // 关联的请求 ID
  payload: unknown;
}
```

### 7.2 消息类型定义

#### Server → Agent

```typescript
// 认证挑战
interface AuthChallenge {
  type: 'auth.challenge';
  payload: {
    nonce: string;      // 随机字符串
    serverVersion: string;
  };
}

// 执行命令
interface CommandExecute {
  type: 'command.execute';
  payload: {
    commandId: string;
    command: string;
    timeout: number;    // 毫秒
    workingDir?: string;
    env?: Record<string, string>;
    riskLevel: 'green' | 'yellow' | 'red' | 'critical';
  };
}

// 取消命令
interface CommandCancel {
  type: 'command.cancel';
  payload: {
    commandId: string;
  };
}

// 请求环境信息
interface EnvRequest {
  type: 'env.request';
  payload: {
    full?: boolean;     // 是否全量
  };
}

// 通知升级
interface AgentUpgrade {
  type: 'agent.upgrade';
  payload: {
    version: string;
    downloadUrl: string;
    signature: string;
    changelog?: string;
  };
}
```

#### Agent → Server

```typescript
// 认证响应
interface AuthResponse {
  type: 'auth.response';
  payload: {
    agentId: string;
    signature: string;  // HMAC(nonce, secretKey)
    agentVersion: string;
  };
}

// 环境信息上报
interface EnvReport {
  type: 'env.report';
  payload: {
    full: boolean;
    data: EnvironmentInfo;
  };
}

// 命令输出 (流式)
interface CommandOutput {
  type: 'command.output';
  payload: {
    commandId: string;
    stream: 'stdout' | 'stderr';
    data: string;
  };
}

// 命令结果
interface CommandResult {
  type: 'command.result';
  payload: {
    commandId: string;
    exitCode: number;
    duration: number;   // 毫秒
    error?: string;
  };
}

// 心跳
interface Heartbeat {
  type: 'heartbeat';
  payload: {
    uptime: number;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  };
}

// 监控指标上报
interface MetricsReport {
  type: 'metrics.report';
  payload: {
    cpu: CpuMetrics;
    memory: MemoryMetrics;
    disk: DiskMetrics[];
    network: NetworkMetrics;
  };
}
```

#### 双向消息

```typescript
// 消息确认
interface Ack {
  type: 'ack';
  payload: {
    messageId: string;
  };
}

// 错误通知
interface Error {
  type: 'error';
  payload: {
    code: string;
    message: string;
    relatedMessageId?: string;
  };
}
```

### 7.3 认证握手流程

```
Agent                              Server
  │                                  │
  ├── WSS 连接 ──────────────────────►│
  │                                  │
  │◄──── auth.challenge ─────────────┤
  │      {nonce, serverVersion}      │
  │                                  │
  ├── auth.response ─────────────────►│
  │    {agentId, signature, version} │
  │    signature = HMAC-SHA256(      │
  │      nonce + timestamp,          │
  │      agentSecretKey              │
  │    )                             │
  │                                  │
  │    Server 验证:                   │
  │    1. 查询 agentId 对应的 keyHash │
  │    2. 计算 HMAC 并对比 signature  │
  │    3. 验证 timestamp 在 5 分钟内  │
  │                                  │
  │◄──── auth.success ───────────────┤
  │      {protocolVersion, config}   │
  │                                  │
  ├── env.report (完整环境快照) ──────►│
  │                                  │
  │    连接建立，开始正常通信            │
```

### 7.4 消息可靠性保证

```typescript
// 消息确认机制
class MessageQueue {
  private pending = new Map<string, PendingMessage>();

  async send(message: RequestMessage): Promise<void> {
    const pending = {
      message,
      retries: 0,
      timeout: setTimeout(() => this.retry(message.id), 5000)
    };
    this.pending.set(message.id, pending);
    await this.ws.send(JSON.stringify(message));
  }

  onAck(messageId: string): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(messageId);
    }
  }

  private retry(messageId: string): void {
    const pending = this.pending.get(messageId);
    if (!pending) return;

    if (pending.retries >= 3) {
      this.pending.delete(messageId);
      this.onMessageFailed(pending.message);
      return;
    }

    pending.retries++;
    pending.timeout = setTimeout(() => this.retry(messageId), 5000);
    this.ws.send(JSON.stringify(pending.message));
  }
}
```

---

## 8. 安全架构

### 8.1 五层纵深防御

```
┌─────────────────────────────────────────────────────────────────┐
│  第一层: 命令分级制度 (Agent 端)                                  │
│  · 所有命令按风险分为 5 个级别                                    │
│  · 不同级别不同执行策略                                          │
├─────────────────────────────────────────────────────────────────┤
│  第二层: 参数安全审计 (Agent 端)                                  │
│  · 危险参数黑名单                                                │
│  · 危险路径保护                                                  │
│  · 命令语义分析                                                  │
├─────────────────────────────────────────────────────────────────┤
│  第三层: 操作前快照与回滚 (Agent 端)                              │
│  · 自动创建配置/数据快照                                         │
│  · 一键回滚能力                                                  │
├─────────────────────────────────────────────────────────────────┤
│  第四层: 紧急制动 (Server 端 + Dashboard)                        │
│  · Kill Switch 一键停止                                         │
│  · 操作超时自动终止                                              │
│  · 异常行为检测                                                  │
├─────────────────────────────────────────────────────────────────┤
│  第五层: 审计与可追溯 (全链路)                                    │
│  · 不可篡改的操作日志                                            │
│  · 完整操作回放                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 命令分级制度

```typescript
// packages/agent/src/security/command-classifier.ts

export enum RiskLevel {
  GREEN = 'green',       // 只读，自动执行
  YELLOW = 'yellow',     // 安装级，需用户确认
  RED = 'red',           // 修改级，需确认+显示影响
  CRITICAL = 'critical', // 破坏级，需确认+密码+快照
  FORBIDDEN = 'forbidden' // 绝对禁止
}

export const COMMAND_WHITELIST: Record<RiskLevel, RegExp[]> = {
  [RiskLevel.GREEN]: [
    /^ls\s/,
    /^cat\s/,
    /^head\s/,
    /^tail\s/,
    /^df\s/,
    /^free\s/,
    /^top\s/,
    /^ps\s/,
    /^systemctl\s+status\s/,
    /^docker\s+ps/,
    /^docker\s+images/,
    /^nginx\s+-t/,
    /^uname/,
    /^uptime/,
    /^whoami/,
    /^hostname/,
  ],
  [RiskLevel.YELLOW]: [
    /^apt\s+install\s/,
    /^apt\s+update/,
    /^npm\s+install\s/,
    /^pip\s+install\s/,
    /^docker\s+pull\s/,
    /^git\s+clone\s/,
    /^curl\s+-[^|]+$/,  // 不含管道的 curl
    /^wget\s/,
  ],
  [RiskLevel.RED]: [
    /^systemctl\s+(restart|stop|start)\s/,
    /^service\s+(restart|stop|start)\s/,
    /^nginx\s+-s\s+reload/,
    /^docker\s+(stop|restart)\s/,
    /^chmod\s/,
    /^chown\s/,
  ],
  [RiskLevel.CRITICAL]: [
    /^rm\s/,
    /^apt\s+(remove|purge)\s/,
    /^docker\s+rm\s/,
    /^DROP\s+(DATABASE|TABLE)/i,
    /^TRUNCATE\s/i,
  ],
  [RiskLevel.FORBIDDEN]: [
    /^rm\s+-rf\s+\//,
    /^mkfs\s/,
    /^fdisk\s/,
    /^dd\s+if=\/dev\/zero/,
    /:\(\)\{\s*:\|:&\s*\};:/,  // fork bomb
    />\s*\/dev\/sd/,
    /^chmod\s+-R\s+777\s+\//,
  ]
};

export function classifyCommand(command: string): RiskLevel {
  const trimmed = command.trim();

  // 先检查禁止列表
  for (const pattern of COMMAND_WHITELIST[RiskLevel.FORBIDDEN]) {
    if (pattern.test(trimmed)) {
      return RiskLevel.FORBIDDEN;
    }
  }

  // 按风险从低到高匹配
  for (const level of [RiskLevel.GREEN, RiskLevel.YELLOW, RiskLevel.RED, RiskLevel.CRITICAL]) {
    for (const pattern of COMMAND_WHITELIST[level]) {
      if (pattern.test(trimmed)) {
        return level;
      }
    }
  }

  // 未知命令默认为 RED
  return RiskLevel.RED;
}
```

### 8.3 参数安全审计

```typescript
// packages/agent/src/security/param-auditor.ts

export const DANGEROUS_PARAMS = [
  '--purge',
  '--force',
  '--no-preserve-root',
  '-rf',
  '--hard',
  '--no-verify',
];

export const PROTECTED_PATHS = [
  '/etc',
  '/boot',
  '/usr',
  '/var/lib/mysql',
  '/var/lib/postgresql',
  '/root',
];

export interface AuditResult {
  safe: boolean;
  warnings: string[];
  blockers: string[];
}

export function auditCommand(command: string): AuditResult {
  const result: AuditResult = {
    safe: true,
    warnings: [],
    blockers: [],
  };

  // 检查危险参数
  for (const param of DANGEROUS_PARAMS) {
    if (command.includes(param)) {
      result.warnings.push(`包含危险参数: ${param}`);
    }
  }

  // 检查保护路径
  for (const path of PROTECTED_PATHS) {
    if (command.includes(path)) {
      const isDestructive = /rm|delete|truncate|drop/i.test(command);
      if (isDestructive) {
        result.blockers.push(`对保护路径 ${path} 的破坏性操作需要额外确认`);
        result.safe = false;
      } else {
        result.warnings.push(`操作涉及保护路径: ${path}`);
      }
    }
  }

  return result;
}
```

### 8.4 Agent 权限模型

```bash
# /etc/sudoers.d/serverpilot

# 只读级: 无需 sudo
# ls, cat, df, free 等由 serverpilot 用户直接执行

# 安装级: sudo 免密码
serverpilot ALL=(root) NOPASSWD: /usr/bin/apt update
serverpilot ALL=(root) NOPASSWD: /usr/bin/apt install *
serverpilot ALL=(root) NOPASSWD: /usr/bin/systemctl status *

# 修改级: sudo 免密码 (但需要 Server 授权令牌)
serverpilot ALL=(root) NOPASSWD: /usr/bin/systemctl restart *
serverpilot ALL=(root) NOPASSWD: /usr/bin/systemctl stop *
serverpilot ALL=(root) NOPASSWD: /usr/bin/systemctl start *

# 破坏级: 通过 Agent 内部逻辑控制 (用户确认 + 快照)
```

---

## 9. AI 引擎设计

### 9.1 AI Provider 抽象层

```typescript
// packages/server/src/ai/providers/base.ts

export interface AIProvider {
  readonly name: string;
  readonly tier: 1 | 2 | 3;  // 模型能力等级

  chat(options: ChatOptions): Promise<ChatResponse>;
  stream(options: ChatOptions, callbacks: StreamCallbacks): Promise<void>;
  diagnose(error: ErrorContext): Promise<DiagnosisResult>;
}

export interface ChatOptions {
  messages: Message[];
  serverProfile: ServerProfile;
  knowledgeContext?: string;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  plan?: ExecutionPlan;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onPlan: (plan: ExecutionPlan) => void;
  onComplete: (response: ChatResponse) => void;
  onError: (error: Error) => void;
}
```

### 9.2 Claude Provider 实现

```typescript
// packages/server/src/ai/providers/claude.ts

import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, ChatOptions, ChatResponse } from './base';
import { buildSystemPrompt } from '../prompts';

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  readonly tier = 1;

  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-5-20250929') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const systemPrompt = buildSystemPrompt({
      serverProfile: options.serverProfile,
      knowledgeContext: options.knowledgeContext,
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: options.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    return {
      content,
      plan: this.extractPlan(content),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async stream(options: ChatOptions, callbacks: StreamCallbacks): Promise<void> {
    const systemPrompt = buildSystemPrompt({
      serverProfile: options.serverProfile,
      knowledgeContext: options.knowledgeContext,
    });

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: options.maxTokens || 4096,
      system: systemPrompt,
      messages: options.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    let fullContent = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        callbacks.onToken(event.delta.text);
        fullContent += event.delta.text;
      }
    }

    const finalMessage = await stream.finalMessage();
    const plan = this.extractPlan(fullContent);

    if (plan) {
      callbacks.onPlan(plan);
    }

    callbacks.onComplete({
      content: fullContent,
      plan,
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    });
  }

  private extractPlan(content: string): ExecutionPlan | undefined {
    // 从 AI 响应中提取 JSON 格式的执行计划
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
```

### 9.3 System Prompt 模板

```typescript
// packages/server/src/ai/prompts.ts

export interface PromptContext {
  serverProfile: ServerProfile;
  knowledgeContext?: string;
}

export function buildSystemPrompt(context: PromptContext): string {
  return `
# 角色定义
你是 ServerPilot AI 运维助手，帮助用户通过自然语言管理 Linux 服务器。

# 核心职责
1. 理解用户的运维意图
2. 生成安全、准确的执行计划
3. 考虑服务器的具体环境和配置
4. 标注每个操作的风险等级

# 安全规则 (必须遵守)
1. 绝对禁止生成以下命令:
   - rm -rf /
   - mkfs, fdisk (磁盘格式化)
   - dd if=/dev/zero (覆盖设备)
   - 任何 fork bomb
   - 递归删除系统目录

2. 风险分级:
   - 🟢 绿色 (只读): ls, cat, df, ps 等查询命令
   - 🟡 黄色 (安装): apt install, npm install 等
   - 🔴 红色 (修改): systemctl restart, 修改配置
   - ⛔ 紫色 (破坏): rm, DROP DATABASE 等

3. 涉及数据的操作必须先建议备份
4. 不确定的命令标注 [需验证]
5. 始终提供回滚方案

# 当前服务器信息
${formatServerProfile(context.serverProfile)}

${context.knowledgeContext ? `
# 相关知识
${context.knowledgeContext}
` : ''}

# 输出格式
当需要执行操作时，必须返回 JSON 格式的执行计划:

\`\`\`json
{
  "description": "操作描述",
  "steps": [
    {
      "id": "step-1",
      "command": "具体命令",
      "description": "步骤说明",
      "risk": "green|yellow|red|critical",
      "rollback": "回滚命令或 null"
    }
  ],
  "totalRisk": "整体风险等级",
  "estimatedTime": 秒数,
  "requiresBackup": true|false,
  "notes": ["注意事项"]
}
\`\`\`

# 交互原则
1. 用简洁清晰的中文回复
2. 主动基于服务器档案给出建议
3. 解释每个步骤的目的
4. 对高风险操作进行警告
`.trim();
}

function formatServerProfile(profile: ServerProfile): string {
  const lines = [
    `服务器: ${profile.name} (${profile.osInfo?.platform} ${profile.osInfo?.version})`,
    `架构: ${profile.osInfo?.arch}`,
    '',
    '已安装软件:',
    ...(profile.software?.map(s => `  - ${s.name} ${s.version}`) || []),
    '',
    '运行中服务:',
    ...(profile.services?.filter(s => s.status === 'running').map(s =>
      `  - ${s.name} (${s.ports.join(', ')})`
    ) || []),
  ];

  if (profile.preferences) {
    lines.push('', '用户偏好:');
    if (profile.preferences.packageManager) {
      lines.push(`  - 包管理器: ${profile.preferences.packageManager}`);
    }
    if (profile.preferences.deploymentStyle) {
      lines.push(`  - 部署方式: ${profile.preferences.deploymentStyle}`);
    }
  }

  if (profile.notes?.length) {
    lines.push('', '注意事项:');
    lines.push(...profile.notes.map(n => `  - ${n}`));
  }

  if (profile.operationHistory?.length) {
    lines.push('', '近期操作:');
    lines.push(...profile.operationHistory.slice(-5).map(h => `  - ${h}`));
  }

  return lines.join('\n');
}
```

### 9.4 AI 质量防线

```typescript
// packages/server/src/ai/quality-checker.ts

export interface QualityCheckResult {
  passed: boolean;
  issues: QualityIssue[];
  suggestions: string[];
}

export interface QualityIssue {
  type: 'command_not_found' | 'package_not_found' | 'risk_mismatch' | 'forbidden_command';
  severity: 'warning' | 'error';
  message: string;
  stepId?: string;
}

export class AIQualityChecker {
  async checkPlan(plan: ExecutionPlan, serverProfile: ServerProfile): Promise<QualityCheckResult> {
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];

    for (const step of plan.steps) {
      // 1. 命令存在性校验
      const commandExists = await this.checkCommandExists(step.command, serverProfile);
      if (!commandExists.exists) {
        issues.push({
          type: 'command_not_found',
          severity: 'error',
          message: `命令 "${commandExists.command}" 在目标系统上不存在`,
          stepId: step.id,
        });
      }

      // 2. 包名存在性校验
      if (step.command.includes('apt install')) {
        const packages = this.extractPackages(step.command);
        for (const pkg of packages) {
          const exists = await this.checkPackageExists(pkg, 'apt');
          if (!exists) {
            issues.push({
              type: 'package_not_found',
              severity: 'warning',
              message: `包 "${pkg}" 可能不存在，请验证`,
              stepId: step.id,
            });
          }
        }
      }

      // 3. 风险等级校验
      const actualRisk = classifyCommand(step.command);
      if (this.riskToNumber(actualRisk) > this.riskToNumber(step.risk)) {
        issues.push({
          type: 'risk_mismatch',
          severity: 'warning',
          message: `步骤 "${step.description}" 的风险等级应为 ${actualRisk}，而非 ${step.risk}`,
          stepId: step.id,
        });
      }

      // 4. 禁止命令检查
      if (actualRisk === RiskLevel.FORBIDDEN) {
        issues.push({
          type: 'forbidden_command',
          severity: 'error',
          message: `步骤 "${step.description}" 包含禁止执行的危险命令`,
          stepId: step.id,
        });
      }
    }

    // 5. 平台兼容性检查
    if (serverProfile.osInfo?.platform === 'ubuntu' || serverProfile.osInfo?.platform === 'debian') {
      const hasYum = plan.steps.some(s => s.command.includes('yum'));
      if (hasYum) {
        suggestions.push('检测到 yum 命令，但目标系统是 Debian/Ubuntu，应使用 apt');
      }
    }

    return {
      passed: !issues.some(i => i.severity === 'error'),
      issues,
      suggestions,
    };
  }

  private riskToNumber(risk: RiskLevel | string): number {
    const map: Record<string, number> = {
      green: 1,
      yellow: 2,
      red: 3,
      critical: 4,
      forbidden: 5,
    };
    return map[risk] || 3;
  }

  private extractPackages(command: string): string[] {
    const match = command.match(/apt\s+install\s+(-y\s+)?(.+)/);
    if (!match) return [];
    return match[2].split(/\s+/).filter(p => !p.startsWith('-'));
  }

  private async checkCommandExists(command: string, profile: ServerProfile): Promise<{ exists: boolean; command: string }> {
    const cmd = command.split(/\s+/)[0];
    // 基于服务器档案检查命令是否存在
    // 实际实现需要检查 $PATH 中的可执行文件
    return { exists: true, command: cmd };
  }

  private async checkPackageExists(pkg: string, manager: string): Promise<boolean> {
    // 实际实现需要查询包管理器索引
    return true;
  }
}
```

---

## 10. 部署方案

### 10.1 Docker Compose 配置

```yaml
# docker-compose.yml

services:
  server:
    build:
      context: .
      dockerfile: docker/server.Dockerfile
    ports:
      - "3000:3000"     # Dashboard + API
      - "3001:3001"     # WebSocket
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/data/serverpilot.db
      - JWT_SECRET=${JWT_SECRET}
      - AI_PROVIDER=${AI_PROVIDER:-claude}
      - AI_API_KEY=${AI_API_KEY}
    volumes:
      - server-data:/data
      - ./knowledge-base:/app/knowledge-base:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # 可选: 本地 Ollama
  ollama:
    image: ollama/ollama:latest
    profiles: ["ollama"]
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped

volumes:
  server-data:
  ollama-data:
```

### 10.2 Server Dockerfile

```dockerfile
# docker/server.Dockerfile

FROM node:22-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY packages/server ./packages/server
COPY packages/shared ./packages/shared

# 构建
RUN pnpm --filter @serverpilot/server build

# 生产阶段
FROM node:22-alpine

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache curl

# 复制构建产物
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/node_modules ./packages/server/node_modules

# 复制知识库
COPY knowledge-base ./knowledge-base

# 创建数据目录
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000 3001

CMD ["node", "dist/index.js"]
```

### 10.3 一键安装脚本

```bash
#!/bin/bash
# install.sh - ServerPilot 一键安装脚本

set -e

INSTALL_DIR="/opt/serverpilot"
DATA_DIR="/var/serverpilot"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════╗"
echo "║       ServerPilot 智能运维平台安装         ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 root 权限
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 root 权限运行此脚本${NC}"
    exit 1
fi

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}正在安装 Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
fi

# 检查 Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}正在安装 Docker Compose...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# 创建目录
mkdir -p "$INSTALL_DIR" "$DATA_DIR"

# 生成随机密钥
JWT_SECRET=$(openssl rand -base64 32)

# 下载配置文件
curl -fsSL https://get.serverpilot.dev/docker-compose.yml > "$INSTALL_DIR/docker-compose.yml"

# 创建环境文件
cat > "$INSTALL_DIR/.env" << EOF
JWT_SECRET=$JWT_SECRET
AI_PROVIDER=claude
AI_API_KEY=
EOF

echo -e "${YELLOW}"
echo "请选择 AI Provider:"
echo "  1) Claude (推荐)"
echo "  2) OpenAI"
echo "  3) DeepSeek"
echo "  4) Ollama (本地模型)"
echo -e "${NC}"

read -p "请输入选项 [1-4]: " ai_choice

case $ai_choice in
    1)
        echo "AI_PROVIDER=claude" >> "$INSTALL_DIR/.env"
        read -p "请输入 Claude API Key: " api_key
        echo "AI_API_KEY=$api_key" >> "$INSTALL_DIR/.env"
        ;;
    2)
        echo "AI_PROVIDER=openai" >> "$INSTALL_DIR/.env"
        read -p "请输入 OpenAI API Key: " api_key
        echo "AI_API_KEY=$api_key" >> "$INSTALL_DIR/.env"
        ;;
    3)
        echo "AI_PROVIDER=deepseek" >> "$INSTALL_DIR/.env"
        read -p "请输入 DeepSeek API Key: " api_key
        echo "AI_API_KEY=$api_key" >> "$INSTALL_DIR/.env"
        ;;
    4)
        echo "AI_PROVIDER=ollama" >> "$INSTALL_DIR/.env"
        echo "AI_API_KEY=" >> "$INSTALL_DIR/.env"
        ;;
esac

# 启动服务
cd "$INSTALL_DIR"
docker compose up -d

# 等待服务就绪
echo -e "${YELLOW}等待服务启动...${NC}"
sleep 5

# 获取初始密码
INIT_PASSWORD=$(docker compose logs server 2>&1 | grep "Initial password:" | awk '{print $NF}')

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════╗"
echo "║          ServerPilot 安装完成!             ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "  Dashboard: http://$(hostname -I | awk '{print $1}'):3000"
echo "  初始密码: $INIT_PASSWORD"
echo ""
echo "  请尽快登录并修改密码!"
echo -e "${NC}"
```

### 10.4 Agent 安装脚本

```bash
#!/bin/bash
# install-agent.sh - ServerPilot Agent 安装脚本

set -e

# 参数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --server)
            SERVER_URL="$2"
            shift 2
            ;;
        --token)
            TOKEN="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$SERVER_URL" ] || [ -z "$TOKEN" ]; then
    echo "用法: install-agent.sh --server <server_url> --token <token>"
    exit 1
fi

# 检测系统架构
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

case "$ARCH" in
    x86_64)
        ARCH="x64"
        ;;
    aarch64|arm64)
        ARCH="arm64"
        ;;
    *)
        echo "不支持的架构: $ARCH"
        exit 1
        ;;
esac

BINARY_NAME="serverpilot-agent-${OS}-${ARCH}"
DOWNLOAD_URL="https://github.com/serverpilot/serverpilot/releases/latest/download/${BINARY_NAME}"

# 下载 Agent
echo "下载 Agent..."
curl -fsSL "$DOWNLOAD_URL" -o /usr/local/bin/serverpilot-agent
chmod +x /usr/local/bin/serverpilot-agent

# 验证签名
echo "验证签名..."
curl -fsSL "${DOWNLOAD_URL}.sig" -o /tmp/agent.sig
# TODO: 实现签名验证

# 创建 systemd 服务
cat > /etc/systemd/system/serverpilot-agent.service << EOF
[Unit]
Description=ServerPilot Agent
After=network.target

[Service]
Type=simple
User=serverpilot
ExecStart=/usr/local/bin/serverpilot-agent --server $SERVER_URL
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 创建用户
useradd -r -s /bin/false serverpilot 2>/dev/null || true

# 首次连接认证
echo "连接服务器..."
/usr/local/bin/serverpilot-agent --server "$SERVER_URL" --token "$TOKEN" --register

# 启动服务
systemctl daemon-reload
systemctl enable serverpilot-agent
systemctl start serverpilot-agent

echo "Agent 安装完成!"
```

---

## 11. 开发计划与里程碑

### 11.1 整体时间线

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: MVP 核心闭环 (6 周)                                    │
│  · Week 1-2: Dashboard 基础框架 + 服务器管理                      │
│  · Week 3-4: AI 对话模块 + 服务器档案                             │
│  · Week 5-6: Agent 集成 + 命令执行 + 安全机制                      │
├─────────────────────────────────────────────────────────────────┤
│  Phase 2: 安全与体验 (4 周)                                       │
│  · Week 7-8: 快照回滚 + 完整档案 + 操作历史                        │
│  · Week 9-10: 定时任务 + 基础监控 + 告警                           │
├─────────────────────────────────────────────────────────────────┤
│  Phase 3: 开源发布 (4 周)                                         │
│  · Week 11-12: 文档完善 + CI/CD + 安装脚本                        │
│  · Week 13-14: 社区发布 + 反馈收集                                │
├─────────────────────────────────────────────────────────────────┤
│  Phase 4: 云版发布 (4 周)                                         │
│  · Week 15-16: 多租户 + 用户系统 + 计费                           │
│  · Week 17-18: 云版上线 + 商业化                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 MVP (v0.1) 详细任务

| 模块 | 任务 | 优先级 | 状态 |
|------|------|--------|------|
| **Dashboard** | React 项目初始化 | P0 | 待开发 |
| | 登录/注册页面 | P0 | 待开发 |
| | 服务器列表页 | P0 | 待开发 |
| | 服务器详情页 | P0 | 待开发 |
| | AI 对话界面 | P0 | 待开发 |
| | 执行计划预览 | P0 | 待开发 |
| | 实时执行日志 | P0 | 待开发 |
| **Server API** | REST API 路由 | P0 | 待开发 |
| | JWT 认证 | P0 | 待开发 |
| | 对话接口 (SSE) | P0 | 待开发 |
| | 执行接口 | P0 | 待开发 |
| **Server Core** | 会话管理器 | P0 | 待开发 |
| | 档案管理器 | P0 | 待开发 |
| | 任务执行器 | P0 | 待开发 |
| | 命令分级器 | P0 | 待开发 |
| **数据库** | Schema 设计 | P0 | 待开发 |
| | 迁移脚本 | P0 | 待开发 |
| | Repository 层 | P0 | 待开发 |
| **AI 引擎** | Provider 抽象 | P1 | 已实现 |
| | Claude 集成 | P0 | 已实现 |
| | OpenAI 集成 | P1 | 待完善 |
| | Ollama 集成 | P1 | 待开发 |
| | 质量检查器 | P1 | 待开发 |
| **知识库** | 知识库加载 | P0 | 已实现 |
| | RAG 检索 | P0 | 已实现 |
| | 上下文注入 | P0 | 已实现 |
| **Agent** | 环境探测 | P0 | 已实现 |
| | 命令执行 | P0 | 已实现 |
| | WSS 客户端 | P0 | 已实现 |
| | 服务发现 | P1 | 待开发 |
| | 端口扫描 | P2 | 待开发 |

### 11.3 测试策略

```
测试金字塔:

      ┌─────────┐
      │  E2E    │  ← 端到端流程 (5%)
      │(Playwright)│
      ├─────────┤
      │ 集成测试 │  ← Server ↔ Agent 通信 (25%)
      │         │
      ├─────────┤
      │ 单元测试 │  ← 核心逻辑 (70%)
      │(Vitest)  │
      └─────────┘

覆盖率目标:
  · 安全模块 (命令分级、参数审计): ≥ 95%
  · AI 质量防线: ≥ 90%
  · 通信协议: ≥ 85%
  · 整体代码: ≥ 80%
```

---

## 12. 现有模块复用分析

### 12.1 可直接复用的模块

| 模块 | 路径 | 状态 | 说明 |
|------|------|------|------|
| AI Agent | `packages/server/src/ai/agent.ts` | ✅ 完整 | Claude API 集成 |
| AI Planner | `packages/server/src/ai/planner.ts` | ✅ 完整 | 安装计划生成 |
| 错误诊断 | `packages/server/src/ai/error-analyzer.ts` | ✅ 完整 | 故障分析 |
| 容错降级 | `packages/server/src/ai/fault-tolerance.ts` | ✅ 完整 | 重试和降级 |
| 流式响应 | `packages/server/src/ai/streaming.ts` | ✅ 完整 | SSE 流处理 |
| 知识库加载 | `packages/server/src/knowledge/loader.ts` | ✅ 完整 | MD 文档加载 |
| 向量数据库 | `packages/server/src/knowledge/vectordb.ts` | ✅ 完整 | TF-IDF + 相似度 |
| 文本分块 | `packages/server/src/knowledge/text-chunker.ts` | ✅ 完整 | Markdown 感知 |
| 上下文增强 | `packages/server/src/knowledge/context-enhancer.ts` | ✅ 完整 | RAG 注入 |
| WebSocket 服务 | `packages/server/src/api/server.ts` | ✅ 完整 | 连接管理 |
| 消息处理 | `packages/server/src/api/handlers.ts` | ✅ 完整 | 消息路由 |
| 认证处理 | `packages/server/src/api/auth-handler.ts` | ✅ 完整 | Agent 认证 |
| 环境探测 | `packages/agent/src/detect/*` | ✅ 完整 | 系统信息采集 |
| 命令执行 | `packages/agent/src/execute/executor.ts` | ✅ 完整 | 进程管理 |
| 沙箱执行 | `packages/agent/src/execute/sandbox.ts` | ✅ 完整 | 隔离执行 |
| 快照系统 | `packages/agent/src/execute/snapshot.ts` | ✅ 完整 | 状态备份 |
| CLI 界面 | `packages/agent/src/ui/*` | ✅ 完整 | 交互组件 |
| 协议定义 | `packages/shared/src/protocol/*` | ✅ 完整 | 消息 Schema |

### 12.2 需要新增的模块

| 模块 | 路径 | 优先级 | 说明 |
|------|------|--------|------|
| Dashboard | `packages/dashboard/` | P0 | React Web 界面 |
| REST API | `packages/server/src/api/routes/` | P0 | HTTP 接口 |
| 数据库层 | `packages/server/src/db/` | P0 | Drizzle ORM |
| 会话管理 | `packages/server/src/core/session/` | P0 | 对话上下文 |
| 档案管理 | `packages/server/src/core/profile/` | P0 | 服务器档案 |
| 任务调度 | `packages/server/src/core/task/` | P1 | 定时任务 |
| 命令分级 | `packages/agent/src/security/` | P0 | 安全分级 |
| 自动学习 | `packages/server/src/knowledge/auto-learn.ts` | P2 | 知识沉淀 |

### 12.3 需要改造的模块

| 模块 | 改造内容 | 工作量 |
|------|---------|--------|
| AI Agent | 增加多 Provider 支持 | 中 |
| WebSocket | 增加用户级认证 | 小 |
| 消息处理 | 增加更多消息类型 | 中 |
| 协议定义 | 增加新的消息 Schema | 小 |

---

## 附录: 技术决策记录

### ADR-001: 为什么选择 SQLite 作为社区版数据库

**状态:** 已采纳

**上下文:** 社区版需要零配置部署，用户不需要额外安装数据库。

**决策:** 使用 SQLite (better-sqlite3) 作为社区版数据库。

**理由:**
- 零配置，随应用部署
- 单文件，易于备份和迁移
- 性能足够 (单机数十台服务器)
- better-sqlite3 是同步 API，性能优于 async 驱动

**后果:**
- 不支持分布式部署 (可接受，有云版)
- 需要处理并发写入 (WAL 模式)

---

### ADR-002: 为什么选择 Bun 编译 Agent 二进制

**状态:** 已采纳

**上下文:** Agent 需要作为单一二进制分发，不依赖 Node.js 运行时。

**决策:** 使用 Bun 的 `bun build --compile` 功能。

**理由:**
- 原生支持 TypeScript
- 编译速度快
- 产物体积小 (~50MB)
- 跨平台编译支持

**后果:**
- 部分 Node.js API 不兼容 (需要测试)
- Bun 相对较新 (风险可控)

---

### ADR-003: 为什么选择 Hono 而非 Express

**状态:** 已采纳

**上下文:** 需要一个轻量、高性能的 Web 框架。

**决策:** 使用 Hono 作为 REST API 框架。

**理由:**
- 极轻量 (~14KB)
- 性能优异 (接近原生 http)
- 类型安全
- 多运行时支持 (Node.js, Bun, Deno, CF Workers)
- 中间件生态丰富

**后果:**
- 社区小于 Express (可接受，API 足够稳定)

---

*文档结束 · ServerPilot 技术方案 v1.0*

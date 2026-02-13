<p align="center">
  <h1 align="center">ServerPilot</h1>
  <p align="center">
    <strong>AI-Powered Server Management Platform</strong>
  </p>
  <p align="center">
    跟 AI 聊天就能管服务器 — 开源、安全、自主可控
  </p>
</p>

<p align="center">
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/ci.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/test.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/test.yml/badge.svg" alt="Test"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/actions/workflows/docker-publish.yml"><img src="https://github.com/jingjinbao/ServerPilot/actions/workflows/docker-publish.yml/badge.svg" alt="Docker"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <a href="https://github.com/jingjinbao/ServerPilot/releases"><img src="https://img.shields.io/github/v/release/jingjinbao/ServerPilot?include_prereleases" alt="Release"></a>
</p>

---

## ServerPilot 是什么？

ServerPilot 是**宝塔面板的 AI 时代替代品**。同样一行命令安装，但用 AI 对话取代表单点击，用开源透明取代闭源黑盒。

```
传统运维:   用户 → 写脚本/敲命令/点面板 → 服务器
ServerPilot: 用户 → 对话 AI → AI 生成计划 → 用户确认 → Agent 执行 → 结果反馈
```

**核心价值**：用自然语言管理服务器，AI 理解你的意图并安全执行，无需记忆复杂命令。

## 功能特性

- **AI 对话运维** — 用自然语言描述需求，AI 自动生成执行计划并完成操作
- **多 AI 模型支持** — Claude / OpenAI / DeepSeek / Ollama / Custom OpenAI 兼容接口（OneAPI / LiteLLM / Azure），自带 Key 或本地模型
- **五级安全防护** — 命令分级审核 + 参数审计 + 操作快照 + 紧急终止 + 完整审计日志
- **服务器档案** — AI 记住每台服务器的环境、软件、配置，上下文精准不出错
- **内置知识库** — 覆盖 Nginx / MySQL / Docker / Node.js / PostgreSQL / Redis 等常见技术栈
- **文档自动抓取** — 从 GitHub / 官网自动同步文档，知识库自成长
- **实时监控** — CPU / 内存 / 磁盘 / 网络实时指标采集与图表展示
- **轻量 Agent** — 单一二进制、<50MB、<1% CPU 占用，对服务器几乎零负担
- **完整 API 文档** — OpenAPI 3.0 规范，内置 Swagger UI 在线调试

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard                            │
│              React + Vite + Tailwind CSS + Zustand              │
│         服务器列表 · AI 对话 · 实时监控 · 知识库搜索              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API + SSE 流式响应
┌───────────────────────────┴─────────────────────────────────────┐
│                          Server                                  │
│                    Node.js + Hono + SQLite                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ AI 引擎   │ │ API 服务  │ │ 知识库    │ │ 安全 · 审计 · 监控  │  │
│  │(多模型)   │ │(REST+WS) │ │(RAG)     │ │(五级命令分级)       │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WSS 加密长连接
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ┌─────┴─────┐     ┌────┴──────┐    ┌─────┴─────┐
    │  Agent A   │     │  Agent B   │    │  Agent C   │
    │ 生产服务器  │     │ 测试服务器  │    │ 开发机     │
    │            │     │            │    │            │
    │ · 环境探测  │     │ · 环境探测  │    │ · 环境探测  │
    │ · 命令执行  │     │ · 命令执行  │    │ · 命令执行  │
    │ · 安全沙箱  │     │ · 安全沙箱  │    │ · 安全沙箱  │
    │ · 指标上报  │     │ · 指标上报  │    │ · 指标上报  │
    └───────────┘     └───────────┘    └───────────┘
```

## 快速开始

### 30 秒 Docker 部署（推荐）

使用预构建镜像，无需克隆代码，无需本地编译：

```bash
# 1. 下载配置文件
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/.env.example -o .env

# 2. 编辑 .env 配置（至少设置 JWT_SECRET 和 AI Provider）
#    JWT_SECRET=your-secret-key-at-least-32-chars
#    AI_PROVIDER=claude
#    ANTHROPIC_API_KEY=sk-ant-...

# 3. 拉取镜像并启动
docker compose pull && docker compose up -d

# 4. 打开浏览器
#    Dashboard: http://localhost:3001
#    API 文档:  http://localhost:3001/api-docs
```

### 从源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/jingjinbao/ServerPilot.git
cd ServerPilot

# 2. 从源码构建并启动
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# 3. 打开浏览器
#    Dashboard: http://localhost:3001
```

首次启动会自动创建管理员账户（密码在日志中查看）：

```bash
docker compose logs server | grep -i "password"
```

> 如需配置 AI 功能，运行引导式初始化：`./init.sh`

### Docker 镜像

镜像同时发布到 Docker Hub 和 GitHub Container Registry，支持 `linux/amd64` 和 `linux/arm64` 架构。

**Docker Hub:**

```bash
docker pull serverpilot/server:latest
docker pull serverpilot/agent:latest
docker pull serverpilot/dashboard:latest
```

**GitHub Container Registry:**

```bash
docker pull ghcr.io/jingjinbao/serverpilot/server:latest
docker pull ghcr.io/jingjinbao/serverpilot/dashboard:latest
```

**版本标签说明:**

| 标签格式 | 示例 | 说明 |
|---------|------|------|
| `latest` | `serverpilot/server:latest` | 最新的 master 分支构建 |
| `{version}` | `serverpilot/server:0.1.0` | 语义化版本（推荐生产使用） |
| `{major}.{minor}` | `serverpilot/server:0.1` | 主次版本号 |
| `sha-{hash}` | `serverpilot/server:sha-a1b2c3d` | Git commit hash |

### 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm dev

# 运行测试
pnpm test

# 构建 Agent 二进制
bun scripts/build-binary.ts
```

### AI Provider 配置

ServerPilot 支持多种 AI 模型提供商，通过环境变量选择：

| Provider | 环境变量 | 说明 |
|----------|---------|------|
| Claude (默认) | `AI_PROVIDER=claude` `ANTHROPIC_API_KEY=sk-...` | Anthropic Claude，Tier 1 |
| OpenAI | `AI_PROVIDER=openai` `OPENAI_API_KEY=sk-...` | GPT-4o 等，Tier 2 |
| DeepSeek | `AI_PROVIDER=deepseek` `DEEPSEEK_API_KEY=sk-...` | DeepSeek Chat，Tier 2 |
| Ollama | `AI_PROVIDER=ollama` | 本地模型，Tier 3 |
| **Custom OpenAI** | `AI_PROVIDER=custom-openai` | 兼容 OpenAI 接口的第三方服务 |

**Custom OpenAI 兼容接口** 支持 OneAPI / LiteLLM / Azure OpenAI 等任何提供标准 `/v1/chat/completions` 端点的服务：

```bash
AI_PROVIDER=custom-openai
CUSTOM_OPENAI_API_KEY=sk-your-api-key
CUSTOM_OPENAI_BASE_URL=https://your-api.example.com/v1
AI_MODEL=gpt-4o  # 可选，按你的服务支持的模型名
```

也可以在 Dashboard 的设置页面中动态切换 Provider，无需重启服务。

## 技术栈

| 组件 | 技术 | 许可证 |
|------|------|--------|
| **Server** | Node.js 22+ · TypeScript · Hono · Drizzle ORM · SQLite | AGPL-3.0 |
| **Agent** | TypeScript · Bun (编译为单一二进制) | Apache-2.0 |
| **Dashboard** | React 18 · Vite 5 · Tailwind CSS · Zustand · React Router 6 | AGPL-3.0 |
| **Shared** | Zod 协议验证 | MIT |
| **AI Provider** | Claude / OpenAI / DeepSeek / Ollama / Custom OpenAI 兼容 | - |
| **部署** | Docker Compose · GitHub Actions CI/CD | - |

## 与其他工具对比

| 特性 | ServerPilot | 宝塔面板 | Ansible | Portainer |
|------|:-----------:|:-------:|:-------:|:---------:|
| AI 对话运维 | :white_check_mark: | :x: | :x: | :x: |
| 无需学习命令 | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: |
| 开源透明 | :white_check_mark: | :x: | :white_check_mark: | 部分 |
| 轻量 Agent | :white_check_mark: | :x: | 无 Agent | :x: |
| 命令安全审计 | 五级分类 | 基础 | 无 | 无 |
| 知识库 RAG | :white_check_mark: | :x: | :x: | :x: |
| 服务器档案 | AI 上下文注入 | 基础信息 | Inventory | 基础 |
| 自带 AI Key | :white_check_mark: | :x: | :x: | :x: |
| 本地模型支持 | Ollama | :x: | :x: | :x: |

## 项目路线图

| 阶段 | 目标 |
|------|------|
| **MVP (v0.1)** | 自部署 → 安装 Agent → 连接 → 对话运维 闭环 |
| **v0.2** | 快照回滚 + 定时任务 + 告警 + 知识库自学习 |
| **v0.3** | GitHub 开源发布 + 社区版安装脚本 |
| **v1.0** | ServerPilot Cloud + 团队协作 + 计费 |

## 商业模式：Open Core

| 版本 | 特性 | 价格 |
|------|------|------|
| **社区版** | Agent + Server 100% 开源，自带 AI Key，无限服务器 | 免费 |
| **云版专业版** | 免配置 AI + 团队协作 + 高级监控 | $19/月 |
| **云版企业版** | SSO + 审计合规 + API 接入 | $99/月起 |

## 文档

| 文档 | 说明 |
|------|------|
| [Architecture](docs/ARCHITECTURE.md) | 系统架构、模块职责、数据流、通信协议 |
| [Security White Paper](docs/SECURITY.md) | 五层纵深防御架构详细说明 |
| [Security Policy](SECURITY.md) | 漏洞报告流程和安全策略 |
| [Deployment Guide](docs/deployment.md) | Docker Compose 部署指南 |

## 安全

ServerPilot 采用**五层纵深防御**策略保护你的服务器：

1. **命令分级** — GREEN / YELLOW / RED / CRITICAL / FORBIDDEN 五级分类，726+ 条规则
2. **参数审计** — 45+ 危险参数识别，40+ 保护路径
3. **操作快照** — 关键操作前自动创建回滚点
4. **紧急终止** — 一键停止所有运行中的操作
5. **审计日志** — 完整的操作追踪和可审计记录

Agent 以非 root 用户运行，仅经审批的操作获得提权。详见 [Security White Paper](docs/SECURITY.md) 和 [Security Policy](SECURITY.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request！

```bash
# Fork 并克隆仓库
git clone https://github.com/your-username/ServerPilot.git
cd ServerPilot

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 运行测试
pnpm test

# 提交 PR 前确保通过
pnpm lint && pnpm typecheck && pnpm test
```

详细指南请参考项目中的贡献文档。

## 许可证

- **Server + Dashboard**: [AGPL-3.0](LICENSE) — 开源但限制云服务商直接使用
- **Agent**: [Apache-2.0](packages/agent/LICENSE) — 企业友好，100% 开源可审计
- **Shared**: [MIT](packages/shared/LICENSE) — 最大生态兼容性

---

<p align="center">
  <sub>Built with :heart: by the ServerPilot team</sub>
</p>

---

## English

**ServerPilot** is an open-source, AI-powered server management platform. Think of it as the AI-era replacement for traditional server panels — manage your servers through natural language conversations instead of memorizing commands or clicking through forms.

### Key Features

- **AI-Driven Operations** — Describe what you need in natural language; AI generates and executes the plan
- **Multi-Model Support** — Claude, OpenAI, DeepSeek, Ollama, Custom OpenAI Compatible (OneAPI / LiteLLM / Azure) — bring your own API key or use local models
- **5-Layer Security** — Command classification, parameter auditing, pre-op snapshots, kill switch, audit trail
- **Self-Growing Knowledge Base** — Built-in docs for common stacks + automatic doc fetching from GitHub/websites
- **Lightweight Agent** — Single binary, <50MB, <1% CPU overhead

### Quick Start

```bash
# Pre-built images (fastest — no build needed)
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/jingjinbao/ServerPilot/master/.env.example -o .env
# Edit .env, then:
docker compose pull && docker compose up -d
# Open http://localhost:3001

# Or build from source:
git clone https://github.com/jingjinbao/ServerPilot.git && cd ServerPilot
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Documentation

- [Architecture](docs/ARCHITECTURE.md) — System architecture, module responsibilities, data flows
- [Security White Paper](docs/SECURITY.md) — Five-layer defense-in-depth architecture
- [Security Policy](SECURITY.md) — Vulnerability reporting and security policy

### License

Server + Dashboard: AGPL-3.0 | Agent: Apache-2.0 | Shared: MIT

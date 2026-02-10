# ServerPilot

> AI 驱动的智能服务器运维平台 — 跟 AI 聊天就能管服务器

**一句话描述**: 宝塔面板的 AI 时代替代品。同样一行命令安装，但用 AI 对话取代表单点击，用开源透明取代闭源黑盒。

```
传统运维: 用户 → 写脚本/敲命令 → 服务器
ServerPilot: 用户 → 对话 AI → AI 生成计划 → Agent 执行 → 结果反馈
```

---

## 项目架构

```
┌─────────────────────────────────┐
│  Web Dashboard (React SPA)       │  ← 待开发
│  浏览器打开，AI 对话管服务器       │
└──────────────┬──────────────────┘
               │ REST API + WebSocket
┌──────────────┴──────────────────┐
│  Server (Node.js)                │
│  · AI 引擎 (多模型)    [已有]     │
│  · API 服务层          [已有]     │
│  · 知识库 RAG          [已有]     │
│  · 任务调度器          [待开发]    │
│  · 服务器档案管理       [待开发]    │
│  · 数据库 (SQLite)     [待开发]    │
└──────────────┬──────────────────┘
               │ WSS (加密长连接)
┌──────────────┴──────────────────┐
│  Agent (轻量守护进程)             │
│  · 环境探测            [已有]     │
│  · 命令执行 + 沙箱     [已有]     │
│  · 快照回滚            [已有]     │
│  · 状态汇报 (心跳)     [待扩展]    │
│  · 命令安全审计         [待开发]    │
│                                  │
│  单一二进制 · < 50MB · < 1% CPU   │
└──────────────────────────────────┘
```

---

## 代码结构

```
ServerPilot/
├── packages/
│   ├── agent/                    # Agent 客户端 (部署在目标服务器)
│   │   └── src/
│   │       ├── client.ts         # ★ WebSocket 客户端 (自动重连+指数退避)
│   │       ├── authenticated-client.ts  # ★ 带认证的客户端
│   │       ├── protocol-lite.ts  # ★ 轻量协议 (不依赖 Zod，减小二进制)
│   │       ├── index.ts          # 主入口 (安装流程编排)
│   │       ├── detect/           # ★ 环境探测系统
│   │       │   ├── os.ts         #   操作系统检测
│   │       │   ├── runtime.ts    #   运行时检测 (Node/Bun/Python)
│   │       │   ├── package-managers.ts  # 包管理器发现
│   │       │   ├── network.ts    #   网络连通性检测
│   │       │   ├── device-fingerprint.ts  # 设备指纹
│   │       │   └── index.ts      #   聚合探测入口
│   │       ├── execute/          # ★ 命令执行引擎
│   │       │   ├── executor.ts   #   命令执行器 (child_process)
│   │       │   ├── sandbox.ts    #   沙箱隔离执行
│   │       │   ├── snapshot.ts   #   操作前快照
│   │       │   └── error-collector.ts  # 错误收集
│   │       └── ui/               # CLI 用户界面
│   │           ├── progress.ts   #   进度条展示
│   │           ├── prompt.ts     #   用户交互确认
│   │           ├── error-messages.ts  # 错误格式化
│   │           ├── summary.ts    #   结果总结
│   │           ├── verbose.ts    #   详细日志
│   │           ├── colors.ts     #   终端颜色
│   │           └── table.ts      #   表格输出
│   │
│   ├── server/                   # Server 服务端
│   │   └── src/
│   │       ├── ai/               # ★ AI 引擎
│   │       │   ├── agent.ts      #   AI Agent 调用 (多模型)
│   │       │   ├── planner.ts    #   AI 规划器 (生成执行计划)
│   │       │   ├── error-analyzer.ts  # ★ 错误诊断器
│   │       │   ├── common-errors.ts   # 常见错误库
│   │       │   ├── fault-tolerance.ts # ★ 容错/降级机制
│   │       │   ├── prompts.ts    #   System Prompt 模板
│   │       │   ├── streaming.ts  #   流式响应
│   │       │   ├── request-retry.ts   # 请求重试
│   │       │   ├── token-tracker.ts   # Token 用量追踪
│   │       │   └── api-key-validator.ts  # API Key 验证
│   │       ├── api/              # ★ API 服务层
│   │       │   ├── server.ts     #   HTTP + WebSocket 服务器
│   │       │   ├── handlers.ts   #   请求处理器
│   │       │   ├── auth-handler.ts  # 认证处理
│   │       │   ├── device-client.ts # 设备管理
│   │       │   ├── session-client.ts  # 会话管理
│   │       │   ├── license-client.ts  # 许可证管理
│   │       │   └── rate-limiter.ts  # 限流/配额
│   │       ├── knowledge/        # ★ 知识库系统
│   │       │   ├── loader.ts     #   知识库加载
│   │       │   ├── vectordb.ts   #   向量数据库
│   │       │   ├── text-chunker.ts  # 文本分块
│   │       │   ├── context-enhancer.ts  # 上下文增强
│   │       │   ├── similarity-search.ts # 相似度搜索
│   │       │   ├── scraper.ts    #   文档抓取
│   │       │   └── ...           #   更多知识库组件
│   │       ├── installers/       # 安装器 (参考架构模式)
│   │       │   └── openclaw/     #   OpenClaw 安装器
│   │       ├── utils/            # 工具库
│   │       │   ├── logger.ts     #   日志
│   │       │   ├── memory-monitor.ts  # 内存监控
│   │       │   └── response-time-tracker.ts  # 响应时间
│   │       ├── docker/           # Docker 相关测试
│   │       └── index.ts          # Server 入口
│   │
│   └── shared/                   # 共享协议定义
│       └── src/
│           ├── protocol/
│           │   ├── messages.ts   # ★ 消息类型 (Zod schema)
│           │   ├── schemas.ts    #   数据 schema
│           │   └── types.ts      #   共享类型
│           └── index.ts
│
├── scripts/                      # ★ 构建、部署、运维脚本
│   ├── build-binary.ts           #   跨平台二进制编译 (Bun)
│   ├── release.ts                #   版本发布流程
│   ├── github-releases.ts        #   GitHub Release 发布
│   ├── install-sh.test.ts        #   安装脚本测试
│   ├── cdn-config.ts             #   CDN 分发配置
│   ├── docs-publish.ts           #   文档发布
│   ├── monitoring-config.ts      #   监控配置
│   ├── fly-*.ts                  #   Fly.io 部署全套
│   ├── init-db.sql               #   数据库初始化
│   ├── run.sh                    #   开发运行脚本
│   ├── health-check.sh           #   健康检查
│   ├── setup-nginx.sh            #   Nginx 配置
│   ├── setup-ssl.sh              #   SSL 证书配置
│   ├── provision-server.sh       #   服务器初始化
│   ├── verify-deployment.sh      #   部署验证
│   └── ...
│
├── docs/                         # 产品与技术文档
│   ├── DevOps产品方案.md          #   ServerPilot 产品方案 v2.2
│   ├── aiinstaller项目分析.md     #   模块复用分析
│   ├── openclaw项目分析.md        #   OpenClaw 参考分析
│   ├── deployment.md             #   部署文档
│   ├── server-setup.md           #   服务器搭建
│   └── ...
│
├── tests/                        # 集成测试 / E2E 测试
├── nginx/                        # Nginx 反向代理配置
├── .github/workflows/            # CI/CD 工作流
├── docker-compose.yml            # 容器编排
├── fly.toml                      # Fly.io 部署配置
├── install.sh                    # 一键安装脚本
├── package.json                  # 根 package.json
├── pnpm-workspace.yaml           # pnpm monorepo 配置
├── tsconfig.json                 # TypeScript 配置
└── vitest.config.ts              # 测试配置
```

---

## 从 AIInstaller 复用的模块

### ★ 直接复用 (改名 + 适配即可)

| 模块 | 位置 | 复用度 | ServerPilot 用途 |
|------|------|--------|-----------------|
| WebSocket 通信 | `agent/src/client.ts` | 90% | Agent ↔ Server 长连接 |
| 协议消息 | `shared/src/protocol/` | 80% | 双端消息协议 |
| 环境探测 | `agent/src/detect/` | 85% | Agent 环境采集 → 服务器档案 |
| 命令执行 | `agent/src/execute/` | 80% | Agent 命令执行 + 沙箱 |
| AI 引擎 | `server/src/ai/` | 75-90% | 多模型调用 + 错误诊断 + 容错 |
| 知识库 | `server/src/knowledge/` | 70% | RAG 知识检索 |
| API 服务 | `server/src/api/` | 70% | HTTP + WS 服务器 |
| 构建部署 | `scripts/` | 85-95% | 跨平台编译 + CI/CD + Fly.io |

### 需扩展的功能

| 功能 | 基于现有模块 | 扩展内容 |
|------|------------|---------|
| WSS 加密 | `client.ts` | 添加 TLS + 心跳 + ack 机制 |
| 环境探测 | `detect/` | 添加软件清单/服务发现/端口扫描 |
| 命令安全 | `execute/` | 添加五级分类 + 参数审计 |
| AI Provider | `ai/agent.ts` | 添加 Ollama + 统一抽象层 |
| 二进制签名 | `build-binary.ts` | 添加 Ed25519 签名验证 |

### 需全新开发

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Web Dashboard | MVP | React SPA — 服务器列表 + AI 对话 + 监控 |
| AI 对话模块 | MVP | 自然语言 → 结构化计划 + 上下文管理 |
| 服务器档案 | MVP | 持久化 + AI 上下文注入 + 增量更新 |
| SQLite 数据层 | MVP | 档案/历史/任务/审计 存储 |
| 用户认证 | MVP | 注册/登录/JWT |
| 命令分级白名单 | MVP | 🟢🟡🔴⛔🚫 五级安全分类 |
| 定时任务 | v0.2 | Cron + Agent 下发 |
| 监控指标 | v0.2 | CPU/内存/磁盘 + 实时图表 |
| 告警引擎 | v0.2 | 阈值告警 + 邮件/Webhook |
| Agent 自动更新 | v0.2 | 版本检查 + 签名验证 + 热替换 |

---

## 技术栈

| 组件 | 技术 |
|------|------|
| Agent | TypeScript + Bun (编译为单一二进制) |
| Server | TypeScript + Node.js |
| Dashboard | React + Vite + Tailwind CSS (待开发) |
| 数据库 (社区版) | SQLite |
| 数据库 (云版) | PostgreSQL |
| AI Provider | Claude / OpenAI / DeepSeek / Ollama / 自定义 |
| 通信协议 | WebSocket (WSS) |
| 类型验证 | Zod (Server) + 轻量验证 (Agent) |
| 测试 | Vitest |
| Monorepo | pnpm workspace |
| 部署 | Docker Compose / Fly.io |
| CI/CD | GitHub Actions |

---

## 快速开始

### 方式一: Docker Compose 一键部署 (推荐)

**零配置，开箱即用！** 使用 SQLite 数据库，无需额外数据库配置。

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/ServerPilot.git
cd ServerPilot

# 2. 一键启动 (无需配置，直接运行！)
docker compose up -d

# 3. 等待服务启动 (约 15-30 秒)
# 查看启动日志
docker compose logs -f

# 4. 访问 Dashboard
# 打开浏览器访问: http://localhost:3000
```

**可选配置**:
```bash
# 如需自定义配置 (AI API Key、端口等)
cp .env.example .env
nano .env  # 编辑配置

# 设置 ANTHROPIC_API_KEY (可选，用于启用 AI 功能)
# 设置 JWT_SECRET (生产环境建议修改)
# 其他所有配置都有合理的默认值
```

**常用命令**:
```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f server    # Server 日志 (包含 SQLite 初始化)
docker compose logs -f dashboard # Dashboard 日志

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 完全清理 (包括 SQLite 数据库)
docker compose down -v
```

**数据持久化**:
- SQLite 数据库文件存储在 Docker volume `server-data` 中
- 数据库路径: `/data/serverpilot.db` (容器内)
- 即使重启容器，数据也会保留
- 只有执行 `docker compose down -v` 才会删除数据

### 方式二: 本地开发模式

适用于开发和调试。

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# SQLite 会自动创建在本地，无需额外配置

# 3. 开发模式 (带热重载)
pnpm dev

# 4. 运行测试
pnpm test

# 5. 构建 Agent 二进制
bun scripts/build-binary.ts
```

### 验收标准检查清单

部署成功后,确认以下项目:

- ✅ 运行 `docker compose ps` 显示 `server` 和 `dashboard` 服务为 `running` 状态
- ✅ 访问 http://localhost:3000 能打开 Dashboard
- ✅ Server 日志显示 "SQLite database initialized successfully"
- ✅ 数据库文件已创建: `docker compose exec server ls -la /data/serverpilot.db`
- ✅ 日志中无明显错误信息

### 故障排查

**服务无法启动**:
```bash
# 检查端口占用
lsof -i :3000

# 查看详细错误日志
docker compose logs --tail=100 server

# 重新构建镜像
docker compose build --no-cache
docker compose up -d
```

**SQLite 数据库问题**:
```bash
# 检查数据库文件权限
docker compose exec server ls -la /data/

# 查看 Server 启动日志 (包含数据库初始化信息)
docker compose logs server | grep -i "database"

# 重置数据库 (删除数据卷并重新创建)
docker compose down -v
docker compose up -d
```

**Dashboard 无法访问**:
```bash
# 检查 nginx 配置
docker compose exec dashboard cat /etc/nginx/conf.d/default.conf

# 检查静态文件是否存在
docker compose exec dashboard ls -la /usr/share/nginx/html/

# 重启 Dashboard
docker compose restart dashboard
```

---

## 开发路线图

| 阶段 | 周期 | 目标 |
|------|------|------|
| **MVP (v0.1)** | 6 周 | 自部署 → 安装 Agent → 连接 → 对话运维 闭环 |
| **v0.2** | 4 周 | 快照回滚 + 定时任务 + 监控 + 告警 + 知识库 |
| **v0.3** | 4 周 | GitHub 开源发布 + 社区版安装脚本 |
| **v1.0** | 4 周 | ServerPilot Cloud 上线 + 团队协作 + 计费 |

详细产品方案见 [docs/DevOps产品方案.md](docs/DevOps产品方案.md)

模块复用分析见 [docs/aiinstaller项目分析.md](docs/aiinstaller项目分析.md)

---

## 商业模式: Open Core

- **社区版**: Agent + Server 100% 开源，用户自带 AI Key，无限服务器
- **云版专业版 ($19/月)**: 免配置 AI + 团队协作 + 高级监控
- **云版企业版 ($99/月起)**: SSO + 审计合规 + API 接入

---

## 许可证

- Agent: Apache 2.0
- Server: AGPL 3.0
- 知识库/模板: MIT

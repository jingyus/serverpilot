# ServerPilot 部署文档 (MVP v0.1)

> **一键部署指南** - Docker Compose 自部署 ServerPilot AI 运维平台

## 目录

- [快速开始](#快速开始)
- [环境要求](#环境要求)
- [安装步骤](#安装步骤)
  - [1. 安装 Docker](#1-安装-docker)
  - [2. 克隆项目](#2-克隆项目)
  - [3. 配置环境变量](#3-配置环境变量可选)
  - [4. 启动服务](#4-启动服务)
- [验证部署](#验证部署)
  - [1. 检查容器状态](#1-检查容器状态)
  - [2. 查看日志](#2-查看日志)
  - [3. 健康检查](#3-健康检查)
  - [4. 访问 Dashboard](#4-访问-dashboard)
  - [5. WebSocket 连接测试](#5-websocket-连接测试)
  - [6. 容器间通信测试](#6-容器间通信测试)
- [环境变量配置](#环境变量配置)
- [常见问题](#常见问题)
- [数据管理](#数据管理)
  - [数据备份](#数据备份)
  - [数据恢复](#数据恢复)
  - [数据迁移](#数据迁移)
- [更新与维护](#更新与维护)
- [高级部署](#高级部署)
  - [Fly.io 部署](#flyio-部署)
  - [手动部署](#手动部署)
  - [客户端分发](#客户端分发)
- [监控设置](#监控设置)
- [运维手册](#运维手册)

---

## 快速开始

**方法一: 引导式一键部署 (推荐)**

```bash
# 1. 克隆仓库
git clone https://github.com/jingjinbao/ServerPilot.git
cd ServerPilot

# 2. 运行初始化脚本 (自动引导配置并启动)
./init.sh
```

**方法二: 手动配置部署**

```bash
# 1. 克隆仓库
git clone https://github.com/jingjinbao/ServerPilot.git
cd ServerPilot

# 2. (可选) 配置环境变量
cp .env.example .env
# 编辑 .env 文件,至少设置 ANTHROPIC_API_KEY

# 3. 启动服务
docker compose up -d
```

访问 `http://localhost` 即可使用 Dashboard!

---

## 环境要求

### 必需软件

| 软件 | 最低版本 | 推荐版本 | 获取方式 |
|-----|---------|---------|---------|
| **Docker** | 20.10+ | 25.0+ | [docker.com](https://docs.docker.com/get-docker/) |
| **Docker Compose** | 2.0+ | 2.24+ | Docker Desktop 自带 |
| **Git** | 2.0+ | 最新 | 系统包管理器 |

### 系统要求

- **操作系统**: Linux / macOS / Windows (WSL2)
- **CPU**: 2 核心以上
- **内存**: 2GB 可用内存
- **磁盘**: 5GB 可用空间 (含 Docker 镜像)

### AI Provider (可选)

ServerPilot 支持多种 AI 模型,**至少配置一个** AI Provider 才能使用 AI 对话功能:

| Provider | API Key 获取 | 免费额度 |
|---------|-------------|---------|
| **Claude** (推荐) | [console.anthropic.com](https://console.anthropic.com) | $5 试用 |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | $5 试用 |
| **Ollama** (本地) | 无需 API Key | 完全免费 |

> **注意**: 没有配置 AI Provider 时,系统仍可正常运行,但 AI 对话功能不可用。

---

## 安装步骤

### 1. 安装 Docker

#### macOS

```bash
# 使用 Homebrew 安装 Docker Desktop
brew install --cask docker

# 或从官网下载 DMG 安装包
# https://docs.docker.com/desktop/install/mac-install/
```

安装后,从 "应用程序" 启动 Docker Desktop,等待 Docker 图标显示绿色。

验证安装:
```bash
docker --version
docker compose version
```

#### Linux (Ubuntu/Debian)

```bash
# 安装 Docker Engine
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 将当前用户添加到 docker 组 (避免每次 sudo)
sudo usermod -aG docker $USER
newgrp docker

# 启动 Docker 服务
sudo systemctl enable docker
sudo systemctl start docker
```

验证安装:
```bash
docker --version
docker compose version
```

#### Windows

1. 下载并安装 [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
2. 确保启用 WSL2 (推荐) 或 Hyper-V
3. 启动 Docker Desktop

验证安装 (PowerShell 或 WSL2 终端):
```bash
docker --version
docker compose version
```

---

### 2. 克隆项目

```bash
git clone https://github.com/jingjinbao/ServerPilot.git
cd ServerPilot
```

---

### 3. 配置环境变量 (可选)

ServerPilot 采用**零配置设计**,开箱即用。环境变量配置**完全可选**。

#### 最小化配置 (推荐)

如果你想使用 AI 功能,只需配置 API Key:

```bash
cp .env.example .env
```

编辑 `.env` 文件,添加你的 API Key:

```bash
# AI Provider 选择 (默认: claude)
AI_PROVIDER=claude  # claude | openai | ollama | deepseek

# AI 配置 (至少配置一个 API Key)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
# 或
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
# 或
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx
# 或
OLLAMA_BASE_URL=http://localhost:11434  # 本地 Ollama (无需 API Key)
```

#### 完整配置选项

查看 `.env.example` 文件了解所有可配置项:

```bash
cat .env.example
```

主要配置项:

| 变量 | 默认值 | 必填 | 说明 |
|-----|-------|------|-----|
| `DASHBOARD_PORT` | 80 | 否 | Dashboard 外部访问端口 |
| `JWT_SECRET` | `default_jwt_secret...` | 是 | **生产环境必须修改** |
| `AI_PROVIDER` | `claude` | 否 | AI Provider: claude/openai/ollama/deepseek |
| `ANTHROPIC_API_KEY` | (空) | 是 | Claude API Key |
| `OPENAI_API_KEY` | (空) | 否 | OpenAI API Key (AI_PROVIDER=openai 时需要) |
| `DEEPSEEK_API_KEY` | (空) | 否 | DeepSeek API Key (AI_PROVIDER=deepseek 时需要) |
| `AI_MODEL` | `claude-sonnet-4-20250514` | 否 | AI 模型名称 |
| `GITHUB_TOKEN` | (空) | 否 | GitHub API Token (文档自动抓取) |
| `CORS_ORIGIN` | `*` | 否 | CORS 允许的来源域名 (生产环境建议设为具体域名) |
| `LOG_LEVEL` | `info` | 否 | 日志级别 (debug/info/warn/error) |

生成安全的 JWT Secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

### 4. 启动服务

```bash
docker compose up -d
```

**参数说明**:
- `-d`: 后台运行 (detached mode)

Docker Compose 会自动:
1. 拉取 Node.js 和 Nginx 基础镜像
2. 构建 `serverpilot-server` 镜像 (Server + SQLite)
3. 构建 `serverpilot-dashboard` 镜像 (React SPA + Nginx)
4. 创建 Docker 网络和数据卷
5. 启动所有容器

**首次构建时间**: 约 5-10 分钟 (取决于网络速度)

---

## 验证部署

### 1. 检查容器状态

```bash
docker compose ps
```

**预期输出**:
```
NAME                    STATUS         PORTS
serverpilot-server      Up (healthy)   3000/tcp
serverpilot-dashboard   Up             0.0.0.0:80->80/tcp
```

确保 `STATUS` 列显示 `Up` 或 `Up (healthy)`。

---

### 2. 查看日志

**查看所有服务日志**:
```bash
docker compose logs -f
```

**只看 Server 日志**:
```bash
docker compose logs -f server
```

**只看 Dashboard 日志**:
```bash
docker compose logs -f dashboard
```

**预期日志** (Server):
```
[INFO] Server started on http://0.0.0.0:3000
[INFO] WebSocket server ready
[INFO] Database initialized: /data/serverpilot.db
[INFO] Knowledge base loaded: 10 documents
```

---

### 3. 健康检查

**Server 健康检查** (通过 Nginx 反向代理):
```bash
curl http://localhost/health
```

**预期响应**:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T12:00:00.000Z",
  "database": "connected",
  "websocket": "ready"
}
```

---

### 4. 访问 Dashboard

打开浏览器访问:
```
http://localhost
```

**预期结果**:
- 看到 ServerPilot 登录页面
- 页面加载无错误

---

### 5. WebSocket 连接测试

**方法 1: 浏览器开发者工具**

1. 打开 Dashboard (`http://localhost`)
2. 按 F12 打开开发者工具
3. 切换到 "Network" (网络) 标签
4. 过滤 "WS" (WebSocket)
5. 刷新页面

**预期结果**:
- 看到 `ws://localhost/ws` 连接
- 状态为 `101 Switching Protocols`

**方法 2: 命令行测试 (需要 wscat)**

```bash
# 安装 wscat
npm install -g wscat

# 测试 WebSocket 连接
wscat -c ws://localhost/ws
```

**预期结果**:
```
Connected (press CTRL+C to quit)
< {"type":"connection.established","timestamp":1707568800000}
```

---

### 6. 容器间通信测试

验证 Dashboard (Nginx) 能否正确代理到 Server:

```bash
# 通过 Dashboard 的 Nginx 反向代理访问 Server API
curl http://localhost/api/health
```

**预期响应**:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T12:00:00.000Z"
}
```

> **注意**: 这个请求通过 Nginx (`dashboard` 容器) 代理到 `server` 容器,验证容器间网络通信正常。

---

## 常见问题

### 1. 端口冲突

**问题**: `Error: bind: address already in use`

**解决方案**:

```bash
# 检查占用 80 端口的进程
lsof -i :80

# 杀死占用进程
kill -9 <PID>

# 或者修改 .env 文件更换端口
DASHBOARD_PORT=8080
```

---

### 2. Docker 权限错误 (Linux)

**问题**: `permission denied while trying to connect to the Docker daemon socket`

**解决方案**:

```bash
# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 或每次命令前加 sudo
sudo docker compose up -d
```

---

### 3. 容器健康检查失败

**问题**: `server` 容器状态显示 `unhealthy`

**排查步骤**:

1. 查看 Server 日志:
   ```bash
   docker compose logs server
   ```

2. 检查健康检查端点:
   ```bash
   docker exec serverpilot-server curl http://localhost:3000/health
   ```

3. 常见原因:
   - 数据库初始化失败 (检查 `/data` 目录权限)
   - AI API Key 配置错误 (检查 `.env` 文件)
   - 知识库加载失败 (检查 `knowledge-base` 目录)

---

### 4. Dashboard 无法连接 Server

**问题**: 浏览器访问 Dashboard,但 API 请求失败

**排查步骤**:

1. 检查容器是否都在运行:
   ```bash
   docker compose ps
   ```

2. 检查容器网络:
   ```bash
   docker network inspect serverpilot_aiinstaller-network
   ```

3. 测试容器间通信:
   ```bash
   docker exec serverpilot-dashboard curl http://server:3000/health
   ```

4. 检查 Nginx 配置:
   ```bash
   docker exec serverpilot-dashboard cat /etc/nginx/conf.d/default.conf
   ```

---

### 5. WebSocket 连接失败

**问题**: Dashboard 显示 "WebSocket connection failed"

**排查步骤**:

1. 检查浏览器控制台错误信息

2. 验证 WebSocket 端点:
   ```bash
   wscat -c ws://localhost/ws
   ```

3. 检查 Nginx WebSocket 代理配置 (确保有 `Upgrade` 和 `Connection` 头)

4. 检查防火墙规则 (确保允许 WebSocket 连接)

---

### 6. 数据丢失

**问题**: 重启容器后数据消失

**原因**: 没有使用 Docker Volume 持久化数据

**解决方案**:

确保 `docker-compose.yml` 中定义了数据卷:
```yaml
volumes:
  server-data:
    driver: local
```

并且 Server 容器挂载了数据卷:
```yaml
services:
  server:
    volumes:
      - server-data:/data
```

---

### 7. 构建失败

**问题**: `docker compose up` 时构建镜像失败

**排查步骤**:

1. 清理 Docker 缓存:
   ```bash
   docker builder prune -a
   ```

2. 重新构建:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

3. 检查 Dockerfile 和 `.dockerignore`:
   ```bash
   cat packages/server/Dockerfile
   cat .dockerignore
   ```

> **注意**: 项目当前存在 TypeScript 构建错误,需要先修复代码错误才能成功构建。

---

### 8. AI 功能不可用

**问题**: Dashboard 显示 "AI service unavailable"

**排查步骤**:

1. 检查 AI API Key 是否配置:
   ```bash
   docker compose exec server env | grep API_KEY
   ```

2. 检查 Server 日志中的 AI 相关错误:
   ```bash
   docker compose logs server | grep -i "ai\|anthropic\|openai"
   ```

3. 验证 API Key 有效性:
   ```bash
   # Claude
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-3-haiku-20240307","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
   ```

---

## 数据管理

### 数据备份

#### 方法 1: 使用 Docker Volume 导出

```bash
# 创建备份目录
mkdir -p backups/$(date +%Y%m%d)

# 备份 SQLite 数据库
docker run --rm \
  -v serverpilot_server-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/$(date +%Y%m%d)/server-data.tar.gz -C /data .

# 备份知识库
docker run --rm \
  -v serverpilot_knowledge-base:/knowledge-base \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/$(date +%Y%m%d)/knowledge-base.tar.gz -C /knowledge-base .
```

#### 方法 2: 直接复制数据库文件

```bash
# 停止 Server 容器
docker compose stop server

# 复制数据库文件
docker cp serverpilot-server:/data/serverpilot.db ./backups/serverpilot-$(date +%Y%m%d).db

# 启动 Server 容器
docker compose start server
```

---

### 数据恢复

#### 从备份恢复

```bash
# 停止所有服务
docker compose down

# 恢复数据卷
docker run --rm \
  -v serverpilot_server-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/20260210/server-data.tar.gz -C /data

# 重新启动服务
docker compose up -d
```

---

### 数据迁移

#### 迁移到新服务器

1. **源服务器**: 导出数据
   ```bash
   docker compose exec server sqlite3 /data/serverpilot.db .dump > serverpilot.sql
   ```

2. **新服务器**: 导入数据
   ```bash
   # 复制 SQL 文件到新服务器
   scp serverpilot.sql user@new-server:/path/to/ServerPilot/

   # 在新服务器上导入
   docker compose up -d
   docker compose exec server sqlite3 /data/serverpilot.db < serverpilot.sql
   ```

---

## 更新与维护

### 更新 ServerPilot

```bash
# 1. 备份数据 (见上文 "数据备份")

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建镜像
docker compose build --no-cache

# 4. 重启服务
docker compose up -d
```

---

### 查看资源使用

```bash
# 查看容器资源占用
docker stats serverpilot-server serverpilot-dashboard

# 查看数据卷大小
docker system df -v | grep serverpilot
```

---

### 日志管理

#### 查看实时日志

```bash
docker compose logs -f --tail=100
```

#### 导出日志到文件

```bash
docker compose logs > logs/serverpilot-$(date +%Y%m%d).log
```

#### 日志轮转

日志轮转已在 `docker-compose.yml` 中预配置:
- **Server**: json-file 驱动, 最大 10MB/文件, 保留 3 个文件
- **Dashboard**: json-file 驱动, 最大 5MB/文件, 保留 3 个文件

无需手动配置。如需调整限制,编辑 `docker-compose.yml` 中的 `logging.options`。

---

## 高级部署

### Fly.io 部署

#### 1. 安装 Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
```

#### 2. 登录并初始化

```bash
fly auth login
fly launch
```

#### 3. 配置密钥

```bash
fly secrets set ANTHROPIC_API_KEY=your_api_key_here
fly secrets set AI_MODEL=claude-sonnet-4-20250514
fly secrets set AI_TIMEOUT_MS=30000
fly secrets set AI_MAX_RETRIES=3
fly secrets set WS_HEARTBEAT_INTERVAL_MS=30000
fly secrets set WS_CONNECTION_TIMEOUT_MS=10000
fly secrets set LOG_LEVEL=info
```

#### 4. 部署

```bash
fly deploy
```

#### 5. 验证

```bash
fly status
fly logs
```

#### 6. 自动扩容

```bash
# 配置自动扩容
fly scale count 2       # 设置最小实例数
fly autoscale set min=1 max=5
```

### 手动部署

#### 1. 安装依赖

```bash
pnpm install --frozen-lockfile
```

#### 2. 构建项目

```bash
# 构建共享包（必须先构建）
pnpm --filter @aiinstaller/shared build

# 构建服务端
pnpm --filter @aiinstaller/server build
```

#### 3. 启动服务

```bash
NODE_ENV=production node packages/server/dist/index.js
```

使用 PM2 管理进程（推荐）:

```bash
npm install -g pm2
pm2 start packages/server/dist/index.js --name serverpilot-server
pm2 save
pm2 startup
```

---

## 客户端分发

### 二进制构建

使用 Bun 编译为独立可执行文件:

```bash
# 构建当前平台
pnpm build:binary

# 构建所有平台
pnpm build:binary:all

# 构建指定平台
bun scripts/build-binary.ts --target linux-x64
```

支持的目标平台:

| 平台 | 目标标识 | 输出文件 |
|------|---------|---------|
| macOS Apple Silicon | darwin-arm64 | install-agent-darwin-arm64 |
| macOS Intel | darwin-x64 | install-agent-darwin-x64 |
| Linux x86_64 | linux-x64 | install-agent-linux-x64 |
| Linux ARM64 | linux-arm64 | install-agent-linux-arm64 |

构建产物位于 `packages/agent/dist/bin/` 目录。

### 安装脚本

用户可通过一行命令安装:

```bash
curl -fsSL https://get.aiinstaller.dev/install.sh | bash
```

安装脚本支持的选项:

| 选项 | 说明 |
|------|------|
| `--server <url>` | 指定服务器地址 |
| `--dry-run` | 预览模式，不执行命令 |
| `--verbose` / `-v` | 详细输出 |
| `--yes` / `-y` | 自动确认所有步骤 |

### CDN 配置

将构建产物和安装脚本上传至 CDN:

1. **上传文件**:
   - `install.sh` - 安装脚本
   - `install-agent-darwin-arm64` - macOS ARM64 二进制
   - `install-agent-darwin-x64` - macOS Intel 二进制
   - `install-agent-linux-x64` - Linux x64 二进制
   - `install-agent-linux-arm64` - Linux ARM64 二进制
   - `checksums.txt` - SHA256 校验文件

2. **缓存策略**:
   - 二进制文件: 按版本路径分发，长期缓存 (`Cache-Control: public, max-age=31536000`)
   - `install.sh`: 短期缓存 (`Cache-Control: public, max-age=300`)
   - `checksums.txt`: 不缓存 (`Cache-Control: no-cache`)

---

## 环境变量配置

### 服务端配置

| 变量名 | 默认值 | 必填 | 说明 |
|--------|-------|------|------|
| `ANTHROPIC_API_KEY` | - | 是 | Anthropic Claude API 密钥 |
| `OPENAI_API_KEY` | - | 否 | OpenAI API 密钥 |
| `DEEPSEEK_API_KEY` | - | 否 | DeepSeek API 密钥 |
| `CUSTOM_OPENAI_BASE_URL` | - | 否 | Custom OpenAI 兼容 API Base URL (AI_PROVIDER=custom-openai 时需要) |
| `CUSTOM_OPENAI_API_KEY` | - | 否 | Custom OpenAI 兼容 API Key (AI_PROVIDER=custom-openai 时需要) |
| `AI_PROVIDER` | `claude` | 否 | AI Provider: claude/openai/ollama/deepseek/custom-openai |
| `JWT_SECRET` | - | 是 | JWT 签名密钥 (至少 32 字符) |
| `DASHBOARD_PORT` | `3001` | 否 | Dashboard 外部访问端口 |
| `SERVER_PORT` | `3000` | 否 | 服务端口 |
| `SERVER_HOST` | `0.0.0.0` | 否 | 监听地址 |
| `NODE_ENV` | `production` | 否 | 运行环境 |
| `AI_MODEL` | `claude-sonnet-4-20250514` | 否 | AI 模型 |
| `AI_TIMEOUT_MS` | `30000` | 否 | AI 请求超时 (ms) |
| `AI_MAX_RETRIES` | `3` | 否 | AI 最大重试次数 |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | 否 | WebSocket 心跳间隔 (ms) |
| `WS_CONNECTION_TIMEOUT_MS` | `10000` | 否 | WebSocket 连接超时 (ms) |
| `WS_REQUIRE_AUTH` | `true` | 否 | WebSocket 是否需要认证 |
| `WS_AUTH_TIMEOUT_MS` | `10000` | 否 | WebSocket 认证超时 (ms) |
| `GITHUB_TOKEN` | - | 否 | GitHub API Token (文档自动抓取) |
| `KB_CHECK_INTERVAL_HOURS` | `24` | 否 | 文档抓取检查间隔 (小时) |
| `KB_RUN_ON_START` | `true` | 否 | 启动时是否立即抓取文档 |
| `KB_MAX_CONCURRENT` | `3` | 否 | 最大并发抓取数 |
| `KNOWLEDGE_BASE_DIR` | `./knowledge-base` | 否 | 知识库目录路径 |
| `LOG_LEVEL` | `info` | 否 | 日志级别: debug/info/warn/error |
| `LOG_FILE` | - | 否 | 日志文件路径 |
| `MAGIC_API_BASE_URL` | `http://localhost:8088` | 否 | Magic API 服务地址 |
| `MAGIC_API_TIMEOUT_MS` | `5000` | 否 | Magic API 请求超时 (ms) |

### GitHub OAuth 配置

| 变量名 | 默认值 | 必填 | 说明 |
|--------|-------|------|------|
| `GITHUB_OAUTH_CLIENT_ID` | - | 否 | GitHub OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | - | 否 | GitHub OAuth App Client Secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `http://localhost:3000/api/v1/auth/github/callback` | 否 | GitHub OAuth 回调地址 (生产环境需修改) |

### 数据库配置

| 变量名 | 默认值 | 必填 | 说明 |
|--------|-------|------|------|
| `DATABASE_PATH` | `/data/serverpilot.db` | 否 | SQLite 数据库文件路径 (Docker 内部路径) |

**注意**: ServerPilot 使用 SQLite 进行零配置部署，无需额外的数据库服务。数据通过 Docker volume `server-data` 持久化。

### 管理员配置

| 变量名 | 默认值 | 必填 | 说明 |
|--------|-------|------|------|
| `ADMIN_EMAIL` | `admin@serverpilot.local` | 否 | 管理员邮箱 (仅首次启动时使用) |
| `ADMIN_PASSWORD` | (空) | 否 | 管理员密码 (最少 8 字符, 空则自动生成) |

### 客户端配置

| 变量名 | 默认值 | 说明 |
|--------|-------|------|
| `INSTALL_SERVER_URL` | `ws://localhost:3000` | 服务端 WebSocket 地址 |
| `COMMAND_TIMEOUT_MS` | `120000` | 命令执行超时 (ms) |
| `DRY_RUN` | `false` | 预览模式 |

---

## 监控设置

### 健康检查

Docker 内置健康检查已在 Dockerfile 和 docker-compose.yml 中配置:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "const http = require('http'); http.get('http://localhost:3000', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
  interval: 30s
  timeout: 5s
  start_period: 10s
  retries: 3
```

外部监控可通过 HTTP GET `http://<host>:3000` 进行存活检测。

### 应用监控

推荐集成 Sentry 进行应用级监控:

```bash
# 添加 Sentry 依赖
pnpm --filter @aiinstaller/server add @sentry/node

# 设置环境变量
SENTRY_DSN=https://your-sentry-dsn
```

监控指标:

- WebSocket 活跃连接数
- AI API 请求成功率 / 平均响应时间
- 安装成功率 / 失败率
- 命令执行超时次数
- 内存使用量

### 日志聚合

使用结构化日志，推荐方案:

1. **ELK Stack** (Elasticsearch + Logstash + Kibana)
2. **Grafana Loki** (轻量级方案)

配置日志级别:

```bash
# 生产环境
LOG_LEVEL=info

# 调试时
LOG_LEVEL=debug
```

### 告警规则

建议配置的告警:

| 告警 | 条件 | 严重级别 |
|------|------|---------|
| 服务不可用 | 健康检查连续 3 次失败 | Critical |
| AI API 错误率过高 | 5 分钟内错误率 > 50% | Warning |
| 内存使用过高 | 内存使用 > 85% | Warning |
| WebSocket 连接异常 | 活跃连接数突降 > 50% | Warning |
| AI API 响应过慢 | 平均响应时间 > 10s | Info |

---

## 备份策略

### 需要备份的数据

| 数据 | 位置 | 频率 | 保留策略 |
|------|------|------|---------|
| 知识库文档 | `knowledge-base/` | 每次变更 | Git 版本控制 |
| 环境变量配置 | `.env` | 每次变更 | 加密备份 |
| Docker 卷数据 | `knowledge-base` volume | 每日 | 保留 30 天 |
| 日志文件 | `LOG_FILE` 路径 | 每日轮转 | 保留 7 天 |

### 备份命令

```bash
# 备份知识库（Docker 卷）
docker run --rm \
  -v aiinstaller_knowledge-base:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/knowledge-base-$(date +%Y%m%d).tar.gz -C /data .

# 备份环境配置（请加密存储）
cp .env backups/.env.backup.$(date +%Y%m%d)
```

### 恢复流程

```bash
# 恢复知识库
docker run --rm \
  -v aiinstaller_knowledge-base:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/knowledge-base-YYYYMMDD.tar.gz -C /data

# 重启服务
docker compose restart
```

---

## 运维手册

### 常用命令

```bash
# === Docker 管理 ===
docker compose up -d          # 启动服务
docker compose down            # 停止服务
docker compose restart         # 重启服务
docker compose logs -f         # 查看实时日志
docker compose ps              # 查看运行状态
docker compose pull            # 拉取最新镜像

# === 构建 ===
docker compose build           # 重新构建镜像
docker compose build --no-cache # 无缓存重新构建

# === Fly.io 管理 ===
fly status                     # 查看应用状态
fly logs                       # 查看日志
fly ssh console                # SSH 进入实例
fly scale show                 # 查看扩容配置
fly deploy                     # 部署新版本
```

### 故障排除

#### 服务无法启动

1. 检查环境变量是否完整:
   ```bash
   docker compose config  # 验证 compose 配置
   ```
2. 检查端口是否被占用:
   ```bash
   lsof -i :3000
   ```
3. 查看容器日志:
   ```bash
   docker compose logs server
   ```

#### AI API 调用失败

1. 验证 API Key 是否有效:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "content-type: application/json" \
     -H "anthropic-version: 2023-06-01" \
     -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
   ```
2. 检查网络连通性
3. 检查 `AI_TIMEOUT_MS` 和 `AI_MAX_RETRIES` 配置

#### WebSocket 连接断开

1. 检查 `WS_HEARTBEAT_INTERVAL_MS` 设置
2. 检查反向代理的 WebSocket 超时配置
3. 确保负载均衡器支持 WebSocket 协议

### 版本升级

#### Docker 部署升级

```bash
# 1. 拉取最新代码
git pull origin master

# 2. 重新构建镜像
docker compose build

# 3. 滚动重启
docker compose up -d

# 4. 验证
docker compose ps
curl http://localhost
```

#### Fly.io 升级

```bash
# 1. 拉取最新代码
git pull origin master

# 2. 部署
fly deploy

# 3. 验证
fly status
```

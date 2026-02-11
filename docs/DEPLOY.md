# ServerPilot 部署指南

## 快速开始

### 系统要求

- Docker 20.10+
- Docker Compose V2 (docker compose)
- 最低 1GB RAM / 10GB 磁盘

### 一键部署

```bash
git clone <repo-url> && cd ServerPilot
./init.sh
```

`init.sh` 会自动完成：
1. 检测 Docker 环境
2. 生成 JWT 密钥
3. 引导配置 AI Provider（可选）
4. 创建默认管理员账户
5. 构建并启动容器
6. 等待健康检查通过

### 手动部署

```bash
# 1. 复制并编辑环境变量（可选）
cp .env.example .env
# 编辑 .env 设置 ANTHROPIC_API_KEY 等

# 2. 启动
docker compose up -d

# 3. 查看日志（首次启动会显示管理员密码）
docker compose logs server
```

### 访问

- **Dashboard**: http://localhost:3001 (可通过 `DASHBOARD_PORT` 修改)
- **API**: http://localhost:3001/api/v1 (通过 Nginx 反向代理)

## 架构

```
                    ┌───────────────────┐
                    │    浏览器/客户端     │
                    └─────────┬─────────┘
                              │ :3001
                    ┌─────────▼─────────┐
                    │  Dashboard (Nginx) │
                    │  - 静态文件服务      │
                    │  - 反向代理 API/WS  │
                    └─────────┬─────────┘
                              │ :3000 (internal)
                    ┌─────────▼─────────┐
                    │  Server (Node.js)  │
                    │  - REST API (Hono) │
                    │  - WebSocket       │
                    │  - SQLite + Drizzle│
                    │  - AI Agent        │
                    └───────────────────┘
```

- **Server** 不直接暴露端口，所有外部请求通过 Dashboard Nginx 代理
- 数据持久化在 Docker volume `server-data` 中
- 知识库持久化在 Docker volume `knowledge-base` 中

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DASHBOARD_PORT` | `3001` | Dashboard 外部端口 |
| `JWT_SECRET` | 自动生成 | JWT 签名密钥（至少32字符） |
| `ANTHROPIC_API_KEY` | 空 | Claude AI API Key（可选） |
| `AI_MODEL` | `claude-sonnet-4-20250514` | AI 模型 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `ADMIN_EMAIL` | `admin@serverpilot.local` | 默认管理员邮箱 |
| `ADMIN_PASSWORD` | 自动生成 | 默认管理员密码 |
| `OPENAI_API_KEY` | 空 | OpenAI API Key（AI_PROVIDER=openai 时） |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek API Key（AI_PROVIDER=deepseek 时） |
| `CUSTOM_OPENAI_BASE_URL` | 空 | OpenAI 兼容 API 地址（AI_PROVIDER=custom-openai 时） |
| `CUSTOM_OPENAI_API_KEY` | 空 | OpenAI 兼容 API Key（AI_PROVIDER=custom-openai 时） |
| `GITHUB_OAUTH_CLIENT_ID` | 空 | GitHub OAuth 登录 Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | 空 | GitHub OAuth 登录 Client Secret |

完整变量列表见 `.env.example`。

## 管理员账户

首次启动时自动创建管理员账户：

- 如果 `.env` 中设置了 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`，使用指定的值
- 如果未设置密码，系统自动生成随机密码并显示在日志中

查看自动生成的密码：
```bash
docker compose logs server | grep -A 5 "ADMIN ACCOUNT"
```

## 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
docker compose logs -f server    # 仅 server 日志

# 重启
docker compose restart
docker compose restart server    # 仅重启 server

# 停止
docker compose down

# 清除数据重新开始
docker compose down -v           # 警告：删除所有数据！

# 更新版本
git pull
docker compose build
docker compose up -d
```

## 开发模式

开发模式使用 `docker-compose.dev.yml`：

```bash
docker compose -f docker-compose.dev.yml up
```

特性：
- Server 端口 3001（避免与本地开发冲突）
- Dashboard 端口 8080
- Debug 端口 9229（可连接 VS Code 调试器）
- 日志级别 debug
- WS 认证关闭（方便调试）
- 默认管理员：admin@localhost / admin123456

### 本地开发（推荐）

不使用 Docker 直接开发：

```bash
pnpm install
pnpm dev          # 启动所有开发服务
```

## 健康检查

Server 提供 `/health` 端点：

```bash
curl http://localhost:3001/health
# {"status":"ok","timestamp":1707654321000}
```

Docker 自动执行健康检查（10s 间隔），Dashboard 在 Server 健康后才启动。

## 故障排除

### 服务启动失败

```bash
# 检查日志
docker compose logs server

# 检查容器状态
docker compose ps

# 手动检查健康
docker exec serverpilot-server node -e \
  "const http = require('http'); http.get('http://localhost:3000/health', (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>console.log(d)) })"
```

### 端口冲突

修改 `.env` 中的 `DASHBOARD_PORT`：
```bash
DASHBOARD_PORT=8080
docker compose up -d
```

### 数据库损坏

```bash
# 备份当前数据
docker compose exec server cp /data/serverpilot.db /data/serverpilot.db.bak

# 重新初始化
docker compose down
docker volume rm serverpilot_server-data
docker compose up -d
```

### AI 功能不可用

检查 `ANTHROPIC_API_KEY` 是否配置：
```bash
docker compose exec server env | grep ANTHROPIC
```

如未配置，编辑 `.env` 添加 API Key 后重启：
```bash
docker compose restart server
```

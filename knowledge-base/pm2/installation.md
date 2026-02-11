# PM2 安装指南

## 概述

PM2 是 Node.js 应用的生产级进程管理器，提供进程守护、负载均衡、日志管理、零停机重载等功能。支持 Node.js、Python、Ruby、PHP 等多种运行时。是部署 Node.js 服务的标准工具。

## Ubuntu/Debian 安装

### 使用 npm（推荐）

```bash
# 全局安装 PM2
sudo npm install -g pm2

# 或使用 pnpm
sudo pnpm add -g pm2

# 验证
pm2 --version
```

### 使用 yarn

```bash
# 全局安装
sudo yarn global add pm2

# 验证
pm2 --version
```

## CentOS/RHEL 安装

```bash
# 确保 Node.js 已安装
node --version

# 全局安装
sudo npm install -g pm2

# 验证
pm2 --version
```

## macOS 安装

```bash
# 使用 npm
npm install -g pm2

# 或使用 Homebrew + npm
brew install node
npm install -g pm2

# 验证
pm2 --version
```

## Docker 安装

```bash
# Dockerfile 中使用 PM2
# FROM node:22-alpine
# RUN npm install -g pm2
# WORKDIR /app
# COPY package.json pnpm-lock.yaml ./
# RUN pnpm install --frozen-lockfile
# COPY . .
# EXPOSE 3000
# CMD ["pm2-runtime", "ecosystem.config.js"]

# 注意：Docker 中使用 pm2-runtime 而非 pm2 start
# pm2-runtime 保持前台运行，适合容器环境
```

## 开机自启配置

```bash
# 生成自启脚本（自动检测系统类型）
pm2 startup

# 根据输出执行命令，例如：
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy

# 保存当前进程列表（开机恢复）
pm2 save

# 手动取消自启
pm2 unstartup systemd
```

## 安装后验证

```bash
# 版本信息
pm2 --version

# 启动测试应用
echo "const http = require('http');
http.createServer((req, res) => {
  res.end('PM2 Test OK');
}).listen(3000);" > /tmp/pm2-test.js

pm2 start /tmp/pm2-test.js --name test-app

# 查看状态
pm2 list
pm2 show test-app

# 测试访问
curl http://localhost:3000

# 清理
pm2 delete test-app
rm /tmp/pm2-test.js
```

## 常用命令速查

```bash
# 启动应用
pm2 start app.js
pm2 start app.js --name my-app
pm2 start app.js -i max          # Cluster 模式（利用所有 CPU）

# 管理进程
pm2 list                          # 查看所有进程
pm2 show <app>                    # 详细信息
pm2 restart <app>                 # 重启
pm2 reload <app>                  # 零停机重载
pm2 stop <app>                    # 停止
pm2 delete <app>                  # 删除

# 日志
pm2 logs                          # 查看所有日志
pm2 logs <app>                    # 查看特定应用日志
pm2 logs --lines 100              # 查看最近 100 行

# 监控
pm2 monit                         # 实时监控面板
pm2 status                        # 状态总览
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| PM2 主目录 | `~/.pm2/` |
| 进程列表 | `~/.pm2/dump.pm2` |
| 日志目录 | `~/.pm2/logs/` |
| PID 文件 | `~/.pm2/pids/` |
| 模块目录 | `~/.pm2/modules/` |
| PM2 守护进程日志 | `~/.pm2/pm2.log` |
| 配置文件 | `ecosystem.config.js`（项目根目录） |

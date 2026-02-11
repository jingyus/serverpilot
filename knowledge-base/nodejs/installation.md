# Node.js 安装指南

## 安装

Node.js 是基于 Chrome V8 引擎的 JavaScript 运行时，用于构建高性能服务端应用。推荐使用 LTS（长期支持）版本用于生产环境。

## 使用 nvm 安装（推荐）

nvm（Node Version Manager）允许在同一系统上安装和切换多个 Node.js 版本。

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# 重新加载 shell 配置
source ~/.bashrc  # 或 source ~/.zshrc

# 安装最新 LTS 版本
nvm install --lts

# 安装指定版本
nvm install 22

# 切换版本
nvm use 22

# 设置默认版本
nvm alias default 22

# 查看已安装版本
nvm ls

# 查看可安装版本
nvm ls-remote --lts
```

## Ubuntu/Debian 安装

### 使用 NodeSource 仓库

```bash
# 安装 Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v
npm -v
```

### 使用系统包管理器

```bash
# 安装（版本可能较旧）
sudo apt update
sudo apt install -y nodejs npm
```

## CentOS/RHEL 安装

```bash
# 使用 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# 验证
node -v
npm -v
```

## Alpine Linux 安装

```bash
apk add nodejs npm
```

## 包管理器安装

### pnpm（推荐用于 Monorepo）

```bash
# 使用 corepack（Node.js 16.9+ 内置）
corepack enable
corepack prepare pnpm@latest --activate

# 或独立安装
npm install -g pnpm

# 验证
pnpm -v
```

### yarn

```bash
# 使用 corepack
corepack enable
corepack prepare yarn@stable --activate

# 或 npm 安装
npm install -g yarn
```

## 安装后验证

```bash
# 查看版本
node -v
npm -v

# 测试执行
node -e "console.log('Node.js is working!')"

# 查看安装路径
which node
which npm

# 查看全局包安装路径
npm root -g
```

## 生产环境部署

### 使用 PM2 进程管理

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start dist/index.js --name myapp

# 设置开机自启
pm2 startup
pm2 save

# 常用命令
pm2 list        # 查看所有进程
pm2 logs myapp  # 查看日志
pm2 restart myapp
pm2 stop myapp
pm2 delete myapp
pm2 monit       # 实时监控
```

### 使用 systemd 管理

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Node.js App
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable myapp
sudo systemctl start myapp
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| nvm 目录 | `~/.nvm/` |
| 全局 npm 包 | `/usr/lib/node_modules/` 或 `~/.nvm/versions/node/<version>/lib/node_modules/` |
| npm 缓存 | `~/.npm/` |
| pnpm 存储 | `~/.local/share/pnpm/store/` |
| npm 配置 | `~/.npmrc` |

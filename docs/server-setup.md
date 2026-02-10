# 服务器准备指南

> AI Installer 云服务器部署文档
> 最后更新: 2026-02-07

## 📋 概述

本文档描述如何准备和配置 AI Installer 的生产环境服务器。

## 🎯 目标

1. 购买并配置云服务器
2. 配置域名解析
3. 配置基础安全设置
4. 验证服务器可访问性

## 🛠️ 服务器要求

### 最低配置

- **CPU**: 2 核心
- **内存**: 2 GB RAM
- **存储**: 20 GB SSD
- **网络**: 2 TB 月流量
- **操作系统**: Ubuntu 22.04 LTS

### 推荐配置

- **CPU**: 2 核心
- **内存**: 4 GB RAM
- **存储**: 40 GB SSD
- **网络**: 3 TB 月流量
- **操作系统**: Ubuntu 22.04 LTS

## 🌏 推荐服务商

### Vultr (推荐)

**优点**:
- 日本东京机房延迟低
- 按小时计费，灵活
- 价格实惠（$6/月起）
- 易于使用的控制面板

**购买链接**: https://www.vultr.com/

**推荐套餐**:
- Cloud Compute - Regular Performance
- 2 CPU, 4GB RAM, 80GB SSD - $12/月
- 位置: Tokyo, Japan

### DigitalOcean (备选)

**优点**:
- 稳定性好
- 文档丰富
- 社区活跃

**购买链接**: https://www.digitalocean.com/

**推荐套餐**:
- Basic Droplet
- 2 vCPUs, 4GB RAM, 80GB SSD - $24/月
- 位置: Singapore (日本机房较贵)

### 其他备选

- AWS Lightsail (适合企业)
- Linode (性价比高)
- 阿里云/腾讯云 (国内访问快，但需要备案)

## 📝 购买步骤

### Step 1: 注册账号

1. 访问服务商官网
2. 注册账号并验证邮箱
3. 添加支付方式（信用卡/PayPal）

### Step 2: 创建服务器实例

#### Vultr 创建步骤

1. 登录 Vultr 控制面板
2. 点击 "Deploy New Server"
3. 选择配置：
   - **Server Type**: Cloud Compute - Regular Performance
   - **Location**: Tokyo, Japan
   - **Operating System**: Ubuntu 22.04 LTS x64
   - **Server Size**: 4 GB RAM / 2 CPUs / 80 GB SSD ($12/月)
   - **Additional Features**:
     - ✅ Enable IPv6
     - ✅ Enable Auto Backups (可选，+$1.2/月)
   - **Server Hostname**: `aiinstaller-prod`
   - **Server Label**: `AI Installer Production Server`
4. 点击 "Deploy Now"

#### DigitalOcean 创建步骤

1. 登录 DigitalOcean 控制面板
2. 点击 "Create" → "Droplets"
3. 选择配置：
   - **Image**: Ubuntu 22.04 LTS
   - **Droplet Type**: Basic
   - **CPU Options**: Regular - 2 vCPUs, 4GB RAM
   - **Datacenter Region**: Singapore
   - **Authentication**: SSH Key (推荐) 或 Password
   - **Hostname**: `aiinstaller-prod`
4. 点击 "Create Droplet"

### Step 3: 记录服务器信息

创建完成后，记录以下信息：

```bash
# 服务器 IP 地址
SERVER_IP=<your_server_ip>

# SSH 登录信息
SSH_USER=root
SSH_PORT=22

# 服务器位置
SERVER_LOCATION=Tokyo, Japan
```

## 🔐 SSH 连接配置

### 方式 1: 密码登录（不推荐）

```bash
ssh root@<SERVER_IP>
# 输入密码
```

### 方式 2: SSH 密钥登录（推荐）

#### 生成 SSH 密钥（本地）

```bash
# 生成新密钥
ssh-keygen -t ed25519 -C "aiinstaller-prod" -f ~/.ssh/aiinstaller_prod

# 查看公钥
cat ~/.ssh/aiinstaller_prod.pub
```

#### 添加公钥到服务器

**方式 A: 通过服务商控制面板**
1. 复制公钥内容
2. 在服务商控制面板添加 SSH Key
3. 创建服务器时选择该密钥

**方式 B: 手动添加**
```bash
# 首次使用密码登录
ssh root@<SERVER_IP>

# 添加公钥
mkdir -p ~/.ssh
echo "<你的公钥内容>" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

#### 配置 SSH 客户端（本地）

编辑 `~/.ssh/config`:

```bash
Host aiinstaller-prod
    HostName <SERVER_IP>
    User root
    Port 22
    IdentityFile ~/.ssh/aiinstaller_prod
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

连接测试:
```bash
ssh aiinstaller-prod
```

## 🌐 域名配置

### Step 1: 购买域名

推荐域名注册商:
- **Cloudflare Registrar** (推荐，价格透明)
- **Namecheap**
- **GoDaddy**

域名选择:
- 主域名: `aiinstaller.dev`
- API 子域名: `api.aiinstaller.dev`

### Step 2: 配置 DNS 解析

#### 使用 Cloudflare DNS（推荐）

1. 登录 Cloudflare
2. 添加站点: `aiinstaller.dev`
3. 按提示修改域名 Nameservers
4. 添加 DNS 记录:

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| A | api | `<SERVER_IP>` | ✅ Proxied | Auto |
| AAAA | api | `<SERVER_IPv6>` | ✅ Proxied | Auto |

**优点**:
- 免费 CDN 加速
- 自动 DDoS 防护
- 免费 SSL 证书
- 隐藏真实服务器 IP

#### 使用域名注册商 DNS

在域名注册商控制面板添加记录:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | api | `<SERVER_IP>` | 600 |
| AAAA | api | `<SERVER_IPv6>` | 600 |

### Step 3: 验证 DNS 解析

```bash
# 查询 DNS 记录
dig api.aiinstaller.dev

# 或使用 nslookup
nslookup api.aiinstaller.dev

# 预期输出包含服务器 IP
```

**注意**: DNS 传播需要 10 分钟 ~ 48 小时不等。

## 🔒 基础安全配置

连接到服务器后执行:

### 1. 更新系统

```bash
apt update && apt upgrade -y
```

### 2. 配置防火墙

```bash
# 安装 UFW
apt install ufw -y

# 允许 SSH
ufw allow 22/tcp

# 允许 HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# 允许 WebSocket（如果不使用 Nginx 反向代理）
# ufw allow 3000/tcp

# 启用防火墙
ufw --force enable

# 查看状态
ufw status
```

### 3. 禁用 Root 密码登录（推荐）

仅在配置好 SSH 密钥后执行:

```bash
# 编辑 SSH 配置
nano /etc/ssh/sshd_config

# 修改以下配置
PasswordAuthentication no
PermitRootLogin prohibit-password

# 重启 SSH 服务
systemctl restart sshd
```

### 4. 配置自动安全更新

```bash
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

### 5. 安装必要工具

```bash
# 基础工具
apt install -y curl wget git htop vim

# Docker（用于后续部署）
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Docker Compose
apt install -y docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

## ✅ 验收测试

### 1. 网络连通性测试

```bash
# 从本地 ping 服务器 IP
ping <SERVER_IP>

# 预期: 收到回复，延迟 < 100ms（日本机房）
```

### 2. 域名解析测试

```bash
# 从本地 ping 域名
ping api.aiinstaller.dev

# 预期: 解析到服务器 IP
```

### 3. SSH 连接测试

```bash
# 使用配置的别名连接
ssh aiinstaller-prod

# 预期: 成功登录，无需输入密码
```

### 4. 防火墙测试

```bash
# 在服务器上查看防火墙状态
ufw status verbose

# 预期: Active，22/80/443 端口开放
```

### 5. Docker 测试

```bash
# 在服务器上运行测试容器
docker run hello-world

# 预期: 成功拉取并运行
```

## 📊 服务器信息模板

完成配置后，填写以下信息:

```yaml
# 服务器信息
server:
  provider: Vultr / DigitalOcean
  location: Tokyo, Japan
  ip: <SERVER_IP>
  ipv6: <SERVER_IPv6>
  hostname: aiinstaller-prod

# SSH 配置
ssh:
  user: root
  port: 22
  key_file: ~/.ssh/aiinstaller_prod

# 域名配置
domain:
  main: aiinstaller.dev
  api: api.aiinstaller.dev
  dns_provider: Cloudflare

# 服务器规格
specs:
  cpu: 2 cores
  ram: 4 GB
  storage: 80 GB SSD
  bandwidth: 3 TB/month

# 软件版本
software:
  os: Ubuntu 22.04 LTS
  docker: 24.x
  docker_compose: 2.x
```

将此信息保存到 `~/.aiinstaller/server-config.yaml`

## 🔄 下一步

服务器准备完成后，继续：

1. [Docker Compose 部署](./deployment.md#docker-compose-部署)
2. [SSL/WSS 配置](./deployment.md#ssl-wss-配置)
3. [监控和日志配置](./monitoring.md)

## 🆘 常见问题

### Q1: SSH 连接超时？

**原因**:
- 防火墙阻止 22 端口
- SSH 服务未启动
- IP 地址错误

**解决**:
```bash
# 在服务商控制面板检查:
# 1. 防火墙规则是否允许 SSH
# 2. 服务器状态是否为 Running
# 3. IP 地址是否正确
```

### Q2: DNS 解析失败？

**原因**:
- DNS 记录未生效（传播中）
- DNS 记录配置错误
- 本地 DNS 缓存

**解决**:
```bash
# 清除本地 DNS 缓存
# macOS
sudo dscacheutil -flushcache

# Linux
sudo systemd-resolve --flush-caches

# 使用其他 DNS 查询
dig @8.8.8.8 api.aiinstaller.dev
```

### Q3: 服务器无法访问某些网站？

**原因**:
- 服务器位置限制
- 防火墙规则

**解决**:
```bash
# 测试网络连通性
curl -I https://www.google.com
curl -I https://api.anthropic.com

# 如果需要代理，配置环境变量
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
```

## 📚 参考资源

- [Vultr 官方文档](https://www.vultr.com/docs/)
- [DigitalOcean 教程](https://www.digitalocean.com/community/tutorials)
- [Ubuntu Server 指南](https://ubuntu.com/server/docs)
- [Cloudflare DNS 文档](https://developers.cloudflare.com/dns/)
- [UFW 防火墙指南](https://help.ubuntu.com/community/UFW)

---

**完成时间**: 预计 0.3 天（约 2-3 小时）
**难度**: ⭐⭐ (简单，主要是等待和配置)

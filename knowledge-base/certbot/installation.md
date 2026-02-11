# Certbot 安装指南

## 安装

Certbot 是 Let's Encrypt 官方推荐的 ACME 客户端，用于自动获取和续期免费 SSL/TLS 证书。支持 Nginx、Apache 等 Web 服务器的自动配置，以及 DNS 验证方式获取通配符证书。

## Ubuntu/Debian 安装

### 使用 snap（推荐）

```bash
# 安装 snapd
sudo apt update
sudo apt install -y snapd

# 安装 Certbot
sudo snap install --classic certbot

# 创建命令链接
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# 验证
certbot --version
```

### 使用 APT

```bash
# 安装 Certbot 及 Nginx 插件
sudo apt update
sudo apt install -y certbot python3-certbot-nginx

# 或 Apache 插件
# sudo apt install -y certbot python3-certbot-apache

# 验证
certbot --version
```

## CentOS/RHEL 安装

### 使用 snap（推荐）

```bash
# 安装 snapd
sudo dnf install -y epel-release
sudo dnf install -y snapd
sudo systemctl enable --now snapd.socket
sudo ln -s /var/lib/snapd/snap /snap

# 安装 Certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

### 使用 DNF

```bash
# CentOS 8 / RHEL 8+
sudo dnf install -y epel-release
sudo dnf install -y certbot python3-certbot-nginx

# 验证
certbot --version
```

## macOS 安装

```bash
# 使用 Homebrew
brew install certbot

# 验证
certbot --version
```

## Docker 安装

```bash
# 获取证书
docker run -it --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -p 80:80 \
  certbot/certbot certonly --standalone \
  -d example.com -d www.example.com

# DNS 验证（通配符证书）
docker run -it --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --manual \
  --preferred-challenges dns \
  -d "*.example.com" -d example.com
```

## pip 安装

```bash
# 使用 Python pip（通用方法）
python3 -m venv /opt/certbot
/opt/certbot/bin/pip install certbot certbot-nginx

# 创建链接
sudo ln -s /opt/certbot/bin/certbot /usr/bin/certbot

# 验证
certbot --version
```

## 快速获取证书

### Nginx 自动配置

```bash
# 自动获取并配置证书
sudo certbot --nginx -d example.com -d www.example.com

# 仅获取证书（不修改 Nginx 配置）
sudo certbot certonly --nginx -d example.com
```

### Apache 自动配置

```bash
# 自动获取并配置证书
sudo certbot --apache -d example.com -d www.example.com
```

### Standalone 模式

```bash
# 停止 Web 服务器后使用（Certbot 临时监听 80 端口）
sudo systemctl stop nginx
sudo certbot certonly --standalone -d example.com
sudo systemctl start nginx
```

### Webroot 模式

```bash
# 不停止 Web 服务器
sudo certbot certonly --webroot \
  -w /var/www/html \
  -d example.com -d www.example.com
```

## 安装后验证

```bash
# 查看版本
certbot --version

# 查看已安装的证书
sudo certbot certificates

# 测试自动续期
sudo certbot renew --dry-run

# 验证证书信息
sudo openssl x509 -in /etc/letsencrypt/live/example.com/fullchain.pem -text -noout | head -20

# 检查证书到期时间
sudo openssl x509 -in /etc/letsencrypt/live/example.com/cert.pem -enddate -noout
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 证书存储 | `/etc/letsencrypt/live/<domain>/` |
| 证书文件 | `/etc/letsencrypt/live/<domain>/fullchain.pem` |
| 私钥文件 | `/etc/letsencrypt/live/<domain>/privkey.pem` |
| 证书链 | `/etc/letsencrypt/live/<domain>/chain.pem` |
| 续期配置 | `/etc/letsencrypt/renewal/<domain>.conf` |
| 账户信息 | `/etc/letsencrypt/accounts/` |
| 日志文件 | `/var/log/letsencrypt/letsencrypt.log` |

# Certbot 常用配置模板

## 自动续期配置

### systemd 定时器（推荐）

```ini
# /etc/systemd/system/certbot-renew.timer
[Unit]
Description=Certbot Renewal Timer

[Timer]
OnCalendar=*-*-* 02,14:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/certbot-renew.service
[Unit]
Description=Certbot Renewal
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

```bash
# 启用定时器
sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer

# 查看定时器状态
sudo systemctl list-timers certbot-renew.timer
```

### cron 定时任务

```bash
# 添加 crontab 条目
echo "0 3,15 * * * root certbot renew --quiet --deploy-hook 'systemctl reload nginx'" | \
  sudo tee /etc/cron.d/certbot-renew

# 或使用 crontab -e
# 0 3,15 * * * /usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

## Nginx SSL 配置模板

### 基础 HTTPS 配置

```nginx
# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name example.com www.example.com;

    # Certbot webroot 验证目录
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    # Let's Encrypt 证书
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # SSL 参数（Mozilla Intermediate）
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # Session 配置
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    root /var/www/html;
    index index.html;
}
```

### 多域名配置

```bash
# 获取多域名证书
sudo certbot --nginx \
  -d example.com \
  -d www.example.com \
  -d api.example.com \
  -d admin.example.com
```

## 通配符证书（DNS 验证）

### 手动 DNS 验证

```bash
# 获取通配符证书
sudo certbot certonly --manual \
  --preferred-challenges dns \
  -d "*.example.com" \
  -d example.com

# 按提示在 DNS 中添加 TXT 记录：
# _acme-challenge.example.com → <提供的值>

# 验证 DNS 记录
dig _acme-challenge.example.com TXT
```

### Cloudflare DNS 插件（自动）

```bash
# 安装插件
sudo snap install certbot-dns-cloudflare

# 或 pip 安装
# pip install certbot-dns-cloudflare

# 创建凭据文件
sudo mkdir -p /etc/letsencrypt/credentials
cat <<'EOF' | sudo tee /etc/letsencrypt/credentials/cloudflare.ini
dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
EOF
sudo chmod 600 /etc/letsencrypt/credentials/cloudflare.ini

# 获取通配符证书（自动验证）
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/credentials/cloudflare.ini \
  -d "*.example.com" \
  -d example.com
```

### 阿里云 DNS 插件

```bash
# 安装插件
pip install certbot-dns-aliyun

# 创建凭据文件
cat <<'EOF' | sudo tee /etc/letsencrypt/credentials/aliyun.ini
dns_aliyun_access_key = YOUR_ACCESS_KEY
dns_aliyun_access_key_secret = YOUR_SECRET_KEY
EOF
sudo chmod 600 /etc/letsencrypt/credentials/aliyun.ini

# 获取证书
sudo certbot certonly \
  --authenticator dns-aliyun \
  --dns-aliyun-credentials /etc/letsencrypt/credentials/aliyun.ini \
  -d "*.example.com"
```

## 续期钩子脚本

### deploy-hook 示例

```bash
#!/bin/bash
# /etc/letsencrypt/renewal-hooks/deploy/reload-services.sh

# 重载 Nginx
systemctl reload nginx

# 重载其他使用证书的服务
# systemctl restart postfix
# systemctl restart dovecot

# 通知管理员
# echo "SSL 证书已续期: $(date)" | mail -s "SSL Renewed" admin@example.com

echo "证书续期完成: $(date)" >> /var/log/certbot-deploy.log
```

```bash
# 设置可执行权限
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-services.sh
```

### pre-hook / post-hook

```bash
# 续期前停止服务（standalone 模式）
# /etc/letsencrypt/renewal-hooks/pre/stop-nginx.sh
#!/bin/bash
systemctl stop nginx

# 续期后启动服务
# /etc/letsencrypt/renewal-hooks/post/start-nginx.sh
#!/bin/bash
systemctl start nginx
```

## 证书管理命令

```bash
# 查看所有证书
sudo certbot certificates

# 续期所有证书
sudo certbot renew

# 续期单个域名
sudo certbot renew --cert-name example.com

# 测试续期（不实际执行）
sudo certbot renew --dry-run

# 撤销证书
sudo certbot revoke --cert-path /etc/letsencrypt/live/example.com/cert.pem

# 删除证书
sudo certbot delete --cert-name example.com

# 扩展域名
sudo certbot --expand -d example.com -d www.example.com -d new.example.com
```

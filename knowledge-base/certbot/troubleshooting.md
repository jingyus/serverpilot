# Certbot 故障排查与安全加固

## 常见故障排查

### 1. 证书获取失败 - HTTP 验证错误

**症状**: `Challenge failed for domain example.com`

```bash
# 检查 80 端口是否可达
curl -I http://example.com/.well-known/acme-challenge/test

# 检查 DNS 解析
dig example.com A
nslookup example.com

# 检查防火墙
sudo iptables -L -n | grep 80
sudo ufw status

# 检查 Nginx/Apache 配置
# 确保 /.well-known/acme-challenge/ 路径可访问
sudo nginx -t

# 使用 verbose 模式获取详细错误
sudo certbot certonly --nginx -d example.com -v

# 常见原因：
# - 80 端口未开放或被防火墙阻断
# - DNS 未指向服务器 IP
# - Nginx 配置错误导致验证路径不可达
# - CDN/代理缓存了验证请求
# - Let's Encrypt 速率限制
```

### 2. 自动续期失败

**症状**: 证书过期，续期任务未执行或报错

```bash
# 手动测试续期
sudo certbot renew --dry-run

# 查看续期日志
sudo tail -100 /var/log/letsencrypt/letsencrypt.log

# 检查定时器状态
sudo systemctl status certbot.timer
sudo systemctl list-timers | grep certbot

# 检查 cron 任务
sudo cat /etc/cron.d/certbot
crontab -l | grep certbot

# 检查证书到期时间
sudo certbot certificates

# 强制续期
sudo certbot renew --force-renewal

# 常见原因：
# - 定时器/cron 未启用
# - 80 端口被其他服务占用
# - DNS 记录已变更
# - 账户密钥丢失或损坏
# - 速率限制（每周 5 次/域名）
```

### 3. Nginx SSL 配置错误

**症状**: HTTPS 访问报错或证书不匹配

```bash
# 测试 Nginx 配置语法
sudo nginx -t

# 检查证书文件是否存在
sudo ls -la /etc/letsencrypt/live/example.com/

# 验证证书链完整性
sudo openssl verify -CAfile /etc/letsencrypt/live/example.com/chain.pem \
  /etc/letsencrypt/live/example.com/cert.pem

# 检查证书域名
sudo openssl x509 -in /etc/letsencrypt/live/example.com/cert.pem -text -noout | grep -A1 "Subject Alternative Name"

# 测试 SSL 连接
openssl s_client -connect example.com:443 -servername example.com </dev/null

# 常见原因：
# - 证书路径错误（使用符号链接路径 /etc/letsencrypt/live/）
# - fullchain.pem vs cert.pem 混淆
# - 证书域名与 server_name 不匹配
# - 私钥与证书不配对
```

### 4. DNS 验证失败（通配符证书）

**症状**: DNS-01 challenge failed

```bash
# 检查 TXT 记录是否生效
dig _acme-challenge.example.com TXT

# 使用不同 DNS 服务器验证
dig @8.8.8.8 _acme-challenge.example.com TXT
dig @1.1.1.1 _acme-challenge.example.com TXT

# 等待 DNS 传播（可能需要几分钟）
# 使用 --dns-propagation-seconds 参数
sudo certbot certonly --manual \
  --preferred-challenges dns \
  --manual-auth-hook /path/to/auth-hook.sh \
  --manual-cleanup-hook /path/to/cleanup-hook.sh \
  -d "*.example.com"

# 常见原因：
# - DNS 记录未添加或有误
# - DNS 传播延迟
# - DNS API 凭据错误（自动插件）
# - 旧 TXT 记录未清理
```

### 5. 速率限制

**症状**: `Error creating new order :: too many certificates`

```bash
# 查看当前证书发放情况
# 访问 https://crt.sh/?q=example.com

# Let's Encrypt 速率限制：
# - 每个注册域名每周 50 个证书
# - 每个账户每 3 小时 300 次新订单
# - 重复证书每周限制 5 次
# - 验证失败每小时限制 5 次

# 使用 staging 环境测试（无速率限制）
sudo certbot certonly --nginx -d example.com --staging

# 通过测试后再获取正式证书
sudo certbot certonly --nginx -d example.com --force-renewal

# 常见原因：
# - 短时间内重复申请
# - 测试时未使用 staging 环境
# - 脚本自动化未加速率控制
```

### 6. 权限问题

**症状**: `Permission denied` 读取证书文件

```bash
# 检查证书文件权限
sudo ls -la /etc/letsencrypt/live/example.com/
sudo ls -la /etc/letsencrypt/archive/example.com/

# 修复权限
sudo chmod 755 /etc/letsencrypt/live/
sudo chmod 755 /etc/letsencrypt/archive/

# 为特定服务授权读取
# 方法 1：添加用户到 ssl-cert 组
sudo usermod -a -G ssl-cert www-data

# 方法 2：使用 deploy-hook 复制证书
# certbot renew --deploy-hook "cp /etc/letsencrypt/live/example.com/*.pem /etc/myapp/ssl/ && chown myapp:myapp /etc/myapp/ssl/*.pem"
```

## 安全加固

### SSL 安全评级优化

```nginx
# 获取 A+ 评级的 Nginx 配置

# SSL 协议版本
ssl_protocols TLSv1.2 TLSv1.3;

# 密码套件
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;

# HSTS（强制 HTTPS 2年）
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

# OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/letsencrypt/live/example.com/chain.pem;

# DH 参数（可选，增强前向保密）
# 生成：openssl dhparam -out /etc/nginx/dhparam.pem 2048
ssl_dhparam /etc/nginx/dhparam.pem;

# Session
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
```

### 证书监控

```bash
#!/bin/bash
# /usr/local/bin/check-ssl-expiry.sh
# 检查证书到期时间并告警

DOMAINS="example.com www.example.com api.example.com"
WARN_DAYS=14

for domain in $DOMAINS; do
  expiry=$(sudo openssl x509 -in /etc/letsencrypt/live/$domain/cert.pem -enddate -noout 2>/dev/null | cut -d= -f2)
  if [ -n "$expiry" ]; then
    expiry_epoch=$(date -d "$expiry" +%s)
    now_epoch=$(date +%s)
    days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
    if [ $days_left -lt $WARN_DAYS ]; then
      echo "WARNING: $domain 证书将在 ${days_left} 天后过期！"
    else
      echo "OK: $domain 证书剩余 ${days_left} 天"
    fi
  fi
done
```

### 安全检查

```bash
# 在线测试 SSL 评级
# https://www.ssllabs.com/ssltest/

# 本地测试
openssl s_client -connect example.com:443 -servername example.com </dev/null 2>/dev/null | \
  openssl x509 -noout -dates

# 检查证书链
openssl s_client -connect example.com:443 -showcerts </dev/null 2>/dev/null

# 检查 HSTS
curl -sI https://example.com | grep -i strict

# 检查 OCSP
openssl s_client -connect example.com:443 -status </dev/null 2>/dev/null | grep -A5 "OCSP Response"
```

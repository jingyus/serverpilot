# Nginx 故障排查与最佳实践

## 常见故障排查

### 1. 配置语法错误

**症状**: Nginx 无法启动或 reload 失败

```bash
# 测试配置文件语法
sudo nginx -t

# 输出示例（有错误）
# nginx: [emerg] unknown directive "proxypass" in /etc/nginx/conf.d/default.conf:10
# nginx: configuration file /etc/nginx/nginx.conf test failed
```

**解决方案**: 根据错误提示定位文件和行号，修正语法。常见错误包括：
- 缺少分号 `;`
- 指令拼写错误（如 `proxypass` 应为 `proxy_pass`）
- 缺少大括号 `{}`
- `include` 路径不存在

### 2. 端口被占用

**症状**: `bind() to 0.0.0.0:80 failed (98: Address already in use)`

```bash
# 查看端口占用
sudo lsof -i :80
sudo ss -tlnp | grep :80

# 停止占用进程或修改 Nginx 监听端口
sudo systemctl stop apache2  # 如果是 Apache 占用
```

### 3. 权限问题

**症状**: `permission denied` 访问文件或日志

```bash
# 检查 Nginx 运行用户
ps aux | grep nginx

# 修复网站目录权限
sudo chown -R nginx:nginx /var/www/example.com
sudo chmod -R 755 /var/www/example.com

# 修复日志目录权限
sudo chown -R nginx:nginx /var/log/nginx
```

### 4. 502 Bad Gateway

**症状**: 反向代理返回 502 错误

**排查步骤**:
```bash
# 检查上游服务是否运行
curl -I http://127.0.0.1:3000

# 检查错误日志
sudo tail -50 /var/log/nginx/error.log

# 常见原因
# - 上游服务未启动
# - 上游服务地址/端口配置错误
# - 上游服务响应超时
# - SELinux 阻止网络连接
sudo setsebool -P httpd_can_network_connect 1  # CentOS/RHEL
```

### 5. 504 Gateway Timeout

**症状**: 请求超时返回 504

```nginx
# 增加超时时间
location /api/ {
    proxy_pass http://backend;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
}
```

### 6. 413 Request Entity Too Large

**症状**: 上传文件时返回 413 错误

```nginx
# 增加请求体大小限制（在 http/server/location 块中）
client_max_body_size 100m;
```

### 7. worker_connections 不足

**症状**: `worker_connections are not enough` 或连接被拒绝

```nginx
events {
    worker_connections 4096;  # 增加连接数
}
# 同时检查系统文件描述符限制
# ulimit -n
# 修改 /etc/security/limits.conf
```

## 性能优化

### 工作进程优化

```nginx
worker_processes auto;        # 自动匹配 CPU 核心数
worker_rlimit_nofile 65535;   # 文件描述符限制

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;                # Linux 最优事件模型
}
```

### 缓存优化

```nginx
# 打开文件缓存
open_file_cache max=10000 inactive=20s;
open_file_cache_valid 30s;
open_file_cache_min_uses 2;
open_file_cache_errors on;

# 代理缓存
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;

location /api/ {
    proxy_cache my_cache;
    proxy_cache_valid 200 10m;
    proxy_cache_valid 404 1m;
    proxy_cache_use_stale error timeout updating;
    add_header X-Cache-Status $upstream_cache_status;
}
```

### 日志优化

```nginx
# 关闭静态文件的访问日志
location ~* \.(css|js|jpg|png|gif|ico)$ {
    access_log off;
    expires 30d;
}

# 使用缓冲写入日志
access_log /var/log/nginx/access.log main buffer=32k flush=5s;
```

## 安全加固

### 隐藏版本信息

```nginx
server_tokens off;
```

### 安全响应头

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'" always;
```

### 限制 HTTP 方法

```nginx
if ($request_method !~ ^(GET|HEAD|POST|PUT|DELETE)$) {
    return 405;
}
```

### 防止目录遍历

```nginx
autoindex off;

location ~ /\. {
    deny all;
}
```

### 防止缓冲区溢出攻击

```nginx
client_body_buffer_size 1k;
client_header_buffer_size 1k;
client_max_body_size 10m;
large_client_header_buffers 4 8k;
```

## 常用运维命令

```bash
# 优雅重载配置（不中断服务）
sudo nginx -s reload

# 快速停止
sudo nginx -s stop

# 优雅停止（等待请求处理完）
sudo nginx -s quit

# 重新打开日志文件（日志轮转后使用）
sudo nginx -s reopen

# 查看连接状态（需要 stub_status 模块）
curl http://localhost/nginx_status

# 查看实时访问日志
sudo tail -f /var/log/nginx/access.log

# 查看实时错误日志
sudo tail -f /var/log/nginx/error.log

# 按错误类型统计
sudo awk '{print $NF}' /var/log/nginx/error.log | sort | uniq -c | sort -rn
```

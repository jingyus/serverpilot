# PHP 常用配置模板

## 配置

以下为 PHP 常用配置模板和 FPM 调优方案。

### php.ini 生产配置

```ini
; /etc/php/8.3/fpm/php.ini - 生产环境关键配置

[PHP]
; 错误处理
display_errors = Off
display_startup_errors = Off
error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT
log_errors = On
error_log = /var/log/php/error.log

; 资源限制
memory_limit = 256M
max_execution_time = 30
max_input_time = 60
max_input_vars = 3000
post_max_size = 64M
upload_max_filesize = 32M
max_file_uploads = 20

; 安全
expose_php = Off
allow_url_fopen = Off
allow_url_include = Off
disable_functions = exec,passthru,shell_exec,system,proc_open,popen
open_basedir = /var/www/html:/tmp

; 时区与编码
date.timezone = Asia/Shanghai
default_charset = "UTF-8"
mbstring.language = Neutral
mbstring.internal_encoding = UTF-8

; Session
session.save_handler = files
session.save_path = "/var/lib/php/sessions"
session.gc_maxlifetime = 1440
session.cookie_httponly = On
session.cookie_secure = On
session.cookie_samesite = Lax
session.use_strict_mode = On

[opcache]
opcache.enable = 1
opcache.memory_consumption = 128
opcache.interned_strings_buffer = 16
opcache.max_accelerated_files = 10000
opcache.revalidate_freq = 0
opcache.validate_timestamps = 0
opcache.save_comments = 1
opcache.jit = tracing
opcache.jit_buffer_size = 64M
```

## PHP-FPM 池配置

```ini
; /etc/php/8.3/fpm/pool.d/www.conf

[www]
user = www-data
group = www-data

; 监听方式
listen = /run/php/php8.3-fpm.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; 或使用 TCP
; listen = 127.0.0.1:9000

; 进程管理（dynamic 模式）
pm = dynamic
pm.max_children = 50
pm.start_servers = 10
pm.min_spare_servers = 5
pm.max_spare_servers = 20
pm.max_requests = 500
pm.process_idle_timeout = 10s

; 状态页
pm.status_path = /fpm-status
ping.path = /fpm-ping
ping.response = pong

; 日志
access.log = /var/log/php-fpm/access.log
access.format = "%R - %u %t \"%m %r\" %s %f %{mili}d %{kilo}M"
slowlog = /var/log/php-fpm/slow.log
request_slowlog_timeout = 5s
request_terminate_timeout = 30s

; 环境变量
env[DB_HOST] = localhost
env[DB_NAME] = myapp
```

## Nginx + PHP-FPM 配置

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;

        # 超时设置
        fastcgi_connect_timeout 60s;
        fastcgi_send_timeout 60s;
        fastcgi_read_timeout 60s;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    # 禁止直接访问 .env 等敏感文件
    location ~ /\.(env|git|htaccess) {
        deny all;
    }
}
```

## Laravel 配置模板

```nginx
server {
    listen 80;
    server_name app.example.com;
    root /var/www/laravel/public;
    index index.php;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }
}
```

## Redis Session 配置

```ini
; php.ini 中配置 Redis 作为 Session 存储
session.save_handler = redis
session.save_path = "tcp://127.0.0.1:6379?auth=your_password&database=0"

; 或使用 Unix socket
; session.save_path = "unix:///var/run/redis/redis.sock?database=0"
```

## 日志轮转配置

```
# /etc/logrotate.d/php-fpm
/var/log/php-fpm/*.log
/var/log/php/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        /usr/lib/php/php8.3-fpm-reopenlogs
    endscript
}
```

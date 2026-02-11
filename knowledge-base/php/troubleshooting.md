# PHP 故障排查与安全加固

## 常见故障排查

### 1. PHP-FPM 启动失败

**症状**: `systemctl start php8.3-fpm` 报错

```bash
# 查看详细错误
sudo journalctl -u php8.3-fpm -n 50
sudo php-fpm8.3 -t  # 测试配置语法

# 检查 socket 文件
ls -la /run/php/php8.3-fpm.sock

# 检查权限
namei -l /run/php/php8.3-fpm.sock

# 常见原因：
# - 配置语法错误
# - socket 目录不存在
# - 端口被占用
# - 用户/组不存在
```

### 2. 502 Bad Gateway

**症状**: Nginx 返回 502 错误

```bash
# 检查 PHP-FPM 是否运行
sudo systemctl status php8.3-fpm
ps aux | grep php-fpm

# 检查 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 检查 socket 连接
sudo ls -la /run/php/php8.3-fpm.sock

# 测试 PHP-FPM 响应
SCRIPT_NAME=/fpm-ping SCRIPT_FILENAME=/fpm-ping REQUEST_METHOD=GET \
  cgi-fcgi -bind -connect /run/php/php8.3-fpm.sock

# 常见原因：
# - PHP-FPM 未启动或崩溃
# - socket/端口不匹配
# - PHP-FPM 子进程全部繁忙
# - 脚本执行超时
```

### 3. 内存不足（Allowed memory size exhausted）

**症状**: `Fatal error: Allowed memory size of xxx bytes exhausted`

```bash
# 查看当前内存限制
php -r "echo ini_get('memory_limit');"

# 临时增加（代码中）
# ini_set('memory_limit', '512M');

# 修改 php.ini
sudo sed -i 's/memory_limit = .*/memory_limit = 512M/' /etc/php/8.3/fpm/php.ini
sudo systemctl reload php8.3-fpm

# 监控 PHP-FPM 内存
ps -eo pid,rss,command | grep php-fpm | sort -k2 -n

# 常见原因：
# - 大数据集一次性加载
# - 循环中创建大量对象
# - 图片处理未释放内存
# - Composer autoload 加载过多
```

### 4. 上传文件失败

**症状**: 文件上传返回错误或被截断

```bash
# 检查 PHP 上传配置
php -r "
echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
echo 'post_max_size: ' . ini_get('post_max_size') . PHP_EOL;
echo 'max_file_uploads: ' . ini_get('max_file_uploads') . PHP_EOL;
"

# 检查 Nginx 配置
# 确认 client_max_body_size 足够大

# 检查临时目录权限
php -r "echo sys_get_temp_dir();"
ls -la /tmp

# 常见原因：
# - upload_max_filesize 太小
# - post_max_size < upload_max_filesize
# - Nginx client_max_body_size 限制
# - /tmp 目录权限或空间不足
```

### 5. OPcache 缓存问题

**症状**: 代码更新后不生效

```bash
# 查看 OPcache 状态
php -r "print_r(opcache_get_status());"

# 重置 OPcache
# 方法 1：重启 PHP-FPM
sudo systemctl reload php8.3-fpm

# 方法 2：使用 cachetool
curl -sO https://gordalina.github.io/cachetool/downloads/cachetool.phar
php cachetool.phar opcache:reset --fcgi=/run/php/php8.3-fpm.sock

# 开发环境建议
# opcache.validate_timestamps = 1
# opcache.revalidate_freq = 0

# 常见原因：
# - validate_timestamps = 0（生产模式不检查文件变化）
# - 缓存未清理
# - 文件权限变化
```

### 6. 扩展缺失或加载失败

**症状**: `Class 'xxx' not found` 或扩展相关错误

```bash
# 列出已加载扩展
php -m

# 搜索可用扩展包
apt search php8.3- | grep -i <extension>

# 安装扩展
sudo apt install -y php8.3-<extension>

# 启用/禁用扩展
sudo phpenmod <extension>
sudo phpdismod <extension>

# 重启 FPM
sudo systemctl restart php8.3-fpm

# 验证
php -r "echo extension_loaded('<extension>') ? 'OK' : 'MISSING';"
```

## 性能优化

### FPM 进程调优

```bash
# 计算合理的 max_children
# 公式：可用内存 / 单个 PHP 进程平均内存
# 例：2GB 可用 / 40MB 每进程 = 50 个子进程

# 监控 FPM 状态
curl -s http://localhost/fpm-status | head -20

# 关键指标
# - active processes: 活跃进程数
# - idle processes: 空闲进程数
# - listen queue: 等待队列（应为 0）
# - max children reached: 达到上限次数（应为 0）
```

### OPcache 预加载

```php
// preload.php（PHP 7.4+）
// 在 php.ini 中设置：opcache.preload = /opt/myapp/preload.php
// opcache.preload_user = www-data

require_once '/opt/myapp/vendor/autoload.php';

// 预加载常用类
$files = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator('/opt/myapp/src')
);
foreach ($files as $file) {
    if ($file->getExtension() === 'php') {
        opcache_compile_file($file->getPathname());
    }
}
```

## 安全加固

### 生产环境安全配置

```ini
; php.ini 安全设置
expose_php = Off
display_errors = Off
log_errors = On
allow_url_fopen = Off
allow_url_include = Off
session.cookie_httponly = On
session.cookie_secure = On
session.use_strict_mode = On
session.cookie_samesite = Lax

; 禁用危险函数
disable_functions = exec,passthru,shell_exec,system,proc_open,popen,curl_exec,curl_multi_exec,parse_ini_file,show_source,eval

; 限制文件访问
open_basedir = /var/www/html:/tmp:/var/lib/php/sessions
```

### 文件权限

```bash
# Web 根目录权限
sudo chown -R www-data:www-data /var/www/html
sudo find /var/www/html -type d -exec chmod 755 {} \;
sudo find /var/www/html -type f -exec chmod 644 {} \;

# 配置文件保护
sudo chmod 600 /var/www/html/.env

# 禁止 PHP 在上传目录执行
# Nginx location 配置：
# location ~* /uploads/.*\.php$ { deny all; }
```

### 依赖安全审计

```bash
# Composer 安全检查
composer audit

# 更新到安全版本
composer update --with-all-dependencies

# 检查已知漏洞
composer require --dev roave/security-advisories:dev-latest
```

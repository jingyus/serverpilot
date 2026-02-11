# PHP 安装指南

## 安装

PHP 是广泛使用的服务器端脚本语言，主要用于 Web 开发。生产环境推荐使用 PHP 8.1+ 版本，配合 PHP-FPM 作为 FastCGI 进程管理器，与 Nginx 或 Apache 配合使用。

## Ubuntu/Debian 安装

### 使用 APT 包管理器

```bash
# 安装 PHP 及常用扩展
sudo apt update
sudo apt install -y php php-fpm php-cli php-common \
  php-mysql php-pgsql php-redis php-curl php-gd \
  php-mbstring php-xml php-zip php-intl php-bcmath

# 启动 PHP-FPM
sudo systemctl start php8.3-fpm
sudo systemctl enable php8.3-fpm

# 验证
php -v
php-fpm8.3 -v
```

### 使用 Ondrej PPA（最新版本）

```bash
# 添加 PPA
sudo add-apt-repository -y ppa:ondrej/php
sudo apt update

# 安装指定版本
sudo apt install -y php8.3 php8.3-fpm php8.3-cli \
  php8.3-mysql php8.3-pgsql php8.3-redis php8.3-curl \
  php8.3-gd php8.3-mbstring php8.3-xml php8.3-zip \
  php8.3-intl php8.3-bcmath php8.3-opcache

# 启动
sudo systemctl start php8.3-fpm
sudo systemctl enable php8.3-fpm
```

## CentOS/RHEL 安装

```bash
# 启用 Remi 仓库
sudo dnf install -y epel-release
sudo dnf install -y https://rpms.remirepo.net/enterprise/remi-release-$(rpm -E %rhel).rpm

# 启用 PHP 8.3 模块
sudo dnf module reset php
sudo dnf module enable php:remi-8.3

# 安装
sudo dnf install -y php php-fpm php-cli php-common \
  php-mysqlnd php-pgsql php-redis php-curl php-gd \
  php-mbstring php-xml php-zip php-intl php-bcmath php-opcache

# 启动
sudo systemctl start php-fpm
sudo systemctl enable php-fpm
```

## macOS 安装

```bash
# 使用 Homebrew
brew install php

# PHP-FPM 自动包含在内
brew services start php

# 验证
php -v
php-fpm -v
```

## Docker 安装

```bash
# PHP-FPM 容器
docker run -d \
  --name php-fpm \
  -v $(pwd):/var/www/html \
  php:8.3-fpm

# 带扩展的 Dockerfile
# FROM php:8.3-fpm
# RUN docker-php-ext-install pdo_mysql mbstring opcache
# RUN pecl install redis && docker-php-ext-enable redis
# COPY . /var/www/html
```

## Composer 安装

```bash
# 安装 Composer（PHP 包管理器）
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer

# 验证
composer --version

# 国内镜像加速
composer config -g repo.packagist composer https://mirrors.aliyun.com/composer/
```

## 安装后验证

```bash
# 版本信息
php -v
php -m  # 已加载模块列表

# 查看 PHP 配置
php --ini
php -i | grep "Loaded Configuration"

# 测试 PHP-FPM
sudo systemctl status php8.3-fpm
curl -I http://localhost  # 需配合 Nginx

# 测试基本功能
php -r "echo 'PHP ' . phpversion() . ' OK' . PHP_EOL;"
php -r "echo json_encode(['status' => 'ok']) . PHP_EOL;"
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| PHP CLI 配置 | `/etc/php/8.3/cli/php.ini` |
| PHP-FPM 配置 | `/etc/php/8.3/fpm/php.ini` |
| FPM 池配置 | `/etc/php/8.3/fpm/pool.d/www.conf` |
| 扩展配置 | `/etc/php/8.3/mods-available/` |
| 扩展目录 | `/usr/lib/php/20230831/` |
| Composer 全局 | `~/.config/composer/` |
| 日志文件 | `/var/log/php8.3-fpm.log` |

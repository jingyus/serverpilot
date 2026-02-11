# Nginx 安装指南

## 安装

Nginx 是高性能的 HTTP 和反向代理服务器，广泛用于 Web 服务、负载均衡和反向代理。

## Ubuntu/Debian 安装

### 使用 APT 包管理器

```bash
# 更新包索引
sudo apt update

# 安装 Nginx
sudo apt install -y nginx

# 启动并设置开机自启
sudo systemctl start nginx
sudo systemctl enable nginx

# 验证安装
nginx -v
sudo systemctl status nginx
```

### 安装官方最新稳定版

```bash
# 安装依赖
sudo apt install -y curl gnupg2 ca-certificates lsb-release

# 导入签名密钥（使用 signed-by 方式，apt-key 已弃用）
curl -fsSL https://nginx.org/keys/nginx_signing.key | sudo gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg

# 添加官方 APT 仓库
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu $(lsb_release -cs) nginx" | sudo tee /etc/apt/sources.list.d/nginx.list

# 更新并安装
sudo apt update
sudo apt install -y nginx
```

## CentOS/RHEL 安装

### 使用 YUM/DNF

```bash
# CentOS 7
sudo yum install -y epel-release
sudo yum install -y nginx

# CentOS 8 / RHEL 8+
sudo dnf install -y nginx

# 启动并设置开机自启
sudo systemctl start nginx
sudo systemctl enable nginx

# 开放防火墙端口
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 使用官方仓库

```bash
# 创建仓库文件
cat <<'EOF' | sudo tee /etc/yum.repos.d/nginx.repo
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/$releasever/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
EOF

sudo yum install -y nginx
```

## Alpine Linux 安装

```bash
# 安装 Nginx
apk add nginx

# 启动服务
rc-service nginx start
rc-update add nginx default
```

## 编译安装（自定义模块）

```bash
# 安装编译依赖
sudo apt install -y build-essential libpcre3 libpcre3-dev zlib1g zlib1g-dev libssl-dev libgd-dev

# 下载源码
wget http://nginx.org/download/nginx-1.26.0.tar.gz
tar -zxvf nginx-1.26.0.tar.gz
cd nginx-1.26.0

# 配置（根据需要增减模块）
./configure \
  --prefix=/etc/nginx \
  --sbin-path=/usr/sbin/nginx \
  --conf-path=/etc/nginx/nginx.conf \
  --error-log-path=/var/log/nginx/error.log \
  --http-log-path=/var/log/nginx/access.log \
  --pid-path=/var/run/nginx.pid \
  --with-http_ssl_module \
  --with-http_v2_module \
  --with-http_gzip_static_module \
  --with-http_stub_status_module

# 编译并安装
make -j$(nproc)
sudo make install
```

## 安装后验证

```bash
# 查看版本
nginx -v

# 查看编译参数
nginx -V

# 测试配置文件
sudo nginx -t

# 访问默认页面
curl -I http://localhost
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 主配置文件 | `/etc/nginx/nginx.conf` |
| 站点配置 | `/etc/nginx/conf.d/` 或 `/etc/nginx/sites-available/` |
| 默认网页根目录 | `/usr/share/nginx/html/` 或 `/var/www/html/` |
| 访问日志 | `/var/log/nginx/access.log` |
| 错误日志 | `/var/log/nginx/error.log` |
| PID 文件 | `/var/run/nginx.pid` |

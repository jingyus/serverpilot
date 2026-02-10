# MySQL 安装指南

## 概述

MySQL 是最流行的开源关系型数据库管理系统，广泛应用于 Web 应用和企业级系统。

## Ubuntu/Debian 安装

### 安装 MySQL 8.0

```bash
# 更新包索引
sudo apt update

# 安装 MySQL Server
sudo apt install -y mysql-server

# 启动服务
sudo systemctl start mysql
sudo systemctl enable mysql

# 运行安全初始化脚本
sudo mysql_secure_installation
# - 设置 root 密码
# - 移除匿名用户
# - 禁止 root 远程登录
# - 删除测试数据库
# - 重新加载权限表
```

### 使用官方 APT 仓库

```bash
# 下载 APT 仓库配置包
wget https://dev.mysql.com/get/mysql-apt-config_0.8.29-1_all.deb

# 安装配置包
sudo dpkg -i mysql-apt-config_0.8.29-1_all.deb

# 更新并安装
sudo apt update
sudo apt install -y mysql-server
```

## CentOS/RHEL 安装

### CentOS 7

```bash
# 添加 MySQL 官方仓库
sudo yum install -y https://dev.mysql.com/get/mysql80-community-release-el7-11.noarch.rpm

# 安装 MySQL Server
sudo yum install -y mysql-community-server

# 启动服务
sudo systemctl start mysqld
sudo systemctl enable mysqld

# 获取临时 root 密码
sudo grep 'temporary password' /var/log/mysqld.log

# 安全初始化
mysql_secure_installation
```

### CentOS 8 / RHEL 8+

```bash
# 安装 MySQL
sudo dnf install -y @mysql

# 或使用官方仓库
sudo dnf install -y https://dev.mysql.com/get/mysql80-community-release-el8-9.noarch.rpm
sudo dnf install -y mysql-community-server

# 启动服务
sudo systemctl start mysqld
sudo systemctl enable mysqld
```

## Alpine Linux 安装

```bash
apk add mysql mysql-client
mysql_install_db --user=mysql --datadir=/var/lib/mysql
rc-service mariadb start
rc-update add mariadb default
```

## Docker 安装

```bash
# 拉取镜像并运行
docker run -d \
  --name mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=myapp \
  -e MYSQL_USER=appuser \
  -e MYSQL_PASSWORD=app_password \
  -v mysql_data:/var/lib/mysql \
  mysql:8.0

# 连接测试
docker exec -it mysql mysql -u root -p
```

## 安装后验证

```bash
# 查看版本
mysql --version

# 登录 MySQL
mysql -u root -p

# 查看数据库列表
mysql -u root -p -e "SHOW DATABASES;"

# 查看服务状态
sudo systemctl status mysql

# 查看端口监听
sudo ss -tlnp | grep 3306
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 配置文件 | `/etc/mysql/my.cnf` 或 `/etc/my.cnf` |
| 附加配置目录 | `/etc/mysql/conf.d/` |
| 数据目录 | `/var/lib/mysql/` |
| 日志目录 | `/var/log/mysql/` |
| 错误日志 | `/var/log/mysql/error.log` |
| Socket 文件 | `/var/run/mysqld/mysqld.sock` |
| PID 文件 | `/var/run/mysqld/mysqld.pid` |

## 初始用户配置

```sql
-- 创建管理员用户（替代直接使用 root）
CREATE USER 'admin'@'localhost' IDENTIFIED BY 'StrongPassword123!';
GRANT ALL PRIVILEGES ON *.* TO 'admin'@'localhost' WITH GRANT OPTION;

-- 创建应用数据库和用户
CREATE DATABASE myapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'appuser'@'localhost' IDENTIFIED BY 'AppPassword123!';
GRANT SELECT, INSERT, UPDATE, DELETE ON myapp.* TO 'appuser'@'localhost';

FLUSH PRIVILEGES;
```

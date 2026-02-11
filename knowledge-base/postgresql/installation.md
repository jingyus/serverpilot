# PostgreSQL 安装指南

## 安装

PostgreSQL 是功能最强大的开源关系型数据库，支持复杂查询、事务、JSON、全文搜索等高级特性。

## Ubuntu/Debian 安装

### 使用 APT 包管理器

```bash
# 安装
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# 服务管理
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 验证
sudo -u postgres psql -c "SELECT version();"
```

### 安装指定版本（官方仓库）

```bash
# 导入签名密钥（使用 signed-by 方式，apt-key 已弃用）
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/pgdg-archive-keyring.gpg

# 添加 PostgreSQL 官方仓库
echo "deb [signed-by=/usr/share/keyrings/pgdg-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list

# 更新并安装指定版本
sudo apt update
sudo apt install -y postgresql-16

# 验证
psql --version
```

## CentOS/RHEL 安装

```bash
# 安装官方仓库
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# 禁用内置模块
sudo dnf -qy module disable postgresql

# 安装 PostgreSQL 16
sudo dnf install -y postgresql16-server postgresql16

# 初始化数据库
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb

# 启动服务
sudo systemctl start postgresql-16
sudo systemctl enable postgresql-16
```

## Alpine Linux 安装

```bash
apk add postgresql postgresql-contrib
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

# 初始化
su postgres -c "initdb -D /var/lib/postgresql/data"

# 启动
rc-service postgresql start
rc-update add postgresql default
```

## Docker 安装

```bash
docker run -d \
  --name postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=myapp \
  -e POSTGRES_USER=appuser \
  -v pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

# 连接测试
docker exec -it postgres psql -U appuser -d myapp
```

## 安装后初始化

```bash
# 切换到 postgres 用户
sudo -i -u postgres

# 创建数据库和用户
createuser --interactive --pwprompt appuser
createdb -O appuser myapp

# 或通过 SQL
psql <<EOF
CREATE USER appuser WITH PASSWORD 'SecurePassword123!';
CREATE DATABASE myapp OWNER appuser;
GRANT ALL PRIVILEGES ON DATABASE myapp TO appuser;
EOF
```

## 安装后验证

```bash
# 查看版本
psql --version

# 查看服务状态
sudo systemctl status postgresql

# 连接测试
sudo -u postgres psql -c "SELECT version();"

# 查看数据库列表
sudo -u postgres psql -l

# 查看监听端口
sudo ss -tlnp | grep 5432
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 主配置文件 | `/etc/postgresql/<version>/main/postgresql.conf` |
| 认证配置 | `/etc/postgresql/<version>/main/pg_hba.conf` |
| 数据目录 | `/var/lib/postgresql/<version>/main/` |
| 日志目录 | `/var/log/postgresql/` |
| Socket 目录 | `/var/run/postgresql/` |

> CentOS/RHEL 路径不同：`/var/lib/pgsql/<version>/data/`

## 远程连接配置

```bash
# 1. 修改 postgresql.conf
# listen_addresses = '*'

# 2. 修改 pg_hba.conf，添加远程访问规则
# host    myapp    appuser    10.0.0.0/24    scram-sha-256

# 3. 重启服务
sudo systemctl restart postgresql

# 4. 开放防火墙
sudo ufw allow 5432/tcp
```

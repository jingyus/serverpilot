# Redis 安装指南

## 安装

Redis 是高性能的内存数据结构存储，用作数据库、缓存、消息队列和会话存储。支持字符串、哈希、列表、集合、有序集合等数据类型。

## Ubuntu/Debian 安装

### 使用 APT 包管理器

```bash
# 安装
sudo apt update
sudo apt install -y redis-server

# 启动服务
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证
redis-cli ping
# 应返回 PONG
```

### 使用官方仓库（最新版本）

```bash
# 添加官方仓库
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

# 安装
sudo apt update
sudo apt install -y redis

# 启动
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

## CentOS/RHEL 安装

```bash
# CentOS 7
sudo yum install -y epel-release
sudo yum install -y redis

# CentOS 8 / RHEL 8+
sudo dnf install -y redis

# 启动服务
sudo systemctl start redis
sudo systemctl enable redis

# 开放防火墙（如需远程访问）
sudo firewall-cmd --permanent --add-port=6379/tcp
sudo firewall-cmd --reload
```

## Alpine Linux 安装

```bash
apk add redis
rc-service redis start
rc-update add redis default
```

## Docker 安装

```bash
# 基础运行
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:7-alpine

# 带持久化和密码
docker run -d \
  --name redis \
  -p 6379:6379 \
  -v redis_data:/data \
  redis:7-alpine redis-server \
    --requirepass your_password \
    --appendonly yes

# 连接测试
docker exec -it redis redis-cli
```

## 编译安装

```bash
# 下载源码
wget https://download.redis.io/redis-stable.tar.gz
tar -xzf redis-stable.tar.gz
cd redis-stable

# 编译
make -j$(nproc)
make test  # 可选

# 安装
sudo make install

# 使用安装脚本配置服务
sudo ./utils/install_server.sh
```

## 安装后验证

```bash
# 查看版本
redis-server --version
redis-cli --version

# 测试连接
redis-cli ping

# 查看服务信息
redis-cli INFO server

# 查看内存使用
redis-cli INFO memory

# 查看服务状态
sudo systemctl status redis-server
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 配置文件 | `/etc/redis/redis.conf` 或 `/etc/redis.conf` |
| 数据目录 | `/var/lib/redis/` |
| 日志文件 | `/var/log/redis/redis-server.log` |
| PID 文件 | `/var/run/redis/redis-server.pid` |
| RDB 快照 | `/var/lib/redis/dump.rdb` |
| AOF 文件 | `/var/lib/redis/appendonly.aof` |

## 基础连接测试

```bash
# 连接本地 Redis
redis-cli

# 连接远程 Redis
redis-cli -h <host> -p <port> -a <password>

# 基本操作
redis-cli SET test "hello"
redis-cli GET test
redis-cli DEL test
```

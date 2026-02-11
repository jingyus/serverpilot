# MongoDB 安装指南

## 概述

MongoDB 是面向文档的 NoSQL 数据库，使用 JSON 风格的 BSON 文档存储数据。适用于需要灵活 Schema、高并发读写和水平扩展的场景。生产环境推荐使用 MongoDB 7.0+ 版本。

## Ubuntu/Debian 安装

### 使用官方仓库

```bash
# 导入 GPG 密钥
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# 添加仓库（Ubuntu 22.04）
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# 安装
sudo apt update
sudo apt install -y mongodb-org

# 启动服务
sudo systemctl start mongod
sudo systemctl enable mongod

# 验证
mongosh --eval "db.runCommand({ ping: 1 })"
```

### Ubuntu 24.04

```bash
# 导入密钥
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# 添加仓库
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

sudo systemctl start mongod
sudo systemctl enable mongod
```

## CentOS/RHEL 安装

```bash
# 创建仓库文件
cat <<'EOF' | sudo tee /etc/yum.repos.d/mongodb-org-7.0.repo
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/$releasever/mongodb-org/7.0/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-7.0.asc
EOF

# 安装
sudo dnf install -y mongodb-org

# 启动
sudo systemctl start mongod
sudo systemctl enable mongod

# 开放防火墙
sudo firewall-cmd --permanent --add-port=27017/tcp
sudo firewall-cmd --reload
```

## macOS 安装

```bash
# 使用 Homebrew
brew tap mongodb/brew
brew install mongodb-community@7.0

# 启动服务
brew services start mongodb-community@7.0

# 验证
mongosh
```

## Docker 安装

```bash
# 基础运行
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -v mongo_data:/data/db \
  mongo:7

# 带认证
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  -v mongo_data:/data/db \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=your_password \
  mongo:7

# 连接测试
docker exec -it mongodb mongosh -u admin -p your_password
```

## 安装后验证

```bash
# 查看版本
mongosh --version
mongod --version

# 测试连接
mongosh --eval "db.runCommand({ ping: 1 })"

# 查看服务状态
sudo systemctl status mongod

# 查看数据库列表
mongosh --eval "show dbs"

# 基本 CRUD 测试
mongosh --eval "
  db = db.getSiblingDB('test');
  db.testcol.insertOne({ name: 'test', time: new Date() });
  print(JSON.stringify(db.testcol.findOne({ name: 'test' })));
  db.testcol.drop();
"
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 配置文件 | `/etc/mongod.conf` |
| 数据目录 | `/var/lib/mongodb/` |
| 日志文件 | `/var/log/mongodb/mongod.log` |
| PID 文件 | `/var/run/mongod.pid` |
| Socket 文件 | `/tmp/mongodb-27017.sock` |

## 远程连接配置

```bash
# 修改 mongod.conf 允许远程连接
# 将 bindIp 从 127.0.0.1 修改为 0.0.0.0
sudo sed -i 's/bindIp: 127.0.0.1/bindIp: 0.0.0.0/' /etc/mongod.conf
sudo systemctl restart mongod

# 远程连接（需先配置认证）
mongosh "mongodb://admin:password@<host>:27017/admin"
```

# MongoDB 常用配置模板

## 配置

以下为 MongoDB 常用配置模板和运维方案。

### 主配置文件

```yaml
# /etc/mongod.conf

# 存储引擎
storage:
  dbPath: /var/lib/mongodb
  engine: wiredTiger
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2          # 建议为可用内存的 50%
      journalCompressor: snappy
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true

# 日志
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
  logRotate: reopen
  verbosity: 0
  component:
    accessControl:
      verbosity: 1

# 网络
net:
  port: 27017
  bindIp: 127.0.0.1           # 生产环境限制绑定地址
  maxIncomingConnections: 65536
  compression:
    compressors: snappy,zstd,zlib

# 进程管理
processManagement:
  fork: true
  pidFilePath: /var/run/mongod.pid
  timeZoneInfo: /usr/share/zoneinfo

# 安全
security:
  authorization: enabled       # 启用认证
  # keyFile: /etc/mongodb/keyfile  # 副本集认证

# 操作分析
operationProfiling:
  mode: slowOp
  slowOpThresholdMs: 100

# 副本集
# replication:
#   replSetName: rs0
#   oplogSizeMB: 2048
```

## 用户与权限管理

```javascript
// 创建管理员用户
use admin
db.createUser({
  user: "admin",
  pwd: "secure_password",
  roles: [
    { role: "userAdminAnyDatabase", db: "admin" },
    { role: "readWriteAnyDatabase", db: "admin" },
    { role: "clusterAdmin", db: "admin" }
  ]
})

// 创建应用数据库用户
use myapp
db.createUser({
  user: "app_user",
  pwd: "app_password",
  roles: [
    { role: "readWrite", db: "myapp" }
  ]
})

// 创建只读用户
db.createUser({
  user: "readonly",
  pwd: "readonly_password",
  roles: [
    { role: "read", db: "myapp" }
  ]
})

// 查看用户
db.getUsers()

// 更新密码
db.changeUserPassword("app_user", "new_password")
```

## 副本集配置

```javascript
// 初始化副本集（在主节点执行）
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017", priority: 2 },
    { _id: 1, host: "mongo2:27017", priority: 1 },
    { _id: 2, host: "mongo3:27017", priority: 1 }
  ]
})

// 查看副本集状态
rs.status()
rs.conf()

// 添加成员
rs.add("mongo4:27017")

// 添加仲裁节点
rs.addArb("arbiter:27017")

// 连接字符串
// mongodb://user:pass@mongo1:27017,mongo2:27017,mongo3:27017/mydb?replicaSet=rs0
```

## 索引管理

```javascript
// 创建索引
db.users.createIndex({ email: 1 }, { unique: true })
db.orders.createIndex({ userId: 1, createdAt: -1 })
db.products.createIndex({ name: "text", description: "text" })  // 全文索引
db.locations.createIndex({ coordinates: "2dsphere" })            // 地理索引

// 查看索引
db.users.getIndexes()

// 索引使用统计
db.users.aggregate([{ $indexStats: {} }])

// 删除索引
db.users.dropIndex("email_1")

// TTL 索引（自动过期）
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })
```

## 备份与恢复

```bash
# mongodump 备份
mongodump \
  --uri="mongodb://admin:password@localhost:27017" \
  --out=/backup/mongodb/$(date +%Y%m%d) \
  --gzip

# 备份单个数据库
mongodump \
  --uri="mongodb://admin:password@localhost:27017" \
  --db=myapp \
  --gzip \
  --archive=/backup/myapp_$(date +%Y%m%d).gz

# 恢复
mongorestore \
  --uri="mongodb://admin:password@localhost:27017" \
  --gzip \
  /backup/mongodb/20240101

# 从压缩包恢复
mongorestore \
  --uri="mongodb://admin:password@localhost:27017" \
  --gzip \
  --archive=/backup/myapp_20240101.gz

# 定时备份（crontab）
# 0 2 * * * /usr/bin/mongodump --uri="mongodb://admin:pass@localhost:27017" --gzip --out=/backup/mongodb/$(date +\%Y\%m\%d) && find /backup/mongodb -mtime +7 -delete
```

## 性能调优参数

```yaml
# mongod.conf 性能优化

storage:
  wiredTiger:
    engineConfig:
      # 缓存大小：物理内存的 50%（至少 256MB）
      cacheSizeGB: 4
      # 检查点间隔
      # checkpointSizeMB: 1024

net:
  # 启用压缩
  compression:
    compressors: snappy,zstd

# 慢查询日志
operationProfiling:
  mode: slowOp
  slowOpThresholdMs: 50
  slowOpSampleRate: 1.0
```

## 常用管理命令

```javascript
// 数据库统计
db.stats()
db.collection.stats()

// 当前操作
db.currentOp()

// 终止长时间运行的操作
db.killOp(opId)

// 服务器状态
db.serverStatus()

// 连接数监控
db.serverStatus().connections

// compact 压缩集合
db.runCommand({ compact: "collection_name" })

// 修复数据库
db.repairDatabase()
```

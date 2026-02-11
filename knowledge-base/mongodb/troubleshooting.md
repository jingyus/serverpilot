# MongoDB 故障排查与安全加固

## 常见故障排查

### 1. 服务启动失败

**症状**: `systemctl start mongod` 失败

```bash
# 查看详细日志
sudo journalctl -u mongod -n 50
sudo tail -50 /var/log/mongodb/mongod.log

# 测试配置文件
mongod --config /etc/mongod.conf --fork --logpath /tmp/mongod-test.log

# 检查数据目录权限
ls -la /var/lib/mongodb/
sudo chown -R mongodb:mongodb /var/lib/mongodb

# 检查端口占用
sudo ss -tlnp | grep 27017

# 检查磁盘空间
df -h /var/lib/mongodb

# 常见原因：
# - 数据目录权限错误
# - 端口被占用
# - 配置文件 YAML 格式错误
# - 磁盘空间不足
# - WiredTiger 缓存文件损坏
```

### 2. 连接超时 / 拒绝

**症状**: `MongoServerSelectionError: connection timed out`

```bash
# 检查服务运行状态
sudo systemctl status mongod

# 检查绑定地址
grep bindIp /etc/mongod.conf

# 检查防火墙
sudo iptables -L -n | grep 27017
sudo firewall-cmd --list-ports

# 测试端口连通性
nc -zv <host> 27017

# 检查认证配置
grep authorization /etc/mongod.conf

# 常见原因：
# - bindIp 仅绑定 127.0.0.1
# - 防火墙未开放 27017
# - 认证已启用但未提供凭据
# - 最大连接数已满
```

### 3. 查询性能慢

**症状**: 查询响应时间过长

```javascript
// 查看慢查询日志
db.setProfilingLevel(1, { slowms: 50 })
db.system.profile.find().sort({ ts: -1 }).limit(10)

// 使用 explain 分析
db.collection.find({ field: "value" }).explain("executionStats")
// 关注：
// - totalDocsExamined（扫描文档数）
// - nReturned（返回文档数）
// - executionTimeMillis（执行时间）
// - stage: "COLLSCAN" 表示全表扫描（需加索引）

// 查看索引使用情况
db.collection.aggregate([{ $indexStats: {} }])

// 查找缺失索引建议
db.collection.find({ field: "value" }).explain().queryPlanner.rejectedPlans
```

```bash
# 监控操作
mongosh --eval "db.currentOp({ secs_running: { \$gt: 5 } })"

# 终止慢查询
mongosh --eval "db.killOp(<opId>)"

# 常见原因：
# - 缺少索引（COLLSCAN）
# - 索引未覆盖查询
# - 大量文档排序未使用索引
# - 连接池耗尽
```

### 4. 磁盘空间不足

**症状**: 写入失败或服务停止

```bash
# 查看数据库大小
mongosh --eval "
  db.adminCommand('listDatabases').databases.forEach(function(d) {
    print(d.name + ': ' + (d.sizeOnDisk / 1024 / 1024).toFixed(2) + ' MB');
  });
"

# 查看集合大小
mongosh --eval "
  var colls = db.getCollectionNames();
  colls.forEach(function(c) {
    var stats = db[c].stats();
    print(c + ': ' + (stats.storageSize / 1024 / 1024).toFixed(2) + ' MB');
  });
"

# 压缩集合（回收空间）
mongosh --eval "db.runCommand({ compact: 'collection_name' })"

# 清理 oplog（副本集）
mongosh --eval "db.adminCommand({ replSetResizeOplog: 1, size: 1024 })"

# 删除过期数据
mongosh --eval "db.logs.deleteMany({ createdAt: { \$lt: new Date(Date.now() - 30*24*60*60*1000) } })"
```

### 5. 副本集同步问题

**症状**: Secondary 节点延迟或无法同步

```javascript
// 查看副本集状态
rs.status()

// 查看同步延迟
rs.printReplicationInfo()     // oplog 信息
rs.printSecondaryReplicationInfo()  // Secondary 延迟

// 重新同步 Secondary
// 1. 停止 Secondary
// 2. 删除数据目录
// 3. 重启，让其自动初始同步

// 查看 oplog 大小
use local
db.oplog.rs.stats().maxSize / 1024 / 1024  // MB
```

```bash
# 常见原因：
# - 网络延迟或带宽不足
# - oplog 大小不足（写入量大时被覆盖）
# - Secondary 磁盘 I/O 瓶颈
# - 大量批量操作
```

### 6. 认证失败

**症状**: `Authentication failed`

```javascript
// 检查用户列表
use admin
db.getUsers()

// 检查用户角色
db.getUser("username")

// 重置密码
db.changeUserPassword("username", "new_password")

// 创建缺失用户
db.createUser({
  user: "admin",
  pwd: "password",
  roles: ["root"]
})
```

```bash
# 紧急恢复（无密码启动）
# 1. 临时禁用认证
sudo sed -i 's/authorization: enabled/#authorization: enabled/' /etc/mongod.conf
sudo systemctl restart mongod

# 2. 连接并重置密码
mongosh
# use admin; db.changeUserPassword("admin", "new_password")

# 3. 重新启用认证
sudo sed -i 's/#authorization: enabled/authorization: enabled/' /etc/mongod.conf
sudo systemctl restart mongod
```

## 安全加固

### 认证与授权

```yaml
# mongod.conf
security:
  authorization: enabled
  # 副本集使用 keyFile 认证
  # keyFile: /etc/mongodb/keyfile
```

```bash
# 生成 keyFile（副本集）
openssl rand -base64 756 > /etc/mongodb/keyfile
chmod 400 /etc/mongodb/keyfile
chown mongodb:mongodb /etc/mongodb/keyfile
```

### 网络安全

```yaml
# mongod.conf - 限制绑定和端口
net:
  bindIp: 127.0.0.1,10.0.0.1   # 仅内网
  port: 27017
  tls:
    mode: requireTLS
    certificateKeyFile: /etc/ssl/mongodb.pem
    CAFile: /etc/ssl/ca.pem
```

```bash
# 防火墙仅允许应用服务器
sudo ufw allow from 10.0.0.0/24 to any port 27017
sudo ufw deny 27017
```

### 审计日志

```yaml
# mongod.conf（Enterprise 版本）
auditLog:
  destination: file
  format: JSON
  path: /var/log/mongodb/audit.json
  filter: '{ atype: { $in: ["authenticate", "createUser", "dropDatabase"] } }'
```

### 加密存储

```yaml
# mongod.conf（Enterprise 版本）
security:
  enableEncryption: true
  encryptionKeyFile: /etc/mongodb/encryption-key
```

### 安全检查清单

```bash
# 检查认证状态
mongosh --eval "db.adminCommand({ getParameter: 1, authenticationMechanisms: 1 })"

# 检查绑定地址
grep bindIp /etc/mongod.conf

# 检查是否启用 TLS
grep -A5 tls /etc/mongod.conf

# 检查用户权限
mongosh -u admin -p --eval "db.adminCommand('usersInfo')"

# 检查不必要的 HTTP 接口
grep -i "http" /etc/mongod.conf
```

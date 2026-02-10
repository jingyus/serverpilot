# Redis 故障排查与安全加固

## 常见故障排查

### 1. 无法连接 Redis

**症状**: `Could not connect to Redis at 127.0.0.1:6379: Connection refused`

```bash
# 检查服务状态
sudo systemctl status redis-server

# 检查端口监听
sudo ss -tlnp | grep 6379

# 检查配置中的绑定地址
grep "^bind" /etc/redis/redis.conf

# 检查 protected-mode
grep "protected-mode" /etc/redis/redis.conf

# 检查日志
sudo tail -50 /var/log/redis/redis-server.log

# 测试连接
redis-cli -h 127.0.0.1 -p 6379 ping
```

**常见原因**:
- 服务未启动
- `bind` 地址配置不包含客户端地址
- `protected-mode yes` 但未设置密码
- 防火墙阻断连接

### 2. 内存不足

**症状**: `OOM command not allowed` 或写入操作失败

```bash
# 查看内存使用
redis-cli INFO memory

# 查看 key 数量和大小分布
redis-cli DBSIZE
redis-cli --bigkeys

# 查看内存淘汰策略
redis-cli CONFIG GET maxmemory
redis-cli CONFIG GET maxmemory-policy
```

```bash
# 临时增加内存限制
redis-cli CONFIG SET maxmemory 4gb

# 修改淘汰策略
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# 查找大 key
redis-cli --bigkeys --i 0.1

# 手动清理过期 key
redis-cli --scan --pattern "session:*" | head -100
```

### 3. 延迟过高

```bash
# 检测基准延迟
redis-cli --latency

# 持续监控延迟
redis-cli --latency-history -i 5

# 查看慢查询日志
redis-cli SLOWLOG GET 10
redis-cli SLOWLOG LEN
redis-cli SLOWLOG RESET

# 查看客户端列表
redis-cli CLIENT LIST
```

**常见原因**:
- 使用了 `KEYS *` 等阻塞命令
- 大 key 操作（如 `DEL` 大集合）
- RDB 快照或 AOF 重写时 fork 开销
- 内存交换（swap）
- 网络延迟

### 4. 持久化问题

#### RDB 快照失败

```bash
# 查看最后一次快照状态
redis-cli LASTSAVE
redis-cli INFO persistence

# 手动触发快照
redis-cli BGSAVE

# 检查磁盘空间
df -h /var/lib/redis/
```

#### AOF 文件损坏

```bash
# 检查 AOF 文件
redis-check-aof --fix /var/lib/redis/appendonly.aof

# 备份原文件后修复
cp /var/lib/redis/appendonly.aof /var/lib/redis/appendonly.aof.bak
redis-check-aof --fix /var/lib/redis/appendonly.aof
```

### 5. 复制中断

```bash
# 查看复制状态
redis-cli INFO replication

# 主节点查看从节点
redis-cli CLIENT LIST TYPE replica

# 从节点检查偏移量
redis-cli INFO replication | grep master_link_status
```

**常见原因**:
- 网络中断
- 主节点输出缓冲区溢出
- 从节点 `repl-timeout` 过小
- 全量同步时 RDB 传输超时

### 6. 大 Key 问题

```bash
# 扫描大 key
redis-cli --bigkeys

# 使用 MEMORY USAGE 检查特定 key
redis-cli MEMORY USAGE mykey

# 安全删除大 key（使用 UNLINK 异步删除）
redis-cli UNLINK large_set_key
```

### 7. CPU 使用率高

```bash
# 查看命令统计
redis-cli INFO commandstats

# 监控实时命令
redis-cli MONITOR  # 注意：生产环境慎用，会影响性能

# 常见原因：
# - 频繁的 KEYS 命令
# - Lua 脚本执行时间长
# - 大量 pipeline 请求
# - AOF 重写
```

## 安全加固

### 网络安全

```conf
# 仅监听本地
bind 127.0.0.1

# 开启保护模式
protected-mode yes

# 修改默认端口
port 16379

# 禁用危险命令
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
rename-command DEBUG ""
rename-command KEYS ""
```

### 认证安全

```conf
# 设置强密码
requirepass YourVeryStrongPassword!@#$2024

# ACL 访问控制（Redis 6+）
# redis.conf 或通过 ACL 命令
user default off
user admin on >AdminPassword ~* +@all
user appuser on >AppPassword ~app:* +@read +@write -@admin
```

```bash
# 使用 ACL 命令管理用户
redis-cli ACL SETUSER appuser on >AppPassword ~app:* +get +set +del +hget +hset
redis-cli ACL LIST
redis-cli ACL GETUSER appuser
```

### TLS/SSL 加密

```conf
# Redis 6+ TLS 配置
tls-port 6380
port 0

tls-cert-file /etc/redis/ssl/redis.crt
tls-key-file /etc/redis/ssl/redis.key
tls-ca-cert-file /etc/redis/ssl/ca.crt

tls-auth-clients optional
tls-replication yes
tls-cluster yes
```

### 文件权限

```bash
# 配置文件权限
sudo chmod 640 /etc/redis/redis.conf
sudo chown redis:redis /etc/redis/redis.conf

# 数据目录权限
sudo chmod 750 /var/lib/redis
sudo chown redis:redis /var/lib/redis
```

## 监控与运维

```bash
# 实时统计
redis-cli INFO | grep -E "used_memory_human|connected_clients|total_commands|keyspace"

# 监控连接数
redis-cli INFO clients

# 查看 key 空间统计
redis-cli INFO keyspace

# 查看慢查询
redis-cli SLOWLOG GET 10

# 延迟诊断
redis-cli LATENCY LATEST
redis-cli LATENCY HISTORY <event-name>

# 内存分析
redis-cli MEMORY DOCTOR
redis-cli MEMORY STATS
```

## 常用运维命令

```bash
# 服务管理
sudo systemctl start redis-server
sudo systemctl stop redis-server
sudo systemctl restart redis-server

# 优雅关闭（等待持久化完成）
redis-cli SHUTDOWN SAVE

# 配置热更新（不重启）
redis-cli CONFIG SET maxmemory 4gb
redis-cli CONFIG REWRITE  # 写入配置文件

# 手动触发持久化
redis-cli BGSAVE     # RDB 快照
redis-cli BGREWRITEAOF  # AOF 重写
```

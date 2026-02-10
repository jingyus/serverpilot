# Redis 常用配置模板

## 基础配置

```conf
# /etc/redis/redis.conf

# 网络
bind 127.0.0.1
port 6379
protected-mode yes
tcp-backlog 511
timeout 300
tcp-keepalive 300

# 通用
daemonize yes
pidfile /var/run/redis/redis-server.pid
loglevel notice
logfile /var/log/redis/redis-server.log

# 数据库数量
databases 16

# 密码认证
requirepass YourStrongPassword123!
```

## 内存配置

```conf
# 最大内存限制
maxmemory 2gb

# 内存淘汰策略
# - noeviction: 不淘汰，写操作返回错误（默认）
# - allkeys-lru: 所有 key 中淘汰最近最少使用的
# - volatile-lru: 设置了过期时间的 key 中淘汰 LRU
# - allkeys-lfu: 所有 key 中淘汰最不频繁使用的
# - volatile-lfu: 设置了过期时间的 key 中淘汰 LFU
# - allkeys-random: 随机淘汰
# - volatile-random: 设置了过期时间的 key 中随机淘汰
# - volatile-ttl: 淘汰即将过期的 key
maxmemory-policy allkeys-lru

# LRU/LFU 采样数量（越大越精确，越消耗 CPU）
maxmemory-samples 5
```

## 持久化配置

### RDB 快照

```conf
# 触发条件：N 秒内至少 M 次写操作
save 900 1      # 900 秒内至少 1 次写
save 300 10     # 300 秒内至少 10 次写
save 60 10000   # 60 秒内至少 10000 次写

# RDB 文件名和目录
dbfilename dump.rdb
dir /var/lib/redis

# 压缩
rdbcompression yes
rdbchecksum yes

# 快照失败时停止写入
stop-writes-on-bgsave-error yes
```

### AOF 持久化

```conf
# 开启 AOF
appendonly yes
appendfilename "appendonly.aof"

# 同步策略
# - always: 每次写操作都同步（最安全，最慢）
# - everysec: 每秒同步一次（推荐）
# - no: 由操作系统决定
appendfsync everysec

# AOF 重写
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

# 重写时不执行 fsync
no-appendfsync-on-rewrite no
```

### 混合持久化（Redis 7+）

```conf
# 开启 AOF
appendonly yes

# AOF 使用 RDB 前导格式（混合持久化）
aof-use-rdb-preamble yes
```

## 主从复制配置

### 主节点

```conf
bind 0.0.0.0
requirepass master_password
masterauth master_password
```

### 从节点

```conf
# 指定主节点
replicaof master_ip 6379
masterauth master_password

# 从节点只读
replica-read-only yes

# 从节点同步策略
replica-serve-stale-data yes
repl-diskless-sync yes
```

## Sentinel 高可用

```conf
# /etc/redis/sentinel.conf
port 26379
sentinel monitor mymaster 10.0.0.1 6379 2
sentinel auth-pass mymaster master_password
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
```

```bash
# 启动 Sentinel
redis-sentinel /etc/redis/sentinel.conf
```

## Cluster 集群配置

```conf
# 每个节点的配置
port 7000
cluster-enabled yes
cluster-config-file nodes-7000.conf
cluster-node-timeout 5000
appendonly yes
```

```bash
# 创建集群（3 主 3 从）
redis-cli --cluster create \
  10.0.0.1:7000 10.0.0.2:7000 10.0.0.3:7000 \
  10.0.0.1:7001 10.0.0.2:7001 10.0.0.3:7001 \
  --cluster-replicas 1
```

## 常用数据操作

```bash
# 字符串
SET key "value" EX 3600    # 设置值，1小时过期
GET key
INCR counter

# 哈希
HSET user:1 name "Alice" email "alice@example.com"
HGET user:1 name
HGETALL user:1

# 列表
LPUSH queue "task1" "task2"
RPOP queue
LRANGE queue 0 -1

# 集合
SADD tags "nodejs" "redis" "docker"
SMEMBERS tags
SISMEMBER tags "redis"

# 有序集合
ZADD leaderboard 100 "player1" 200 "player2"
ZRANGE leaderboard 0 -1 WITHSCORES
ZREVRANGE leaderboard 0 9

# 键管理
KEYS pattern*         # 生产环境避免使用
SCAN 0 MATCH pattern* COUNT 100  # 推荐
TTL key
EXPIRE key 3600
DEL key
```

## 性能调优参数

```conf
# 慢日志
slowlog-log-slower-than 10000   # 微秒（10ms）
slowlog-max-len 128

# 客户端缓冲
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# 延迟监控
latency-monitor-threshold 100

# IO 线程（Redis 6+）
io-threads 4
io-threads-do-reads yes
```

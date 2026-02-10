# PostgreSQL 常用配置模板

## 主配置文件 postgresql.conf

### 连接与认证

```ini
# /etc/postgresql/16/main/postgresql.conf

# 监听地址
listen_addresses = 'localhost'   # 生产环境只监听需要的地址
port = 5432
max_connections = 200

# 认证超时
authentication_timeout = 60s

# SSL
ssl = on
ssl_cert_file = '/etc/postgresql/ssl/server.crt'
ssl_key_file = '/etc/postgresql/ssl/server.key'
```

### 内存配置

```ini
# 共享缓冲区（建议为物理内存的 25%）
shared_buffers = 1GB

# 工作内存（每个查询排序/哈希操作）
work_mem = 16MB

# 维护操作内存（VACUUM, CREATE INDEX）
maintenance_work_mem = 256MB

# 有效缓存大小（操作系统缓存估算，建议为物理内存的 50-75%）
effective_cache_size = 3GB
```

### WAL 与检查点

```ini
# WAL 配置
wal_level = replica
max_wal_size = 2GB
min_wal_size = 256MB
wal_buffers = 64MB

# 检查点
checkpoint_completion_target = 0.9
checkpoint_timeout = 10min
```

### 查询优化

```ini
# 并行查询
max_parallel_workers_per_gather = 4
max_parallel_workers = 8

# 随机页面开销（SSD 降低此值）
random_page_cost = 1.1    # SSD
# random_page_cost = 4.0  # HDD

# 统计信息
default_statistics_target = 100
```

### 日志配置

```ini
# 日志目标
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 100MB

# 日志级别
log_min_messages = warning
log_min_error_statement = error

# 慢查询日志
log_min_duration_statement = 1000  # 记录超过 1 秒的查询
log_statement = 'ddl'              # 记录 DDL 语句

# 连接日志
log_connections = on
log_disconnections = on
```

## 认证配置 pg_hba.conf

```conf
# /etc/postgresql/16/main/pg_hba.conf

# TYPE  DATABASE    USER        ADDRESS         METHOD

# 本地连接
local   all         postgres                    peer
local   all         all                         scram-sha-256

# IPv4 本地连接
host    all         all         127.0.0.1/32    scram-sha-256

# IPv6 本地连接
host    all         all         ::1/128         scram-sha-256

# 允许内网访问特定数据库
host    myapp       appuser     10.0.0.0/24     scram-sha-256

# SSL 强制连接
hostssl myapp       appuser     0.0.0.0/0       scram-sha-256
```

## 备份策略

### pg_dump 逻辑备份

```bash
# 单库备份
pg_dump -U postgres -Fc myapp > myapp_backup.dump

# 全量备份
pg_dumpall -U postgres > full_backup.sql

# 压缩备份
pg_dump -U postgres -Fc myapp | gzip > myapp_$(date +%Y%m%d).dump.gz

# 恢复
pg_restore -U postgres -d myapp myapp_backup.dump

# 从 SQL 恢复
psql -U postgres < full_backup.sql
```

### 自动备份脚本

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/postgresql"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

# 备份所有数据库
for db in $(psql -U postgres -t -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres'"); do
  pg_dump -U postgres -Fc "$db" > "$BACKUP_DIR/${db}_${DATE}.dump"
done

# 清理旧备份
find "$BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete
```

### 持续归档（PITR）

```ini
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /var/backups/postgresql/wal/%f'
```

```bash
# 基础备份
pg_basebackup -U postgres -D /var/backups/postgresql/base -Ft -z -P
```

## 主从复制

### 流复制配置

主节点 `postgresql.conf`:
```ini
wal_level = replica
max_wal_senders = 5
wal_keep_size = 1GB
```

主节点 `pg_hba.conf`:
```conf
host    replication    repl_user    10.0.0.0/24    scram-sha-256
```

```sql
-- 主节点创建复制用户
CREATE USER repl_user WITH REPLICATION PASSWORD 'ReplPassword123!';
```

从节点设置:
```bash
# 使用 pg_basebackup 初始化从节点
pg_basebackup -h master_ip -U repl_user -D /var/lib/postgresql/16/main -Fp -Xs -P -R
```

## 常用管理 SQL

```sql
-- 查看数据库大小
SELECT pg_database.datname,
  pg_size_pretty(pg_database_size(pg_database.datname)) AS size
FROM pg_database ORDER BY pg_database_size(pg_database.datname) DESC;

-- 查看表大小
SELECT relname AS table,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;

-- 查看活跃连接
SELECT pid, usename, datname, state, query_start, query
FROM pg_stat_activity WHERE state = 'active';

-- 查看锁等待
SELECT blocked.pid AS blocked_pid, blocked.query AS blocked_query,
  blocking.pid AS blocking_pid, blocking.query AS blocking_query
FROM pg_stat_activity AS blocked
JOIN pg_locks AS blocked_locks ON blocked.pid = blocked_locks.pid
JOIN pg_locks AS blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
  AND blocked_locks.relation = blocking_locks.relation
JOIN pg_stat_activity AS blocking ON blocking_locks.pid = blocking.pid
WHERE NOT blocked_locks.granted AND blocking_locks.granted;

-- 查看索引使用率
SELECT relname, idx_scan, seq_scan,
  ROUND(idx_scan::numeric / NULLIF(idx_scan + seq_scan, 0) * 100, 2) AS idx_pct
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;
```

# PostgreSQL 故障排查与安全加固

## 常见故障排查

### 1. 无法连接数据库

**症状**: `FATAL: password authentication failed` 或 `connection refused`

```bash
# 检查服务状态
sudo systemctl status postgresql

# 检查监听端口
sudo ss -tlnp | grep 5432

# 检查 pg_hba.conf 认证规则
sudo cat /etc/postgresql/16/main/pg_hba.conf

# 检查 postgresql.conf 监听地址
grep listen_addresses /etc/postgresql/16/main/postgresql.conf

# 测试本地连接
sudo -u postgres psql

# 查看日志
sudo tail -50 /var/log/postgresql/postgresql-16-main.log
```

**常见原因**:
- `pg_hba.conf` 没有匹配的认证规则
- `listen_addresses` 没有包含客户端地址
- 防火墙阻断 5432 端口
- 密码不正确

### 2. 查询性能慢

```sql
-- 使用 EXPLAIN ANALYZE 分析查询
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM users WHERE email = 'test@example.com';

-- 检查表统计信息是否过期
SELECT relname, last_analyze, last_autoanalyze
FROM pg_stat_user_tables;

-- 更新统计信息
ANALYZE users;

-- 检查缺失索引
SELECT relname, seq_scan, seq_tup_read, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 100 AND idx_scan < seq_scan
ORDER BY seq_tup_read DESC;

-- 创建索引
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
```

### 3. 连接数过多

**症状**: `FATAL: too many connections for role`

```sql
-- 查看当前连接数
SELECT count(*) FROM pg_stat_activity;

-- 查看各用户连接数
SELECT usename, count(*) FROM pg_stat_activity GROUP BY usename;

-- 查看各状态连接数
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

-- 终止空闲连接
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle' AND query_start < NOW() - INTERVAL '30 minutes';
```

```ini
# 增加最大连接数
max_connections = 300

# 或使用连接池（PgBouncer）
```

### 4. 磁盘空间不足

```sql
-- 查看数据库大小
SELECT pg_size_pretty(pg_database_size('myapp'));

-- 查看表大小（含索引）
SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
FROM pg_class WHERE relkind = 'r'
ORDER BY pg_total_relation_size(oid) DESC LIMIT 10;

-- 查看表膨胀
SELECT schemaname, relname, n_dead_tup, n_live_tup,
  ROUND(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 2) AS dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

```bash
# 手动执行 VACUUM
vacuumdb -U postgres -d myapp --analyze

# 回收空间（锁表）
vacuumdb -U postgres -d myapp --full

# 清理 WAL
# 检查 pg_wal 目录大小
sudo du -sh /var/lib/postgresql/16/main/pg_wal/
```

### 5. 死锁

```sql
-- 查看锁信息
SELECT l.pid, l.mode, l.granted, a.query, a.state
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE NOT l.granted;

-- 查看等待事件
SELECT pid, wait_event_type, wait_event, state, query
FROM pg_stat_activity
WHERE wait_event IS NOT NULL;

-- 终止阻塞进程
SELECT pg_terminate_backend(<blocking_pid>);

-- 设置死锁检测超时
-- deadlock_timeout = 1s  (postgresql.conf)
-- lock_timeout = 5s      (会话级别)
SET lock_timeout = '5s';
```

### 6. 数据损坏

```bash
# 检查数据一致性
pg_amcheck -U postgres --all

# 检查特定表
pg_amcheck -U postgres -d myapp -t users

# 从备份恢复
pg_restore -U postgres -d myapp -c myapp_backup.dump
```

### 7. 复制延迟

```sql
-- 在主节点查看复制状态
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
  pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replication_lag_bytes
FROM pg_stat_replication;

-- 在从节点查看延迟
SELECT CASE WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn()
  THEN 0
  ELSE EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp())
END AS replication_lag_seconds;
```

## 安全加固

### 认证安全

```conf
# pg_hba.conf - 使用最安全的认证方式
# 禁止无密码连接
local   all   all   scram-sha-256
host    all   all   127.0.0.1/32   scram-sha-256

# 强制 SSL 连接
hostssl   myapp   appuser   0.0.0.0/0   scram-sha-256
hostnossl all     all       0.0.0.0/0   reject
```

### 用户权限

```sql
-- 最小权限原则
REVOKE ALL ON DATABASE myapp FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- 创建只读用户
CREATE USER readonly_user WITH PASSWORD 'ReadOnlyPass123!';
GRANT CONNECT ON DATABASE myapp TO readonly_user;
GRANT USAGE ON SCHEMA public TO readonly_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_user;

-- 创建应用用户（DML 权限）
CREATE USER app_user WITH PASSWORD 'AppPass123!';
GRANT CONNECT ON DATABASE myapp TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

### 网络安全

```ini
# postgresql.conf
listen_addresses = '127.0.0.1'   # 仅本地监听

# 使用 SSL
ssl = on
ssl_min_protocol_version = 'TLSv1.2'
```

### 审计日志

```ini
# postgresql.conf
log_connections = on
log_disconnections = on
log_statement = 'ddl'
log_min_duration_statement = 1000
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
```

### 行级安全（RLS）

```sql
-- 启用行级安全
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 用户只能看自己的订单
CREATE POLICY user_orders ON orders
  FOR ALL
  TO app_user
  USING (user_id = current_setting('app.current_user_id')::int);
```

## 常用运维命令

```bash
# 服务管理
sudo systemctl start postgresql
sudo systemctl stop postgresql
sudo systemctl restart postgresql
sudo systemctl reload postgresql  # 重载配置，不中断连接

# 查看配置
sudo -u postgres psql -c "SHOW ALL;"

# 查看当前配置值
sudo -u postgres psql -c "SHOW shared_buffers;"

# 交互式客户端
sudo -u postgres psql
# \l       列出数据库
# \dt      列出表
# \d+ table 查看表结构
# \du      列出用户
# \q       退出
```

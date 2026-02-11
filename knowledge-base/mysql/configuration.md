# MySQL 常用配置模板

## 配置

以下为 MySQL 常用配置模板和调优参数。

### 基础配置文件

```ini
# /etc/mysql/my.cnf 或 /etc/my.cnf
[mysqld]
# 基础设置
port = 3306
bind-address = 127.0.0.1
datadir = /var/lib/mysql
socket = /var/run/mysqld/mysqld.sock
pid-file = /var/run/mysqld/mysqld.pid

# 字符集
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

# 最大连接数
max_connections = 200

# 超时设置
wait_timeout = 600
interactive_timeout = 600
connect_timeout = 10

# 日志
log_error = /var/log/mysql/error.log
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2

[client]
default-character-set = utf8mb4

[mysql]
default-character-set = utf8mb4
```

## InnoDB 存储引擎优化

```ini
[mysqld]
# InnoDB 缓冲池（建议设置为物理内存的 60-80%）
innodb_buffer_pool_size = 1G
innodb_buffer_pool_instances = 4

# 日志文件
innodb_log_file_size = 256M
innodb_log_buffer_size = 16M

# 刷新策略
innodb_flush_log_at_trx_commit = 1
innodb_flush_method = O_DIRECT

# I/O 线程
innodb_read_io_threads = 4
innodb_write_io_threads = 4

# 文件格式
innodb_file_per_table = 1
innodb_default_row_format = DYNAMIC
```

## 查询缓存与排序

```ini
[mysqld]
# 排序缓冲区
sort_buffer_size = 4M
join_buffer_size = 4M

# 临时表
tmp_table_size = 64M
max_heap_table_size = 64M

# 表缓存
table_open_cache = 2000
table_definition_cache = 1400

# 线程缓存
thread_cache_size = 16
```

## 二进制日志（主从复制/备份）

```ini
[mysqld]
# 开启二进制日志
server-id = 1
log_bin = /var/log/mysql/mysql-bin
binlog_format = ROW
binlog_expire_logs_seconds = 604800
max_binlog_size = 100M

# GTID 模式
gtid_mode = ON
enforce_gtid_consistency = ON
```

## 主从复制配置

### 主节点配置

```ini
[mysqld]
server-id = 1
log_bin = mysql-bin
binlog_format = ROW
binlog_do_db = myapp
```

```sql
-- 在主节点创建复制用户
CREATE USER 'repl'@'%' IDENTIFIED BY 'ReplPassword123!';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;

-- 查看主节点状态
SHOW MASTER STATUS;
```

### 从节点配置

```ini
[mysqld]
server-id = 2
relay_log = mysql-relay-bin
read_only = 1
```

```sql
-- 在从节点配置复制
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='master_ip',
  SOURCE_USER='repl',
  SOURCE_PASSWORD='ReplPassword123!',
  SOURCE_AUTO_POSITION=1;

START REPLICA;
SHOW REPLICA STATUS\G
```

## 备份策略

### mysqldump 逻辑备份

```bash
# 全量备份
mysqldump -u root -p --all-databases --single-transaction --routines --triggers > full_backup.sql

# 单库备份
mysqldump -u root -p --single-transaction myapp > myapp_backup.sql

# 压缩备份
mysqldump -u root -p --all-databases --single-transaction | gzip > backup_$(date +%Y%m%d).sql.gz

# 恢复
mysql -u root -p < full_backup.sql
mysql -u root -p myapp < myapp_backup.sql
```

### 自动备份脚本示例

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

mysqldump -u root --single-transaction --all-databases | gzip > "$BACKUP_DIR/full_$DATE.sql.gz"

# 清理旧备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
```

## 常用管理 SQL

```sql
-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';

-- 查看运行中的查询
SHOW PROCESSLIST;

-- 查看数据库大小
SELECT table_schema AS 'Database',
  ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.tables
GROUP BY table_schema
ORDER BY SUM(data_length + index_length) DESC;

-- 查看表大小排行
SELECT table_name, table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS 'Data (MB)',
  ROUND(index_length / 1024 / 1024, 2) AS 'Index (MB)'
FROM information_schema.tables
WHERE table_schema = 'myapp'
ORDER BY data_length DESC;

-- 查看慢查询状态
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';
```

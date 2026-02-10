# MySQL 故障排查与安全加固

## 常见故障排查

### 1. 无法连接 MySQL

**症状**: `ERROR 2002 (HY000): Can't connect to local MySQL server through socket`

```bash
# 检查服务状态
sudo systemctl status mysql

# 检查 socket 文件是否存在
ls -la /var/run/mysqld/mysqld.sock

# 如果 socket 文件不存在，重启服务
sudo systemctl restart mysql

# 检查目录权限
sudo ls -la /var/run/mysqld/
sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld
```

### 2. 忘记 root 密码

```bash
# 停止 MySQL
sudo systemctl stop mysql

# 以跳过权限检查模式启动
sudo mysqld_safe --skip-grant-tables &

# 登录并重置密码
mysql -u root

# 执行密码重置
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword123!';
FLUSH PRIVILEGES;

# 停止安全模式并正常启动
sudo killall mysqld
sudo systemctl start mysql
```

### 3. 查询性能慢

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 1;
SET GLOBAL long_query_time = 1;

-- 分析慢查询
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';

-- 检查索引使用情况
SHOW INDEX FROM users;

-- 添加缺失的索引
ALTER TABLE users ADD INDEX idx_email (email);

-- 查看表统计信息
ANALYZE TABLE users;
```

```bash
# 使用 mysqldumpslow 分析慢查询日志
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

### 4. 磁盘空间不足

```sql
-- 查看数据库大小
SELECT table_schema, ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.tables GROUP BY table_schema;

-- 查看二进制日志大小
SHOW BINARY LOGS;

-- 清理二进制日志
PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 7 DAY);
```

```bash
# 查看 MySQL 数据目录大小
sudo du -sh /var/lib/mysql/*

# 查看 ibdata1 文件大小
sudo ls -lh /var/lib/mysql/ibdata1
```

### 5. 连接数过多

**症状**: `ERROR 1040 (HY000): Too many connections`

```sql
-- 查看当前连接数和最大连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';

-- 临时增加最大连接数
SET GLOBAL max_connections = 500;

-- 查看连接来源
SELECT user, host, COUNT(*) AS connections
FROM information_schema.processlist
GROUP BY user, host
ORDER BY connections DESC;

-- 终止空闲连接
SELECT CONCAT('KILL ', id, ';')
FROM information_schema.processlist
WHERE command = 'Sleep' AND time > 300;
```

### 6. 表损坏

```sql
-- 检查表
CHECK TABLE myapp.users;

-- 修复 MyISAM 表
REPAIR TABLE myapp.users;

-- InnoDB 表恢复（在 my.cnf 中添加后重启）
-- innodb_force_recovery = 1
-- 恢复数据后移除该参数
```

### 7. 死锁问题

```sql
-- 查看最近的死锁信息
SHOW ENGINE INNODB STATUS\G

-- 查看当前锁等待
SELECT * FROM information_schema.innodb_lock_waits;

-- 查看正在运行的事务
SELECT * FROM information_schema.innodb_trx;
```

## 安全加固

### 网络安全

```ini
[mysqld]
# 仅监听本地
bind-address = 127.0.0.1

# 禁用远程 LOAD DATA
local_infile = 0

# 禁用符号链接
symbolic-links = 0
```

### 用户安全

```sql
-- 删除匿名用户
DELETE FROM mysql.user WHERE User = '';

-- 删除远程 root 登录
DELETE FROM mysql.user WHERE User = 'root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

-- 设置密码策略
SET GLOBAL validate_password.policy = MEDIUM;
SET GLOBAL validate_password.length = 12;

-- 使用最小权限原则
CREATE USER 'appuser'@'localhost' IDENTIFIED BY 'SecurePassword!';
GRANT SELECT, INSERT, UPDATE, DELETE ON myapp.* TO 'appuser'@'localhost';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'appuser'@'localhost';
GRANT SELECT, INSERT, UPDATE ON myapp.* TO 'appuser'@'localhost';

FLUSH PRIVILEGES;
```

### 审计与日志

```ini
[mysqld]
# 开启通用查询日志（仅调试用，生产慎用）
# general_log = 1
# general_log_file = /var/log/mysql/general.log

# 错误日志
log_error = /var/log/mysql/error.log
log_error_verbosity = 2

# 慢查询日志
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2
log_queries_not_using_indexes = 1
```

### 数据加密

```ini
[mysqld]
# SSL/TLS 配置
require_secure_transport = ON
ssl_ca = /etc/mysql/ssl/ca.pem
ssl_cert = /etc/mysql/ssl/server-cert.pem
ssl_key = /etc/mysql/ssl/server-key.pem
```

## 常用运维命令

```bash
# 服务管理
sudo systemctl start mysql
sudo systemctl stop mysql
sudo systemctl restart mysql
sudo systemctl status mysql

# 查看错误日志
sudo tail -100 /var/log/mysql/error.log

# 监控连接数
mysqladmin -u root -p status

# 查看运行变量
mysqladmin -u root -p variables | grep max_connections

# 实时监控
mysqladmin -u root -p -i 1 extended-status | grep -E "Threads_connected|Queries|Slow_queries"
```

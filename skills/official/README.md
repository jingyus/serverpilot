# Official Skills

ServerPilot 官方维护的 Skill 集合，开箱即用，覆盖备份、安全、日志三大运维场景。

## 一览表

| Skill | 描述 | 触发方式 | 风险等级 | 平台 |
|-------|------|----------|----------|------|
| [auto-backup](#auto-backup--自动备份管理) | 定期备份数据库与配置文件，验证完整性，自动清理过期备份 | cron (每天 03:00) / 手动 | red | Linux, macOS |
| [intrusion-detector](#intrusion-detector--入侵检测与防御) | 检测暴力破解、异常端口、可疑进程，发现威胁立即告警 | cron (每 30 分钟) / 事件 / 阈值 / 手动 | yellow | Linux |
| [log-auditor](#log-auditor--智能日志审查) | AI 分析系统日志，识别安全威胁和服务故障，生成结构化报告 | cron (每天 08:00) / 事件 / 手动 | green | Linux |

## 安装

### 通过 Dashboard

1. 进入 **Skills** 页面 → **Available** 标签
2. 找到目标 Skill，点击 **Install**

### 通过 API

```bash
# 安装 auto-backup
curl -X POST /api/v1/skills/install \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"skillDir": "skills/official/auto-backup", "source": "official"}'

# 安装 intrusion-detector
curl -X POST /api/v1/skills/install \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"skillDir": "skills/official/intrusion-detector", "source": "official"}'

# 安装 log-auditor
curl -X POST /api/v1/skills/install \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"skillDir": "skills/official/log-auditor", "source": "official"}'
```

> 需要 `skill:manage` 权限 (admin / owner)。

---

## auto-backup — 自动备份管理

定期备份关键数据（数据库、配置文件），验证备份完整性，自动清理过期备份。

**依赖命令**: `tar`

### 配置参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backup_targets` | enum | 是 | `all` | 备份目标: `all` / `database` / `config` / `custom` |
| `custom_paths` | string[] | 否 | `[]` | 自定义备份路径 (当 `backup_targets=custom` 时使用) |
| `backup_dir` | string | 否 | `/var/backups/serverpilot` | 备份文件存放目录 |
| `retention_days` | number | 否 | `30` | 备份保留天数，超期自动清理 |
| `compression` | enum | 否 | `gzip` | 压缩算法: `gzip` / `zstd` / `none` |
| `verify_backup` | boolean | 否 | `true` | 备份后是否验证完整性 (解压测试) |

### 使用场景

- **每日全量备份**: 使用默认配置，每天凌晨 3:00 自动备份所有数据库和配置文件
- **仅数据库备份**: 设置 `backup_targets=database`，自动检测 MySQL/PostgreSQL/SQLite/Redis 并导出
- **自定义路径备份**: 设置 `backup_targets=custom`，指定 `custom_paths` 备份应用数据目录

### 配置示例

```json
{
  "backup_targets": "database",
  "backup_dir": "/mnt/nfs/backups",
  "retention_days": 14,
  "compression": "zstd",
  "verify_backup": true
}
```

---

## intrusion-detector — 入侵检测与防御

实时监控服务器安全状态，检测暴力破解、异常端口、可疑进程，发现威胁立即告警。

**依赖命令**: `ss`

### 配置参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `trusted_ips` | string[] | 否 | `[]` | 可信 IP 白名单，这些 IP 的登录不会触发告警 |
| `alert_on_root_login` | boolean | 否 | `true` | 检测到 root 直接登录时是否告警 |
| `max_failed_attempts` | number | 否 | `10` | 同一 IP 在检测周期内的最大失败登录次数阈值 |
| `check_open_ports` | boolean | 否 | `true` | 是否检查异常开放端口 |

### 触发条件

- **定时**: 每 30 分钟自动执行一次
- **事件**: 收到 critical 级别告警时触发
- **阈值**: 网络入站流量 >= 100MB/s 时触发 (可能的 DDoS 信号)
- **手动**: 随时可在 Dashboard 手动执行

### 检测项目

1. **暴力破解** — 分析 auth.log 中的 Failed password 记录，统计每个源 IP 的失败次数
2. **异常登录** — 标记非可信 IP、非常规时间段 (0:00-6:00) 的成功 SSH 登录
3. **可疑进程** — 识别加密矿工 (xmrig, minerd)、反弹 shell、/tmp 下的可执行文件
4. **异常端口** — 与上次扫描对比，标记新增的监听端口和未知服务
5. **文件完整性** — 检查 /etc/passwd, /etc/shadow, /etc/sudoers 等关键文件的修改时间

### 配置示例

```json
{
  "trusted_ips": ["10.0.0.0/8", "192.168.1.100"],
  "alert_on_root_login": true,
  "max_failed_attempts": 5,
  "check_open_ports": true
}
```

---

## log-auditor — 智能日志审查

定期分析系统日志，AI 识别异常模式、安全威胁和服务故障，生成结构化报告。

**依赖**: 无额外命令要求 (仅需日志文件读取权限)

### 配置参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `log_sources` | string[] | 否 | `["/var/log/syslog", "/var/log/auth.log", "/var/log/kern.log"]` | 要审查的日志文件路径 |
| `lookback_hours` | number | 否 | `24` | 回溯多少小时的日志 |
| `severity_threshold` | enum | 否 | `warning` | 达到此级别才发送通知: `info` / `warning` / `critical` |

### 分析能力

- **认证异常**: SSH 暴力破解尝试、异常时间/IP 的登录、root 直接登录
- **服务故障**: segfault、OOM killer、服务 failed/restart
- **磁盘错误**: I/O error、文件系统只读重挂载
- **内核告警**: oom-killer、硬件错误
- **可疑活动**: 异常 cron 任务、未知守护进程

### 配置示例

```json
{
  "log_sources": ["/var/log/syslog", "/var/log/auth.log", "/var/log/nginx/error.log"],
  "lookback_hours": 12,
  "severity_threshold": "info"
}
```

---

## 对比选择

| 需求 | 推荐 Skill |
|------|------------|
| 防止数据丢失，灾难恢复 | auto-backup |
| 实时安全防护，入侵预警 | intrusion-detector |
| 日常运维巡检，故障排查 | log-auditor |
| 全面安全保障 | intrusion-detector + log-auditor |
| 完整运维覆盖 | 三个全装 |

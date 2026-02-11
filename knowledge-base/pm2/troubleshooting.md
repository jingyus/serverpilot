# PM2 故障排查与安全加固

## 常见故障排查

### 1. 应用启动后立即退出（errored 状态）

**症状**: `pm2 list` 显示 status 为 `errored` 或 `stopped`

```bash
# 查看错误日志
pm2 logs <app> --err --lines 50

# 查看进程详情
pm2 describe <app>

# 查看重启次数和原因
pm2 show <app> | grep -E "restarts|status|uptime"

# 手动运行检查
node dist/server.js  # 直接运行看报错

# 检查环境变量
pm2 env <app-id>

# 常见原因：
# - 脚本语法错误或运行时异常
# - 缺少环境变量（数据库连接等）
# - 端口被占用
# - 缺少依赖（node_modules 不完整）
# - 文件路径错误（cwd 不对）
```

### 2. 内存持续增长（内存泄漏）

**症状**: PM2 监控显示内存不断上升

```bash
# 实时监控
pm2 monit

# 查看内存使用趋势
pm2 describe <app> | grep "heap"

# 设置内存限制自动重启
pm2 start app.js --max-memory-restart 500M

# 使用 Node.js 内存分析
node --inspect dist/server.js
# 然后使用 Chrome DevTools 的 Memory 面板

# 生成堆快照
pm2 start app.js --node-args="--expose-gc"
# kill -USR2 <pid>  # 触发堆快照

# 常见原因：
# - 全局变量/缓存无限增长
# - 未清理的事件监听器
# - 闭包引用导致 GC 无法回收
# - 未关闭的数据库连接/流
```

### 3. Cluster 模式负载不均

**症状**: 部分 worker 负载高，部分空闲

```bash
# 查看各 worker 状态
pm2 list

# 查看各进程的请求处理情况
pm2 describe <app>

# 检查 Node.js Cluster 调度策略
node -e "console.log(require('cluster').schedulingPolicy)"
# 应为 2（rr = round-robin）

# 设置调度策略（环境变量）
# NODE_CLUSTER_SCHED_POLICY=rr

# 重启所有 worker
pm2 reload <app>

# 常见原因：
# - 默认 OS 调度策略不均匀
# - 部分请求处理时间差异大
# - WebSocket 长连接固定在单个 worker
# - 有状态的 session 固定路由
```

### 4. 零停机重载失败

**症状**: `pm2 reload` 导致请求中断

```bash
# 检查 Graceful Shutdown 配置
pm2 describe <app> | grep -E "kill_timeout|listen_timeout|wait_ready"

# 确认应用发送 ready 信号
# 代码中需要：process.send('ready')

# 确认应用处理 SIGINT 信号
# 代码中需要：process.on('SIGINT', gracefulShutdown)

# 调整超时参数
pm2 start app.js \
  --wait-ready \
  --listen-timeout 10000 \
  --kill-timeout 5000

# 测试重载
pm2 reload <app>

# 常见原因：
# - 未调用 process.send('ready')
# - 未处理 SIGINT 信号
# - kill_timeout 过短（未等待请求完成）
# - 应用启动时间过长超过 listen_timeout
```

### 5. 日志文件过大

**症状**: 磁盘被 PM2 日志占满

```bash
# 查看日志文件大小
du -sh ~/.pm2/logs/*

# 清空日志
pm2 flush

# 安装日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# 手动清理旧日志
find ~/.pm2/logs/ -name "*.log" -size +100M -delete

# 配置输出到外部日志系统
# 使用 --no-pmx 禁用内置日志
# 或配置 log_type: "json" 配合 ELK/Loki 收集
```

### 6. PM2 守护进程异常

**症状**: PM2 命令无响应或报连接错误

```bash
# 检查 PM2 守护进程
ps aux | grep pm2

# 查看 PM2 守护进程日志
cat ~/.pm2/pm2.log | tail -50

# 重启 PM2 守护进程（不影响已运行应用）
pm2 update

# 完全重启 PM2（会停止所有应用）
pm2 kill
pm2 resurrect  # 恢复之前保存的进程列表

# 检查 PM2 主目录权限
ls -la ~/.pm2/

# 常见原因：
# - PM2 版本升级后未 update
# - ~/.pm2 目录权限错误
# - Node.js 版本切换后 PM2 不兼容
# - 系统内存不足导致守护进程被 OOM Kill
```

### 7. 开机自启未生效

**症状**: 服务器重启后应用未自动恢复

```bash
# 重新生成自启脚本
pm2 unstartup
pm2 startup
# 执行输出的 sudo 命令

# 保存当前进程列表
pm2 save

# 检查 systemd 服务
sudo systemctl status pm2-<user>
sudo systemctl is-enabled pm2-<user>

# 手动恢复进程
pm2 resurrect

# 查看保存的进程列表
cat ~/.pm2/dump.pm2 | python3 -m json.tool

# 常见原因：
# - 未执行 pm2 save
# - startup 命令未以正确用户执行
# - systemd 服务未 enable
# - dump.pm2 文件损坏
```

## 性能优化

### Cluster 模式调优

```bash
# 根据 CPU 核心数设置实例
# API 服务：CPU 核心数
pm2 start api.js -i max

# Worker 服务：较少实例
pm2 start worker.js -i 2

# 查看 CPU 使用
pm2 monit
```

### 内存优化

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "api",
    script: "./dist/server.js",
    node_args: [
      "--max-old-space-size=1024",  // V8 堆内存限制
      "--gc-interval=100",           // GC 间隔
    ],
    max_memory_restart: "800M",     // PM2 内存限制重启
  }],
};
```

## 安全加固

### 运行用户

```bash
# 创建专用用户
sudo useradd -r -s /bin/false -d /opt/myapp deploy

# 使用非 root 用户运行
sudo -u deploy pm2 start ecosystem.config.js

# systemd 中指定用户
pm2 startup systemd -u deploy --hp /home/deploy
```

### 环境变量安全

```bash
# 使用 .env 文件（不提交到版本控制）
# .gitignore 中添加 .env

# 通过 ecosystem.config.js 注入
module.exports = {
  apps: [{
    name: "api",
    script: "./dist/server.js",
    env_production: {
      NODE_ENV: "production",
      // 敏感配置从系统环境变量读取
      // 不要写在配置文件中
    },
  }],
};
```

### 进程隔离

```bash
# 限制文件系统访问
# 使用 systemd 的 ProtectSystem 和 ProtectHome

# 限制网络访问（iptables）
# 仅允许必要的端口

# 限制资源使用
pm2 start app.js \
  --max-memory-restart 512M \
  --node-args="--max-old-space-size=512"
```

### 安全检查清单

```bash
# 检查运行用户
pm2 describe <app> | grep "exec_cwd\|username"

# 检查暴露的端口
ss -tlnp | grep node

# 检查环境变量中的敏感信息
pm2 env <app-id> | grep -iE "password|secret|key|token"

# 确认非 root 运行
ps aux | grep pm2 | grep -v root

# 检查日志中的敏感数据
grep -riE "password|secret|token" ~/.pm2/logs/ | head
```
